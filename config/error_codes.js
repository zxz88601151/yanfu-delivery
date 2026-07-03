'use strict';

/**
 * 错误码映射定义
 * 盲盒配送：1000~1999
 * 动态定价：2000~2999
 * 实时地图：3000~3999
 * 预置运力：4000~4999
 * 接力配送：5000~5999（预留）
 * 信用通行证：6000~6999
 * 碳积分：7000~7999
 * 公共：9000~9999
 *
 * @module config/error_codes
 */

const errorCodes = {
  // ========== 盲盒配送 (1000~1999) ==========
  BLIND_BOX_PARAM_ERROR: { code: 1001, message: '参数错误' },
  BLIND_BOX_POOL_EMPTY: { code: 1001, message: '盲盒池为空' },
  BLIND_BOX_ORDER_NOT_FOUND: { code: 1002, message: '盲盒订单不存在' },
  BLIND_BOX_ORDER_EXPIRED: { code: 1003, message: '盲盒订单已过期' },
  BLIND_BOX_ORDER_STATUS_INVALID: { code: 1004, message: '盲盒订单状态不允许该操作' },
  BLIND_BOX_DISH_NOT_FOUND: { code: 1005, message: '餐品不存在' },
  BLIND_BOX_DISH_OFFLINE: { code: 1006, message: '餐品已下架' },
  BLIND_BOX_STOCK_INSUFFICIENT: { code: 1007, message: '库存不足' },
  BLIND_BOX_NO_MATCH: { code: 1008, message: '未匹配到合适餐品，请调整筛选条件' },
  BLIND_BOX_MATCH_TIMEOUT: { code: 1009, message: '匹配超时，请重新提交' },
  BLIND_BOX_DUPLICATE_ORDER: { code: 1010, message: '已有进行中的盲盒订单' },
  BLIND_BOX_PRICE_CALC_ERROR: { code: 1011, message: '价格计算异常' },
  BLIND_BOX_POOL_FULL: { code: 1012, message: '盲盒池已满，无法添加更多餐品' },
  BLIND_BOX_INVALID_DISCOUNT: { code: 1013, message: '折扣率超出允许范围' },
  BLIND_BOX_DISH_ALREADY_IN_POOL: { code: 1014, message: '餐品已在盲盒池中' },

  // ========== 动态定价 (2000~2999) ==========
  DYNAMIC_PARAM_ERROR: { code: 2001, message: '定价参数错误' },
  DYNAMIC_FACTOR_UNAVAILABLE: { code: 2002, message: '定价因子获取失败' },
  DYNAMIC_INVALID_DISTRICT: { code: 2003, message: '无效的区域ID' },
  DYNAMIC_CONFIG_NOT_FOUND: { code: 2004, message: '定价配置不存在' },
  DYNAMIC_OUT_OF_RANGE: { code: 2005, message: '坐标超出服务范围' },
  DYNAMIC_RATE_LIMITED: { code: 2006, message: '请求过于频繁' },

  // ========== 活地图 (3001~3008) ==========
  LIVE_MAP_REPORT_TOO_FREQUENT: { code: 3001, message: '上报过于频繁，请 5 分钟后再试' },
  LIVE_MAP_VERIFY_NOT_MEET: { code: 3002, message: '验证未达阈值' },
  LIVE_MAP_REPORT_DUPLICATE: { code: 3003, message: '该位置 50 米内已有同类路况上报，请确认是否仍需提交' },
  LIVE_MAP_GPS_MISMATCH: { code: 3004, message: '未检测到您经过该位置附近，请确认路况位置是否正确' },
  LIVE_MAP_CONDITION_NOT_FOUND: { code: 3005, message: '路况记录不存在' },
  LIVE_MAP_CONDITION_ALREADY_EXPIRED: { code: 3006, message: '路况已过期' },
  LIVE_MAP_DAILY_LIMIT_EXCEEDED: { code: 3007, message: '今日上报次数已达上限（20 条）' },
  LIVE_MAP_NEW_RIDER_LIMIT: { code: 3008, message: '新骑手上报额度已用完（每日 5 次）' },

  // ========== 预置运力 (4000~4999) ==========
  PRE_POSITION_PREDICTION_FAILED: { code: 4001, message: '预测失败' },
  PRE_POSITION_RIDER_UNAVAILABLE: { code: 4002, message: '骑手不可调度' },
  PRE_POSITION_PREDICTION_NOT_FOUND: { code: 4003, message: '预测记录不存在' },
  PRE_POSITION_DISPATCH_NOT_FOUND: { code: 4004, message: '调度记录不存在' },
  PRE_POSITION_DISPATCH_EXPIRED: { code: 4005, message: '调度邀请已过期' },
  PRE_POSITION_DISPATCH_ALREADY_RESPONDED: { code: 4006, message: '已对此调度做出响应' },
  PRE_POSITION_INVALID_ACTION: { code: 4007, message: '无效的操作（必须为 accept/reject）' },
  PRE_POSITION_ALREADY_ARRIVED: { code: 4008, message: '已标记到达' },
  PRE_POSITION_NO_AVAILABLE_RIDERS: { code: 4009, message: '无可用骑手可供调度' },
  PRE_POSITION_RIDER_ALREADY_DISPATCHED: { code: 4010, message: '骑手当前已有活跃的预置调度' },
  PRE_POSITION_EVENT_NOT_FOUND: { code: 4011, message: '活动记录不存在' },
  PRE_POSITION_CONFIG_INVALID: { code: 4012, message: '配置参数无效' },

  // ========== 协同配送 (5000~5999) ==========
  RELAY_SPLIT_FAILED: { code: 5001, message: '无法拆分接力配送' },
  RELAY_STATION_UNAVAILABLE: { code: 5002, message: '接力点不可用' },
  RELAY_HANDOFF_NOT_FOUND: { code: 5003, message: '交接记录不存在' },
  RELAY_HANDOFF_STATUS_INVALID: { code: 5004, message: '交接状态不允许该操作' },
  RELAY_ORDER_NOT_FOUND: { code: 5005, message: '接力订单不存在' },
  RELAY_RIDER_MISMATCH: { code: 5006, message: '骑手不匹配该接力段' },
  RELAY_STATION_NOT_FOUND: { code: 5007, message: '接力点不存在' },
  RELAY_TIMEOUT: { code: 5008, message: '交接超时' },

  // ========== 信用护照 (6000~6999) ==========
  CREDIT_RIDER_NOT_FOUND: { code: 6001, message: '骑手信用信息不存在' },
  CREDIT_APPEAL_NOT_FOUND: { code: 6002, message: '申诉记录不存在' },
  CREDIT_APPEAL_DUPLICATE: { code: 6003, message: '该记录已提交申诉，请勿重复提交' },
  CREDIT_INSUFFICIENT: { code: 6004, message: '信用分不足，无法执行该操作' },
  CREDIT_APPEAL_STATUS_INVALID: { code: 6005, message: '申诉状态不允许该操作' },

  // ========== 碳积分 (7000~7999) ==========
  CARBON_INSUFFICIENT_CREDITS: { code: 7001, message: '碳积分不足' },
  CARBON_EXCHANGE_FAILED: { code: 7002, message: '兑换失败，请稍后重试' },
  CARBON_ACCOUNT_NOT_FOUND: { code: 7003, message: '碳积分账户不存在' },
  CARBON_PRODUCT_NOT_FOUND: { code: 7004, message: '兑换商品不存在' },
  CARBON_INVALID_VEHICLE: { code: 7005, message: '无效的车辆类型' },

  // ========== 公共错误 (9000~9999) ==========
  COMMON_INTERNAL_ERROR: { code: 9001, message: '服务器内部错误' },
  COMMON_DATABASE_ERROR: { code: 9002, message: '数据库操作失败' },
  COMMON_UNAUTHORIZED: { code: 9003, message: '未授权访问' },
  COMMON_FORBIDDEN: { code: 9004, message: '无权限执行该操作' },
  COMMON_NOT_FOUND: { code: 9005, message: '资源不存在' },
  COMMON_RATE_LIMITED: { code: 9006, message: '请求过于频繁，请稍后再试' },
  COMMON_MODULE_DISABLED: { code: 9007, message: '该功能模块未启用' },
};

/**
 * 根据错误码获取错误对象
 *
 * @param {number} code - 错误码
 * @returns {{ code: number, message: string }|null}
 */
function getErrorByCode(code) {
  const entries = Object.entries(errorCodes);
  for (const [, value] of entries) {
    if (value.code === code) {
      return { ...value };
    }
  }
  return null;
}

module.exports = errorCodes;
module.exports.getErrorByCode = getErrorByCode;
