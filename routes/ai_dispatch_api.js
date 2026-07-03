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
 * 盐阜配送 - AI智能派单 API路由
 * 提供AI派单、骑手响应、扩容、重派、管理配置等接口
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const aiDispatchService = require('../services/ai_dispatch_service');
const scoringEngine = require('../services/ai_scoring_engine');
const { SCORE_WEIGHTS, EXPANSION_CONFIG } = require('../config/ai_dispatch');
const { generateTraceId, getWeatherCondition, getTrafficCondition } = require('../utils/ai_dispatch_utils');

/**
 * POST /api/ai/dispatch - AI智能派单入口
 * 接收订单数据，执行AI评分派单
 */
router.post('/dispatch', authMiddleware, async (req, res) => {
  const traceId = generateTraceId();

  try {
    const {
      order_id, order_no, distance_km, merchant_id,
      merchant_name, delivery_address,
      total_amount, delivery_fee, order_amount,
      merchant_latitude, merchant_longitude,
      pickup_latitude, pickup_longitude,
      is_premium,
    } = req.body;

    // 参数校验
    if (!order_id && !order_no) {
      return res.status(400).json({
        success: false,
        message: '缺少订单标识（order_id 或 order_no）',
        traceId,
      });
    }

    // 查询订单信息（如果只传了order_no）
    let orderData = req.body;
    if (!order_id && order_no) {
      const [orders] = await pool.query(
        "SELECT * FROM merchant_orders WHERE order_no = ? AND status = 'pending'",
        [order_no]
      );
      if (orders.length > 0) {
        orderData = { ...orderData, ...orders[0] };
      } else {
        return res.status(404).json({
          success: false,
          message: '订单不存在或已被处理',
          traceId,
        });
      }
    }

    // 检查订单是否已经被分配
    if (orderData.rider_id) {
      return res.status(400).json({
        success: false,
        message: '订单已被分配',
        rider_id: orderData.rider_id,
        traceId,
      });
    }

    // 执行AI派单
    const result = await aiDispatchService.dispatchOrder({
      id: orderData.id || orderData.order_id,
      order_no: orderData.order_no || order_no,
      distance_km: parseFloat(distance_km) || 0,
      total_amount: parseFloat(total_amount || order_amount || 0),
      delivery_fee: parseFloat(delivery_fee || 0),
      merchant_name: merchant_name || '',
      delivery_address: delivery_address || '',
      merchant_latitude: parseFloat(merchant_latitude || pickup_latitude || 0),
      merchant_longitude: parseFloat(merchant_longitude || pickup_longitude || 0),
      is_premium: is_premium === true || is_premium === 'true',
    });

    if (result.success) {
      return res.json({
        success: true,
        message: 'AI智能派单成功',
        data: {
          order_id: orderData.id || orderData.order_id,
          order_no: orderData.order_no || order_no,
          rider_id: result.rider.id,
          rider_name: result.rider.name,
          rider_phone: result.rider.phone,
          pool_type: result.poolType,
          dispatch_mode: result.dispatchMode,
          ai_score: result.scores ? result.scores.totalScore : null,
          dispatch_time: new Date().toISOString(),
        },
        traceId,
      });
    }

    // 派单失败
    if (result.needExpansion) {
      return res.json({
        success: false,
        message: '暂无可用骑手，需要扩容',
        needExpansion: true,
        traceId,
      });
    }

    return res.status(404).json({
      success: false,
      message: 'AI派单失败，无可用骑手',
      traceId,
    });
  } catch (err) {
    console.error(`[${traceId}] AI派单入口异常:`, err.message);
    res.status(500).json({
      success: false,
      message: 'AI派单异常: ' + err.message,
      traceId,
    });
  }
});

/**
 * POST /api/ai/dispatch/:orderNo/response - 骑手接单/拒单
 */
