/**
 * ========================================
 * 盐阜配送 - Yanfu Delivery
 * ========================================
 * © 中哥  All Rights Reserved
 * FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
 * ========================================
 * 严禁未经授权转载、商用，商用需联系作者授权
 * 遵循开源协议，仅限项目内部使用，商用需联系本人授权
 * ========================================
 */

/**
 * 盐阜配送 - AI派单调度器
 * 核心调度类 AiDispatchService，负责三池调度、扩容重试、异常重派
 */
const { pool } = require('../config/database');
const scoringEngine = require('./ai_scoring_engine');
const {
  EXPANSION_CONFIG,
  FALLBACK_CONFIG,
  REDIS_KEYS,
  POOL_THRESHOLDS,
  ROUTE_CONFIG,
} = require('../config/ai_dispatch');
const {
  getPoolType,
  isPeakHour,
  generateTraceId,
  getWeatherCondition,
  getTrafficCondition,
} = require('../utils/ai_dispatch_utils');

class AiDispatchService {
  /**
   * AI智能派单入口
   * @param {object} orderData - 订单数据
   * @param {object} [options] - 可选参数
   * @param {number} [options.radiusMeters] - 搜索半径
   * @param {number} [options.expansionCount] - 扩容次数
   * @returns {Promise<object>} { success, poolType, rider, traceId, scores, ... }
   */
  async dispatchOrder(orderData, options) {
    const traceId = generateTraceId();
    const expansionCount = (options && options.expansionCount) || 0;
    const radiusMeters = options && options.radiusMeters
      ? options.radiusMeters
      : EXPANSION_CONFIG.INITIAL_RADIUS_METERS + expansionCount * EXPANSION_CONFIG.EXPAND_STEP_METERS;

    console.log(`[${traceId}] AI派单开始: orderNo=${orderData.order_no}, radius=${radiusMeters}m, expansion=${expansionCount}`);

    try {
      // 步骤1: 获取天气和路况
      const weather = await getWeatherCondition();
      const traffic = await getTrafficCondition();
      const hour = new Date().getHours();
      const peak = isPeakHour(hour);

      // 步骤2: 判断订单归属池
      const poolType = getPoolType(
        orderData.distance_km || 0,
        peak,
        orderData.is_premium || false,
        orderData.total_amount || orderData.order_amount || 0
      );

      console.log(`[${traceId}] 订单归属池: ${poolType}, 距离=${orderData.distance_km}km`);

      // 步骤3: 筛选候选骑手
      const riders = await scoringEngine.getCandidateRiders(orderData, radiusMeters);

      if (riders.length === 0) {
        console.log(`[${traceId}] 无候选骑手, radius=${radiusMeters}m`);

        // 记录失败日志
        await this.logDispatchResult({
          traceId,
          orderData,
          poolType,
          status: 'failed',
          failReason: '无可用骑手',
          candidateCount: 0,
          expansionCount,
        });

        return { success: false, poolType, rider: null, traceId, needExpansion: true };
      }

      console.log(`[${traceId}] 候选骑手数: ${riders.length}`);

      // 步骤4: 根据池类型执行分配策略
      let result;

      switch (poolType) {
        case 'basic':
          result = await this.basicPoolDispatch(orderData, riders, { traceId, hour, weather, traffic, expansionCount });
          break;
        case 'advanced':
          result = await this.advancedPoolDispatch(orderData, riders, { traceId, hour, weather, traffic, expansionCount });
          break;
        case 'free':
          result = await this.freePoolDispatch(orderData, riders, { traceId, hour, weather, traffic, expansionCount });
          break;
        default:
          result = await this.advancedPoolDispatch(orderData, riders, { traceId, hour, weather, traffic, expansionCount });
      }

      // 步骤5: 分配成功 → 推送通知 → 返回结果
      if (result.success && result.rider) {
        await this.assignOrderToRider(orderData, result.rider, poolType, result.dispatchMode, result.scores, traceId);

        return {
          success: true,
          poolType,
          rider: result.rider,
          traceId,
          scores: result.scores,
          dispatchMode: result.dispatchMode,
          needExpansion: false,
        };
      }

      // 步骤6: 分配失败 → 降级或扩容
      if (expansionCount < EXPANSION_CONFIG.MAX_EXPANSIONS) {
        console.log(`[${traceId}] 分配失败，需要扩容重试`);
        return { success: false, poolType, rider: null, traceId, needExpansion: true };
      }

      // 步骤7: 达到最大扩容次数 → 降级
      return await this.fallbackDispatch(orderData, traceId, poolType, expansionCount);
    } catch (err) {
      console.error(`[${traceId}] AI派单异常:`, err.message);

      // 异常降级
      if (FALLBACK_CONFIG.ENABLED && FALLBACK_CONFIG.FALLBACK_TO_LEVEL_POOL) {
        console.log(`[${traceId}] AI评分异常，降级到等级池派单`);
        return await this.fallbackDispatch(orderData, traceId, 'fallback', expansionCount);
      }

      return { success: false, poolType: 'error', rider: null, traceId, needExpansion: false };
    }
  }

