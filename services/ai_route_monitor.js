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
 * 盐阜配送 - 路径监测服务
 * 路况轮询 + 动态重规划
 */
const { pool } = require('../config/database');
const { ROUTE_CONFIG } = require('../config/ai_dispatch');
const RouteOptimizer = require('./ai_route_optimizer');
const { getIO } = require('./websocket');

class RouteMonitor {
  constructor() {
    this.config = ROUTE_CONFIG;
    this.monitoredRoutes = new Map(); // dispatchId -> { riderId, route, interval, lastTraffic }
    this.optimizer = new RouteOptimizer();
    this._cache = new Map();
  }

  /**
   * 开始监测配送路径
   */
  startMonitoring(dispatchId, riderId, route) {
    if (this.monitoredRoutes.has(dispatchId)) return;

    const interval = setInterval(async () => {
      await this.checkTrafficChange(dispatchId);
    }, (this.config.MONITOR_INTERVAL_SECONDS || 60) * 1000);

    this.monitoredRoutes.set(dispatchId, {
      riderId,
      route,
      interval,
      lastTraffic: {},
      startTime: Date.now(),
    });

    console.log(`[ROUTE-MONITOR] 开始监测配送 #${dispatchId}, 骑手 #${riderId}`);
  }

  /**
   * 停止监测
   */
  stopMonitoring(dispatchId) {
    const entry = this.monitoredRoutes.get(dispatchId);
    if (entry) {
      clearInterval(entry.interval);
      this.monitoredRoutes.delete(dispatchId);
      console.log(`[ROUTE-MONITOR] 停止监测配送 #${dispatchId}`);
    }
  }

  /**
   * 检查路况变化
   */
  async checkTrafficChange(dispatchId) {
    const entry = this.monitoredRoutes.get(dispatchId);
    if (!entry) return;

    try {
      // 模拟获取实时路况（生产环境接入高德/百度API）
      const currentTraffic = await this.fetchTrafficStatus(entry.route);
      const lastTraffic = entry.lastTraffic;
      let changed = false;
      let changeDetail = {};

      for (const [key, status] of Object.entries(currentTraffic)) {
        const lastStatus = lastTraffic[key];
        if (lastStatus && lastStatus !== status) {
          const currentWeight = this.config.TRAFFIC_WEIGHTS[status] || 1.0;
          const lastWeight = this.config.TRAFFIC_WEIGHTS[lastStatus] || 1.0;
          const changeRatio = (currentWeight - lastWeight) / lastWeight;

          if (changeRatio > (this.config.TRAFFIC_CHANGE_THRESHOLD || 0.2) ||
              ['congested', 'bad'].includes(status)) {
            changed = true;
            changeDetail[key] = { from: lastStatus, to: status, ratio: Math.round(changeRatio * 100) + '%' };
          }
        }
      }

      entry.lastTraffic = currentTraffic;

      if (changed) {
        await this.triggerReplan(dispatchId, null, null, changeDetail);
      }
    } catch (error) {
      console.error(`[ROUTE-MONITOR] 检查路况异常 #${dispatchId}:`, error.message);
    }
  }

  /**
   * 触发重规划
   */
  async triggerReplan(dispatchId, currentPosition, remainingDeliveries, trafficChange) {
    const entry = this.monitoredRoutes.get(dispatchId);
    if (!entry) return;

    try {
      const oldRoute = entry.route;

      // 如果有剩余配送点，执行重规划
      let newRoute = oldRoute;
      if (remainingDeliveries && remainingDeliveries.length > 0 && currentPosition) {
        const optimizationResult = this.optimizer.optimizeRoute(
          currentPosition,
          remainingDeliveries,
          { trafficAware: true, trafficStatus: entry.lastTraffic }
        );
        newRoute = optimizationResult;
        entry.route = newRoute;
      }

      // 写入重规划事件
      const [result] = await pool.query(
        'INSERT INTO route_replan_events (dispatch_id, rider_id, trigger_reason, old_route, new_route, traffic_change) VALUES (?, ?, ?, ?, ?, ?)',
        [
          dispatchId,
          entry.riderId,
          trafficChange ? '路况恶化' : '手动触发',
          JSON.stringify(oldRoute),
          JSON.stringify(newRoute),
          JSON.stringify(trafficChange || {}),
        ]
      );

      // WebSocket通知骑手
      try {
        const io = getIO();
        if (io) {
          // 发送给骑手
          io.to(`rider-${entry.riderId}`).emit('route:replan', {
            dispatch_id: dispatchId,
            new_route: newRoute,
            reason: '路况变化，路线已优化',
          });
          // 通知管理端
          io.to('admin-room').emit('route:replan-event', {
            event_id: result.insertId,
            dispatch_id: dispatchId,
            rider_id: entry.riderId,
            reason: '路况恶化触发重规划',
            time: new Date().toISOString(),
          });
        }
      } catch (wsErr) {
        // WebSocket通知失败不阻塞
      }

      console.log(`[ROUTE-MONITOR] 配送 #${dispatchId} 已重规划`);
    } catch (error) {
      console.error(`[ROUTE-MONITOR] 重规划失败 #${dispatchId}:`, error.message);
    }
  }

  /**
   * 模拟获取路况（生产环境替换为真实API调用）
   */
  async fetchTrafficStatus(route) {
    const statuses = ['unknown', 'excellent', 'good', 'normal', 'congested', 'bad'];
    const traffic = {};
    if (route && route.segments) {
      for (const seg of route.segments) {
        const key = `${seg.from_index}-${seg.to_index}`;
        traffic[key] = statuses[Math.floor(Math.random() * 4)]; // 偏向正常
      }
    }
    return traffic;
  }

  /**
   * 查询重规划事件历史
   */
  async getReplanEvents(params = {}) {
    let sql = 'SELECT * FROM route_replan_events WHERE 1=1';
    const values = [];

    if (params.dispatch_id) { sql += ' AND dispatch_id = ?'; values.push(Number(params.dispatch_id)); }
    if (params.rider_id) { sql += ' AND rider_id = ?'; values.push(Number(params.rider_id)); }

    sql += ' ORDER BY created_at DESC';

    const page = params.page || 1;
    const pageSize = params.page_size || 20;
    const offset = (page - 1) * pageSize;

    const [countResult] = await pool.query(
      sql.replace('SELECT *', 'SELECT COUNT(*) as total'), values
    );
    sql += ' LIMIT ? OFFSET ?';
    values.push(pageSize, offset);
    const [rows] = await pool.query(sql, values);

    return { list: rows, total: countResult[0].total, page, page_size: pageSize };
  }

  /**
   * 获取监测状态
   */
  getStatus() {
    const routes = [];
    for (const [dispatchId, entry] of this.monitoredRoutes) {
      routes.push({
        dispatch_id: dispatchId,
        rider_id: entry.riderId,
        uptime: Math.floor((Date.now() - entry.startTime) / 1000),
      });
    }
    return { active_monitors: routes.length, routes, config: this.config };
  }
}

module.exports = new RouteMonitor();