router.post('/dispatch/:orderNo/response', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.params;
    const { rider_id, action } = req.body;

    if (!rider_id || !action) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数（rider_id, action）',
      });
    }

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'action 必须为 accept 或 reject',
      });
    }

    const result = await aiDispatchService.handleRiderResponse(orderNo, rider_id, action);

    return res.json(result);
  } catch (err) {
    console.error('骑手响应处理异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/ai/dispatch/:orderNo/expand - 扩容（10秒无人接）
 */
router.post('/dispatch/:orderNo/expand', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.params;
    const { expansion_count } = req.body;

    const [orders] = await pool.query(
      "SELECT * FROM merchant_orders WHERE order_no = ? AND status = 'pending'",
      [orderNo]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在或已分配' });
    }

    const order = orders[0];
    const expansionCount = (expansion_count || 0) + 1;

    if (expansionCount > EXPANSION_CONFIG.MAX_EXPANSIONS) {
      // 已达最大扩容次数，走降级
      const result = await aiDispatchService.fallbackDispatch(
        order,
        generateTraceId(),
        'basic',
        expansionCount
      );

      return res.json({
        success: result.success,
        message: result.success ? '扩容后降级派单成功' : '扩容后降级派单失败',
        data: result,
      });
    }

    // 扩容重试（半径递增）
    const radiusMeters = EXPANSION_CONFIG.INITIAL_RADIUS_METERS + expansionCount * EXPANSION_CONFIG.EXPAND_STEP_METERS;

    const result = await aiDispatchService.dispatchOrder({
      id: order.id,
      order_no: order.order_no,
      distance_km: parseFloat(order.distance_km || 0),
      total_amount: parseFloat(order.order_amount || 0),
      delivery_fee: parseFloat(order.delivery_fee || 0),
      merchant_name: order.rider_name || '',
      delivery_address: order.delivery_address || '',
      merchant_latitude: parseFloat(order.pickup_latitude || 0),
      merchant_longitude: parseFloat(order.pickup_longitude || 0),
      is_premium: false,
    }, { radiusMeters, expansionCount });

    // 通知扩容事件
    try {
      const { broadcastToRiders } = require('../services/websocket');
      broadcastToRiders('ai:expansion', {
        order_no: orderNo,
        expansion_count: expansionCount,
        radius_meters: radiusMeters,
        timestamp: new Date().toISOString(),
      });
    } catch (wsErr) {
      // 静默
    }

    return res.json({
      success: result.success,
      message: result.success ? '扩容派单成功' : '扩容派单失败',
      data: {
        expansion_count: expansionCount,
        radius_meters: radiusMeters,
        result,
      },
    });
  } catch (err) {
    console.error('扩容处理异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/ai/dispatch/:orderNo/redispatch - 骑手取消后重派
 */
router.post('/dispatch/:orderNo/redispatch', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.params;
    const { reason } = req.body;

    const result = await aiDispatchService.handleReDispatch(orderNo, reason || '骑手取消重派');

    return res.json(result);
  } catch (err) {
    console.error('重派处理异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/ai/score/calculate - 手动触发评分计算（测试用）
 */
router.post('/score/calculate', authMiddleware, async (req, res) => {
  try {
    const { order_id, rider_ids } = req.body;

    if (!order_id) {
      return res.status(400).json({ success: false, message: '缺少 order_id' });
    }

    // 获取订单信息
    const [orders] = await pool.query('SELECT * FROM merchant_orders WHERE id = ?', [order_id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];

    // 获取指定骑手或所有候选骑手
    let riders;
    if (rider_ids && rider_ids.length > 0) {
      const placeholders = rider_ids.map(() => '?').join(',');
      const [riderRows] = await pool.query(
        `SELECT * FROM riders WHERE id IN (${placeholders}) AND status = 'online'`,
        rider_ids
      );
      riders = riderRows;
    } else {
      riders = await scoringEngine.getCandidateRiders({
        id: order.id,
        distance_km: parseFloat(order.distance_km || 0),
        merchant_latitude: parseFloat(order.pickup_latitude || 0),
        merchant_longitude: parseFloat(order.pickup_longitude || 0),
      });
    }

    // 执行评分
    const scoredRiders = await scoringEngine.scoreRidersForOrder(order, riders, {
      hour: new Date().getHours(),
      weather: await getWeatherCondition(),
      traffic: await getTrafficCondition(),
    });

    const formattedResults = scoredRiders.map(item => ({
      rider_id: item.rider.id,
      rider_name: item.rider.name,
      rider_phone: item.rider.phone,
      distance_to_merchant_km: item.rider.distance_to_merchant_km || null,
      ...item.scores,
      tier: item.tierLabel,
    }));

    return res.json({
      success: true,
      data: {
        order_id,
        order_no: order.order_no,
        total_candidates: formattedResults.length,
        results: formattedResults,
        weather: await getWeatherCondition(),
        traffic: await getTrafficCondition(),
        hour: new Date().getHours(),
      },
    });
  } catch (err) {
    console.error('评分计算异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/ai/admin/weights - 获取权重配置
 */
router.get('/admin/weights', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [weights] = await pool.query(
      'SELECT weight_key, weight_name, weight_value, is_active, updated_at FROM ai_dispatch_weights WHERE is_active = 1'
    );

    const weightMap = {};
    for (const w of weights) {
      weightMap[w.weight_key] = {
        name: w.weight_name,
        value: parseFloat(w.weight_value),
        updated_at: w.updated_at,
      };
    }

    return res.json({
      success: true,
      data: {
        weights: weightMap,
        expansion_config: EXPANSION_CONFIG,
        default_weights: SCORE_WEIGHTS,
      },
    });
  } catch (err) {
    console.error('获取权重配置异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/ai/admin/weights - 更新权重配置
 */
router.post('/admin/weights', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { weights } = req.body;

    if (!weights || typeof weights !== 'object') {
      return res.status(400).json({ success: false, message: '缺少 weights 参数' });
    }

    for (const [key, value] of Object.entries(weights)) {
      if (typeof value === 'number' && value >= 0 && value <= 1) {
        await pool.query(
          'UPDATE ai_dispatch_weights SET weight_value = ?, updated_at = NOW() WHERE weight_key = ?',
          [value, key]
        );
      }
    }

    // 返回更新后的配置
    const [updatedWeights] = await pool.query(
      'SELECT weight_key, weight_name, weight_value, is_active FROM ai_dispatch_weights WHERE is_active = 1'
    );

    return res.json({
      success: true,
      message: '权重配置更新成功',
      data: updatedWeights,
    });
  } catch (err) {
    console.error('更新权重配置异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/ai/admin/stats - 派单统计
 */
router.get('/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const timeRange = req.query.timeRange || 'today';

    // 获取池状态
    const poolStatus = await aiDispatchService.getPoolStatus();

    // 获取派单统计
    const dispatchStats = await aiDispatchService.getDispatchStats(timeRange);

    return res.json({
      success: true,
      data: {
        pool_status: poolStatus,
        dispatch_stats: dispatchStats,
      },
    });
  } catch (err) {
    console.error('获取派单统计异常:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