  /**
   * 普惠保底池分配 - 轮循分配
   * @param {object} orderData - 订单数据
   * @param {Array} riders - 候选骑手列表
   * @param {object} context - 上下文
   * @returns {Promise<object>} 分配结果
   */
  async basicPoolDispatch(orderData, riders, context) {
    const traceId = context.traceId;

    // 轮循分配：选择最近最少被派单的骑手
    const sortedRiders = [...riders].sort((a, b) => {
      // 优先选择 last_dispatch_at 更早的（等待最久的）
      if (!a.last_dispatch_at && !b.last_dispatch_at) return 0;
      if (!a.last_dispatch_at) return -1;
      if (!b.last_dispatch_at) return 1;
      return new Date(a.last_dispatch_at) - new Date(b.last_dispatch_at);
    });

    const selectedRider = sortedRiders[0];

    return {
      success: true,
      rider: selectedRider,
      dispatchMode: 'round_robin',
      scores: await this.getBasicScores(orderData, selectedRider, context),
    };
  }

  /**
   * AI择优进阶池分配 - AI评分排序
   * @param {object} orderData - 订单数据
   * @param {Array} riders - 候选骑手列表
   * @param {object} context - 上下文
   * @returns {Promise<object>} 分配结果
   */
  async advancedPoolDispatch(orderData, riders, context) {
    const traceId = context.traceId;

    // AI评分
    const scoredRiders = await scoringEngine.scoreRidersForOrder(orderData, riders, context);

    if (scoredRiders.length === 0) {
      return { success: false, rider: null, dispatchMode: 'scored' };
    }

    // 缓存评分
    await scoringEngine.updateScoreCache(scoredRiders);

    // 取最高分骑手
    const best = scoredRiders[0];

    console.log(`[${traceId}] AI评分最高骑手: id=${best.rider.id}, name=${best.rider.name}, score=${best.totalScore}`);

    return {
      success: true,
      rider: best.rider,
      scores: best.scores,
      dispatchMode: 'scored',
    };
  }

  /**
   * 顺路自由池分配 - 推送候选骑手自主抢单
   * @param {object} orderData - 订单数据
   * @param {Array} riders - 候选骑手列表
   * @param {object} context - 上下文
   * @returns {Promise<object>} 分配结果
   */
  async freePoolDispatch(orderData, riders, context) {
    const traceId = context.traceId;

    // 自由池：筛选顺路骑手（目标配送地址附近500m有骑手）
    // 这里简化处理：将候选骑手推送给所有池内骑手自主确认
    const candidateRiders = riders.slice(0, 10); // 最多推送10人

    // AI评分排序（辅助决定推送顺序）
    const scoredRiders = await scoringEngine.scoreRidersForOrder(orderData, candidateRiders, context);

    if (scoredRiders.length === 0) {
      return { success: false, rider: null, dispatchMode: 'free' };
    }

    // 自由池首次不直接指派，而是推送抢单通知
    // 这里为了兼容自动派单流程，选评分最高者
    const best = scoredRiders[0];

    return {
      success: true,
      rider: best.rider,
      scores: best.scores,
      dispatchMode: 'free',
    };
  }

