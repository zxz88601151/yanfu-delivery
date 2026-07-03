'use strict';

/**
 * 信用分计算模型（4 维加权）
 *
 * @module ai_modules/credit_passport/credit-model
 */

/**
 * 各维度权重配置
 */
const WEIGHTS = {
  on_time_rate: 0.30,
  complaint_rate: 0.25,
  praise_rate: 0.25,
  acceptance_rate: 0.20,
};

/**
 * 各维度分数范围
 */
const SCORE_MIN = 0;
const SCORE_MAX = 1000;

/**
 * 行为对应的分值变化表
 */
const ACTION_CHANGE_MAP = {
  reject_delivery: -10,
  timeout_delivery: -20,
  complained: -30,
  praised: 5,
  completed_order: 1,
  consecutive_100_no_complaint: 20,
};

/**
 * 计算信用总分
 *
 * 维度：
 * - on_time_rate(准时率) × 30%
 * - complaint_rate(客诉率) × 25%（取 1000 - complaint_rate，客诉率越低越好）
 * - praise_rate(好评率) × 25%
 * - acceptance_rate(接单履约率) × 20%
 *
 * @param {Object} dimensions - 各维度分数
 * @param {number} dimensions.on_time_rate - 准时率得分 (0-1000)
 * @param {number} dimensions.complaint_rate - 客诉率得分 (0-1000)
 * @param {number} dimensions.praise_rate - 好评率得分 (0-1000)
 * @param {number} dimensions.acceptance_rate - 接单履约率得分 (0-1000)
 * @returns {number} 加权总分，四舍五入取整，限制在 0-1000
 */
function calculateScore(dimensions) {
  const onTimeRate = Math.max(SCORE_MIN, Math.min(SCORE_MAX, dimensions.on_time_rate || 0));
  const complaintRate = Math.max(SCORE_MIN, Math.min(SCORE_MAX, dimensions.complaint_rate || 0));
  const praiseRate = Math.max(SCORE_MIN, Math.min(SCORE_MAX, dimensions.praise_rate || 0));
  const acceptanceRate = Math.max(SCORE_MIN, Math.min(SCORE_MAX, dimensions.acceptance_rate || 0));

  // 客诉率越低越好，取 1000 - complaintRate 作为正向指标
  const complaintReverse = SCORE_MAX - complaintRate;

  const total = onTimeRate * WEIGHTS.on_time_rate
    + complaintReverse * WEIGHTS.complaint_rate
    + praiseRate * WEIGHTS.praise_rate
    + acceptanceRate * WEIGHTS.acceptance_rate;

  // 四舍五入取整，限制在 0-1000
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(total)));
}

/**
 * 根据行为计算信用分变化量
 *
 * @param {string} action - 行为标识
 * @param {Object} [context] - 上下文（预留扩展）
 * @returns {number} 分差（正数加分，负数扣分）
 */
function getScoreChange(action, context) {
  const change = ACTION_CHANGE_MAP[action];
  if (change === undefined) {
    return 0;
  }
  return change;
}

/**
 * 获取所有支持的行为及其默认分差
 *
 * @returns {Object} 行为-分差映射表
 */
function getActionChangeMap() {
  return { ...ACTION_CHANGE_MAP };
}

module.exports = {
  calculateScore,
  getScoreChange,
  getActionChangeMap,
  SCORE_MIN,
  SCORE_MAX,
  WEIGHTS,
};
