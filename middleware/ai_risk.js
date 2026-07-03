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
 * Express 风控中间件注册
 * 提供 riskCheckOnCreate / riskCheckOnAccept 两个路由级中间件
 */
const riskMiddleware = require('../services/ai_risk_middleware');

module.exports = {
  riskCheckOnCreate: riskMiddleware.riskCheckOnCreate.bind(riskMiddleware),
  riskCheckOnAccept: riskMiddleware.riskCheckOnAccept.bind(riskMiddleware),
};