  /**
   * 降级派单 - 使用原有等级池逻辑
   * @param {object} orderData - 订单数据
   * @param {string} traceId - 追踪ID
   * @param {string} originalPoolType - 原池类型
   * @param {number} expansionCount - 扩容次数
   * @returns {Promise<object>} 降级派单结果
   */
  async fallbackDispatch(orderData, traceId, originalPoolType, expansionCount) {
    try {
      // 引用原有等级池派单函数
      const { dispatchRider } = require('../routes/rider_pool');
      const fallbackResult = await dispatchRider({
        id: orderData.id,
        distance_km: orderData.distance_km,
      });

      if (fallbackResult && fallbackResult.rider) {
        const rider = fallbackResult.rider;

        // 分配订单
        await this.assignOrderToRider(orderData, rider, 'fallback', 'fallback', null, traceId);

        // 记录降级日志
        await this.logDispatchResult({
          traceId,
          orderData,
          poolType: 'fallback',
          status: 'fallback',
          riderId: rider.id,
          candidateCount: 1,
          expansionCount,
          failReason: 'AI派单降级到等级池',
        });

        console.log(`[${traceId}] 降级派单成功: rider=${rider.id}, name=${rider.name}`);

        return {
          success: true,
          poolType: 'fallback',
          rider,
          traceId,
          scores: null,
          dispatchMode: 'fallback',
          needExpansion: false,
        };
      }

      // 降级也失败
      await this.logDispatchResult({
        traceId,
        orderData,
        poolType: originalPoolType,
        status: 'failed',
        candidateCount: 0,
        expansionCount,
        failReason: '降级派单也无可用骑手',
      });

      return { success: false, poolType: originalPoolType, rider: null, traceId, needExpansion: false };
    } catch (err) {
      console.error(`[${traceId}] 降级派单异常:`, err.message);

      return { success: false, poolType: originalPoolType, rider: null, traceId, needExpansion: false };
    }
  }

