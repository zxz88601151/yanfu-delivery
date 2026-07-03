/**
 * 盐阜配送 - 风控中间件服务
 * 请求上下文提取 + 决策路由 + WebSocket审核通知
 */
const riskControlService = require('./ai_risk_service');
const { RISK_CONFIG } = require('../config/ai_dispatch');
const { getIO } = require('./websocket');

class RiskMiddleware {
  constructor() {
    this.config = RISK_CONFIG;
  }

  /**
   * 创建订单风控检查（Express中间件格式）
   */
  riskCheckOnCreate(req, res, next) {
    return this._handleRiskCheck(req, res, next, 'create_order', {
      amount: req.body?.total_amount || 0,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      merchant_id: req.body?.merchant_id,
      delivery_address: req.body?.delivery_address,
    });
  }

  /**
   * 接单风控检查
   */
  riskCheckOnAccept(req, res, next) {
    return this._handleRiskCheck(req, res, next, 'accept_order', {
      ip: req.ip || req.connection?.remoteAddress,
      order_id: req.params?.id || req.body?.order_id,
      rider_id: req.user?.id,
    });
  }

  async _handleRiskCheck(req, res, next, action, context) {
    if (!this.config.ENABLED) return next();

    const userType = req.user?.role === 'rider' ? 'rider' 
      : req.user?.role === 'merchant' ? 'merchant' 
      : 'user';
    const userId = req.user?.id;

    if (!userId) return next();

    try {
      const result = await riskControlService.check(userType, userId, action, {
        ...context,
        user_type: userType,
        user_id: userId,
        req_path: req.path,
        req_method: req.method,
      });

      if (result.decision === 'block') {
        // 通知管理端（WebSocket）
        this.notifyAdmin(result);
        return res.status(403).json({
          success: false,
          message: `操作被风控拦截 (${result.trace_id})`,
          trace_id: result.trace_id,
          risk_score: result.score,
        });
      }

      if (result.decision === 'review') {
        this.notifyAdmin(result);
      }

      // 附加风控信息到请求对象
      req.riskInfo = result;
      next();
    } catch (error) {
      console.error('[RISK-MIDDLEWARE] 异常:', error.message);
      next(); // Fail-open
    }
  }

  notifyAdmin(riskResult) {
    try {
      const io = getIO();
      if (io) {
        io.to('admin-room').emit('risk:alert', {
          type: 'risk_alert',
          trace_id: riskResult.trace_id,
          decision: riskResult.decision,
          score: riskResult.score,
          reason: riskResult.reason,
          time: new Date().toISOString(),
        });
      }
    } catch (e) {
      // WebSocket通知失败不阻塞主流程
    }
  }
}

module.exports = new RiskMiddleware();
