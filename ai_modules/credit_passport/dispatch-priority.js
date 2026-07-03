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

'use strict';

/**
 * 优先派单权重分配
 *
 * @module ai_modules/credit_passport/dispatch-priority
 */

const levelManager = require('./level-manager');

/**
 * 根据骑手信用信息获取派单权重
 *
 * @param {Object} riderCredit - 骑手信用信息
 * @param {number} riderCredit.total_score - 信用总分
 * @param {number} riderCredit.level - 等级数字
 * @param {number} riderCredit.total_orders - 总完成单数
 * @returns {{ level: number, priorityWeight: number, baseScore: number, isEligible: boolean }}
 */
function getDispatchWeight(riderCredit) {
  const totalScore = riderCredit.total_score || 0;
  const level = riderCredit.level || 1;
  const totalOrders = riderCredit.total_orders || 0;

  // 获取等级权益
  const benefits = levelManager.getLevelBenefits(level);

  return {
    level,
    priorityWeight: benefits ? benefits.priorityWeight : 1.0,
    baseScore: totalScore,
    isEligible: totalOrders >= 50,
  };
}

/**
 * 比较多个骑手的派单优先级，按权重从高到低排序
 *
 * @param {Array<Object>} riders - 骑手信用信息数组
 * @param {number} riders[].total_score - 信用总分
 * @param {number} riders[].level - 等级数字
 * @param {number} riders[].total_orders - 总完成单数
 * @returns {Array<{ rider: Object, dispatchInfo: Object }>} 排序后的数组
 */
function compareRiders(riders) {
  if (!Array.isArray(riders) || riders.length === 0) {
    return [];
  }

  // 先计算每个骑手的权重信息
  const withWeights = riders.map((rider) => ({
    rider,
    dispatchInfo: getDispatchWeight(rider),
  }));

  // 排序：
  // 1. 优先 eligible (totalOrders >= 50)
  // 2. 按 priorityWeight 从高到低
  // 3. 按 baseScore 从高到低
  withWeights.sort((a, b) => {
    // eligible 优先
    if (a.dispatchInfo.isEligible !== b.dispatchInfo.isEligible) {
      return a.dispatchInfo.isEligible ? -1 : 1;
    }
    // 权重高优先
    if (a.dispatchInfo.priorityWeight !== b.dispatchInfo.priorityWeight) {
      return b.dispatchInfo.priorityWeight - a.dispatchInfo.priorityWeight;
    }
    // 分数高优先
    return b.dispatchInfo.baseScore - a.dispatchInfo.baseScore;
  });

  return withWeights;
}

module.exports = {
  getDispatchWeight,
  compareRiders,
};
