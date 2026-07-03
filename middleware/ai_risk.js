/**
 * Express 风控中间件注册
 * 提供 riskCheckOnCreate / riskCheckOnAccept 两个路由级中间件
 */
const riskMiddleware = require('../services/ai_risk_middleware');

module.exports = {
  riskCheckOnCreate: riskMiddleware.riskCheckOnCreate.bind(riskMiddleware),
  riskCheckOnAccept: riskMiddleware.riskCheckOnAccept.bind(riskMiddleware),
};