  /**
   * 分配订单给骑手（数据库写入 + 通知推送）
   * @param {object} orderData - 订单数据
   * @param {object} rider - 骑手
   * @param {string} poolType - 池类型
   * @param {string} dispatchMode - 派单模式
   * @param {object|null} scores - 五维评分
   * @param {string} traceId - 追踪ID
   */
  async assignOrderToRider(orderData, rider, poolType, dispatchMode, scores, traceId) {
    const orderId = orderData.id;
    const orderNo = orderData.order_no;

    try {
      // 更新 merchant_orders 表
      const updateFields = ['rider_id = ?', "status = 'assigned'"];
      const updateParams = [rider.id];

      // 如果 merchant_orders 有 rider_name 字段
      if (rider.name) {
        updateFields.push('rider_name = ?');
        updateParams.push(rider.name);
      }

      updateParams.push(orderId);

      await pool.query(
        `UPDATE merchant_orders SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
      );

      // 插入/更新 rider_orders 关联
      await pool.query(
        `INSERT IGNORE INTO rider_orders (rider_id, order_no, status, created_at)
         VALUES (?, ?, 'assigned', NOW())`,
        [rider.id, orderNo]
      );

      // 记录 dispatch_logs
      await pool.query(
        `INSERT INTO dispatch_logs (order_id, rider_id, pool_type, dispatch_time, status, reason, created_at)
         VALUES (?, ?, ?, NOW(), 'success', ?, NOW())`,
        [orderId, rider.id, poolType, `AI派单[${dispatchMode}]: ${traceId}`]
      );

      // 记录 AI dispatch log
      await pool.query(
        `INSERT INTO ai_dispatch_log
           (trace_id, order_id, order_no, rider_id, rider_name, pool_type, dispatch_mode,
            distance_score, load_score, quality_score, time_env_score, fairness_score, total_score,
            candidate_count, expansion_count, status, dispatch_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?,
                 ?, ?, 'success', NOW(), NOW())`,
        [
          traceId, orderId, orderNo, rider.id, rider.name || '', poolType, dispatchMode,
          scores ? scores.distanceScore : null,
          scores ? scores.loadScore : null,
          scores ? scores.qualityScore : null,
          scores ? scores.timeEnvScore : null,
          scores ? scores.fairnessScore : null,
          scores ? scores.totalScore : null,
          0, 0,
        ]
      );

      // 更新骑手信息
      await pool.query(
        `UPDATE riders SET
           consecutive_dispatch_count = consecutive_dispatch_count + 1,
           last_dispatch_at = NOW()
         WHERE id = ?`,
        [rider.id]
      );

      // 路径优化：在通知骑手前，为自由池（叠单）场景计算最优配送路径
      let optimizedRoute = null;
      if (ROUTE_CONFIG && poolType === 'free') {
        try {
          // 获取骑手当前进行中的其他订单
          const existingOrders = await this.getRiderOngoingOrders(rider.id, orderNo);
          const allOrders = [...existingOrders, orderData];

          if (allOrders.length > 1) {
            const RouteOptimizer = require('./ai_route_optimizer');
            const routeOptimizer = new RouteOptimizer();

            // 构建配送点列表
            const deliveries = allOrders.map(o => ({
              id: o.order_id || o.id || o.order_no,
              lat: parseFloat(o.merchant_latitude || o.pickup_latitude || o.latitude || 0),
              lng: parseFloat(o.merchant_longitude || o.pickup_longitude || o.longitude || 0),
            }));

            // 起点使用骑手当前位置或第一个商家的位置
            const startPoint = {
              lat: deliveries[0].lat,
              lng: deliveries[0].lng,
            };

            const routeResult = await routeOptimizer.optimizeRoute(startPoint, deliveries, {
              include_polyline: true,
              traffic_aware: true,
            });
            optimizedRoute = routeResult;
          }
        } catch (routeErr) {
          console.error(`[${traceId}] 路径优化失败（不影响主流程）:`, routeErr.message);
        }
      }

      // 发送通知（数据库 + WebSocket）
      await this.notifyRiderDispatch(rider, orderData, poolType, scores, traceId, optimizedRoute);

      console.log(`[${traceId}] 订单${orderNo}已指派给骑手${rider.id}`);
    } catch (err) {
      console.error(`[${traceId}] 分配订单给骑手失败:`, err.message);
      throw err;
    }
  }

  /**
   * 通知骑手新派单
   * @param {object} rider - 骑手
   * @param {object} orderData - 订单数据
   * @param {string} poolType - 池类型
   * @param {object|null} scores - 评分
   * @param {string} traceId - 追踪ID
   * @param {object|null} optimizedRoute - 优化后的路径（可选）
   */
  async notifyRiderDispatch(rider, orderData, poolType, scores, traceId, optimizedRoute) {
    try {
      const notificationData = {
        type: 'ai_dispatch',
        order_id: orderData.id,
        order_no: orderData.order_no,
        pool_type: poolType,
        dispatch_time: new Date().toISOString(),
        merchant_name: orderData.merchant_name || '',
        delivery_address: orderData.delivery_address || '',
        delivery_fee: orderData.delivery_fee || 0,
        total_amount: orderData.total_amount || orderData.order_amount || 0,
        distance_km: orderData.distance_km || 0,
        trace_id: traceId,
      };

      // 如果有评分，附上AI评分信息
      if (scores) {
        notificationData.ai_score = scores.totalScore;
        notificationData.score_tier = scoringEngine.getTierLabel(scores.totalScore);
      }

      // 如果有优化路径，附上路径信息
      if (optimizedRoute) {
        notificationData.optimized_route = {
          ordered_indices: optimizedRoute.ordered_indices,
          total_distance_km: optimizedRoute.total_distance_km,
          total_duration_min: optimizedRoute.total_duration_min,
          segments: optimizedRoute.segments,
          polyline: optimizedRoute.polyline,
        };
        notificationData.has_optimized_route = true;
      }

      // 写入 rider_notifications 表
      await pool.query(
        `INSERT INTO rider_notifications (rider_id, type, title, content, is_read, created_at)
         VALUES (?, 'dispatch', ?, ?, 0, NOW())`,
        [
          rider.id,
          'AI智能派单 - 新订单通知',
          JSON.stringify(notificationData),
        ]
      );

      // WebSocket 推送
      try {
        const { emitToRider } = require('../services/websocket');
        emitToRider(rider.id, 'ai:dispatch', notificationData);
      } catch (wsErr) {
        console.log(`[${traceId}] WebSocket通知骑手${rider.id}失败:`, wsErr.message);
      }
    } catch (err) {
      console.error(`[${traceId}] 通知骑手失败:`, err.message);
    }
  }

  /**
   * 骑手响应（接单/拒单）
   * @param {string} orderNo - 订单编号
   * @param {number} riderId - 骑手ID
   * @param {string} action - 'accept' 或 'reject'
   * @returns {Promise<object>} 响应结果
   */
  async handleRiderResponse(orderNo, riderId, action) {
    const traceId = generateTraceId();

    try {
      const [orders] = await pool.query(
        'SELECT id, status, rider_id FROM merchant_orders WHERE order_no = ?',
        [orderNo]
      );

      if (orders.length === 0) {
        return { success: false, message: '订单不存在', traceId };
      }

      const order = orders[0];

      if (action === 'accept') {
        // 接单：更新状态
        await pool.query(
          "UPDATE merchant_orders SET status = 'accepted' WHERE order_no = ?",
          [orderNo]
        );

        // 更新 rider_orders
        await pool.query(
          "UPDATE rider_orders SET status = 'accepted' WHERE order_no = ? AND rider_id = ?",
          [orderNo, riderId]
        );

        // WebSocket 通知
        try {
          const { emitToRider } = require('../services/websocket');
          emitToRider(riderId, 'ai:response', {
            order_no: orderNo,
            action: 'accepted',
            message: '接单成功',
            timestamp: new Date().toISOString(),
          });
        } catch (wsErr) {
          // 静默
        }

        return { success: true, message: '接单成功', traceId };
      }

      if (action === 'reject') {
        // 拒单：触发重派
        return await this.handleReDispatch(orderNo, `骑手${riderId}拒单`);
      }

      return { success: false, message: '未知操作', traceId };
    } catch (err) {
      console.error(`[${traceId}] 骑手响应处理失败:`, err.message);
      return { success: false, message: err.message, traceId };
    }
  }

  /**
   * 处理重派（骑手拒单/取消后）
   * @param {string} orderNo - 订单编号
   * @param {string} reason - 重派原因
   * @returns {Promise<object>} 重派结果
   */
  async handleReDispatch(orderNo, reason) {
    const traceId = generateTraceId();

    try {
      const [orders] = await pool.query(
        'SELECT * FROM merchant_orders WHERE order_no = ?',
        [orderNo]
      );

      if (orders.length === 0) {
        return { success: false, message: '订单不存在', traceId };
      }

      const order = orders[0];

      // 重置订单状态
      await pool.query(
        'UPDATE merchant_orders SET rider_id = NULL, status = ? WHERE order_no = ?',
        ['pending', orderNo]
      );

      // 记录重派日志
      await pool.query(
        `INSERT INTO dispatch_logs (order_id, rider_id, pool_type, dispatch_time, status, reason, created_at)
         VALUES (?, ?, ?, NOW(), 'reassigned', ?, NOW())`,
        [order.id, order.rider_id, 'basic', reason]
      );

      // 记录 AI dispatch log
      await pool.query(
        `INSERT INTO ai_dispatch_log
           (trace_id, order_id, order_no, pool_type, dispatch_mode, status, fail_reason, dispatch_time, created_at)
         VALUES (?, ?, ?, ?, ?, 'cancelled', ?, NOW(), NOW())`,
        [traceId, order.id, orderNo, 'basic', 'reassign', reason]
      );

      // WebSocket 通知
      try {
        if (order.rider_id) {
          const { emitToRider } = require('../services/websocket');
          emitToRider(order.rider_id, 'ai:cancel', {
            order_no: orderNo,
            reason,
            message: '订单已取消并重新派单',
          });
        }
      } catch (wsErr) {
        // 静默
      }

      // 重新派单（使用扩容后的半径）
      const redispatchResult = await this.dispatchOrder({
        id: order.id,
        order_no: order.order_no,
        distance_km: order.distance_km || 0,
        total_amount: order.order_amount || order.total_amount || 0,
        delivery_fee: order.delivery_fee || 0,
        merchant_name: order.merchant_name || '',
        delivery_address: order.delivery_address || '',
        merchant_latitude: order.pickup_latitude || order.latitude,
        merchant_longitude: order.pickup_longitude || order.longitude,
        is_premium: false,
      }, { expansionCount: 1 });

      return {
        success: redispatchResult.success,
        message: redispatchResult.success ? '重派成功' : '重派失败',
        traceId,
        redispatchResult,
      };
    } catch (err) {
      console.error(`[${traceId}] 重派处理失败:`, err.message);
      return { success: false, message: err.message, traceId };
    }
  }

  /**
   * 获取普惠池基础评分（简化版）
   * @param {object} orderData - 订单数据
   * @param {object} rider - 骑手
   * @param {object} context - 上下文
   * @returns {Promise<object>} 简化评分
   */
  async getBasicScores(orderData, rider, context) {
    try {
      const { calculateDistanceScore, calculateLoadScore, getRiderCurrentOrders } = require('../utils/ai_dispatch_utils');

      const distanceKm = orderData.distance_km || 0;
      const currentOrders = await getRiderCurrentOrders(pool, rider.id);

      return {
        distanceScore: calculateDistanceScore(distanceKm),
        loadScore: calculateLoadScore(currentOrders),
        qualityScore: 15,
        timeEnvScore: 10,
        fairnessScore: 10,
        totalScore: calculateDistanceScore(distanceKm) * 0.3 +
          calculateLoadScore(currentOrders) * 0.25 + 15 * 0.2 + 10 * 0.15 + 10 * 0.1,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * 获取骑手当前进行中的其他订单（排除当前订单）
   * @param {number} riderId - 骑手ID
   * @param {string} excludeOrderNo - 要排除的订单号
   * @returns {Promise<Array<object>>} 进行中的订单列表
   */
  async getRiderOngoingOrders(riderId, excludeOrderNo) {
    try {
      const [rows] = await pool.query(
        `SELECT mo.* FROM merchant_orders mo
         INNER JOIN rider_orders ro ON mo.order_no = ro.order_no
         WHERE ro.rider_id = ?
           AND ro.order_no != ?
           AND ro.status IN ('assigned', 'accepted', 'picking')
           AND mo.status IN ('assigned', 'accepted', 'ready', 'paid')
         ORDER BY mo.created_at ASC`,
        [riderId, excludeOrderNo]
      );
      return rows;
    } catch (err) {
      console.error(`[getRiderOngoingOrders] 获取骑手${riderId}进行中订单失败:`, err.message);
      return [];
    }
  }

  /**
   * 记录派单结果到日志表
   * @param {object} params - 日志参数
   */
  async logDispatchResult(params) {
    try {
      await pool.query(
        `INSERT INTO ai_dispatch_log
           (trace_id, order_id, order_no, rider_id, rider_name, pool_type, dispatch_mode,
            candidate_count, expansion_count, status, fail_reason, dispatch_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, NOW(), NOW())`,
        [
          params.traceId,
          params.orderData.id,
          params.orderData.order_no || '',
          params.riderId || null,
          params.riderName || '',
          params.poolType,
          params.dispatchMode || 'unknown',
          params.candidateCount || 0,
          params.expansionCount || 0,
          params.status,
          params.failReason || '',
        ]
      );
    } catch (err) {
      console.error(`[${params.traceId}] 记录派单日志失败:`, err.message);
    }
  }

  /**
   * 获取各池状态统计
   * @returns {Promise<object>} 各池统计
   */
  async getPoolStatus() {
    try {
      // 查询各池可用骑手数
      const [totalRiders] = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN pool_type IN ('newbie', 'normal') THEN 1 ELSE 0 END) AS basic_candidates,
           SUM(CASE WHEN pool_type = 'intermediate' THEN 1 ELSE 0 END) AS intermediate_candidates,
           SUM(CASE WHEN pool_type = 'advanced' THEN 1 ELSE 0 END) AS advanced_candidates
         FROM riders WHERE status = 'online' AND (freeze_reason IS NULL OR freeze_reason = '')`
      );

      // 查询待分配订单数
      const [pendingOrders] = await pool.query(
        "SELECT COUNT(*) AS count FROM merchant_orders WHERE status = 'pending'"
      );

      // 查询今天AI派单统计
      const [todayStats] = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallback
         FROM ai_dispatch_log
         WHERE DATE(dispatch_time) = CURDATE()`
      );

      return {
        pools: {
          basic: {
            label: '普惠保底池',
            available: totalRiders[0].basic_candidates || 0,
          },
          advanced: {
            label: 'AI择优进阶池',
            available: totalRiders[0].advanced_candidates || 0,
          },
          free: {
            label: '顺路自由池',
            available: totalRiders[0].intermediate_candidates || 0,
          },
        },
        pending_orders: pendingOrders[0].count || 0,
        today_dispatch: todayStats[0] ? {
          total: todayStats[0].total || 0,
          success: todayStats[0].success || 0,
          failed: todayStats[0].failed || 0,
          fallback: todayStats[0].fallback || 0,
        } : { total: 0, success: 0, failed: 0, fallback: 0 },
      };
    } catch (err) {
      console.error('获取池状态失败:', err.message);
      return null;
    }
  }

  /**
   * 获取派单统计
   * @param {string} timeRange - 时间范围: 'today' | 'week' | 'month'
   * @returns {Promise<object>} 统计结果
   */
  async getDispatchStats(timeRange) {
    try {
      let dateCondition;
      switch (timeRange) {
        case 'week':
          dateCondition = 'YEARWEEK(dispatch_time, 1) = YEARWEEK(CURDATE(), 1)';
          break;
        case 'month':
          dateCondition = 'MONTH(dispatch_time) = MONTH(CURDATE()) AND YEAR(dispatch_time) = YEAR(CURDATE())';
          break;
        case 'today':
        default:
          dateCondition = 'DATE(dispatch_time) = CURDATE()';
      }

      const [stats] = await pool.query(
        `SELECT
           COUNT(*) AS total_orders,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_orders,
           SUM(CASE WHEN status IN ('failed', 'timeout') THEN 1 ELSE 0 END) AS failed_orders,
           SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallback_count,
           ROUND(AVG(total_score), 2) AS avg_score,
           pool_type,
           dispatch_mode,
           COUNT(DISTINCT rider_id) AS unique_riders
         FROM ai_dispatch_log
         WHERE ${dateCondition}
         GROUP BY pool_type, dispatch_mode WITH ROLLUP`
      );

      // 各池分布统计
      const [poolDist] = await pool.query(
        `SELECT
           pool_type,
           COUNT(*) AS count,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count
         FROM ai_dispatch_log
         WHERE ${dateCondition}
         GROUP BY pool_type`
      );

      return {
        timeRange,
        details: stats,
        poolDistribution: poolDist,
      };
    } catch (err) {
      console.error('获取派单统计失败:', err.message);
      return null;
    }
  }
}

module.exports = new AiDispatchService();
