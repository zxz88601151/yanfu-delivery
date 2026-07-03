'use strict';

/**
 * 配送费拆账模块
 *
 * 负责：
 * - 按距离比例 × 难度系数拆账
 * - 平台补贴计算
 * - 异常场景拆账
 *
 * @module ai_modules/relay_delivery/fee-splitter
 */

const config = require('../../config/ai_modules');

const difficultyFactors = config.relayDelivery.difficultyFactors || { first: 1.0, middle: 1.1, last: 1.2 };

/**
 * 计算各段的难度系数
 *
 * @param {number} seq - 段序号（从 1 开始）
 * @param {number} totalSegments - 总段数
 * @returns {number}
 */
function calculateDifficultyFactor(seq, totalSegments) {
  if (seq === 1) return difficultyFactors.first;
  if (seq === totalSegments) return difficultyFactors.last;
  return difficultyFactors.middle;
}

/**
 * 按距离比例 × 难度系数拆分配送费
 *
 * 公式：段配送费 = 总配送费 × (段距离 / 总距离) × 段难度系数
 *
 * @param {number} totalFee - 总配送费（元）
 * @param {Array} segments - 分段数据 [{ distance, difficulty_factor, seq }]
 * @returns {number[]} 各段配送费数组
 */
function splitFee(totalFee, segments) {
  const totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);

  if (totalDistance === 0) {
    // 均分
    const avg = +(totalFee / segments.length).toFixed(2);
    return segments.map(() => avg);
  }

  // 计算原始比例
  const rawFees = segments.map((s) => {
    const factor = s.difficulty_factor || calculateDifficultyFactor(s.seq, segments.length);
    return totalFee * (s.distance / totalDistance) * factor;
  });

  const rawTotal = rawFees.reduce((a, b) => a + b, 0);

  // 归一化：总额超出时按比例缩减，总额不足时补齐
  if (rawTotal > 0) {
    const scale = totalFee / rawTotal;
    return rawFees.map((f) => +(f * scale).toFixed(2));
  }

  return rawFees.map((f) => +f.toFixed(2));
}

/**
 * 计算平台补贴金额
 *
 * 规则：拆账总额超过原配送费时，超出部分由平台承担
 *
 * @param {number} totalFee - 原配送费总额
 * @param {number[]} segmentFees - 各段配送费数组
 * @returns {number} 平台补贴金额
 */
function calculatePlatformSubsidy(totalFee, segmentFees) {
  const totalRelayFee = segmentFees.reduce((a, b) => a + b, 0);
  if (totalRelayFee > totalFee) {
    return +(totalRelayFee - totalFee).toFixed(2);
  }
  return 0;
}

/**
 * 计算部分配送费（按已完成距离比例）
 *
 * @param {number} completedDistance - 已完成距离
 * @param {number} totalDistance - 总距离
 * @param {number} totalFee - 总配送费
 * @returns {number}
 */
function calculatePartialFee(completedDistance, totalDistance, totalFee) {
  if (totalDistance === 0) return 0;
  return +((totalFee * completedDistance) / totalDistance).toFixed(2);
}

/**
 * 异常场景拆账
 *
 * @param {string} scenario - 异常场景
 *   front_continue: 前段完成，后段迟到 → 前段继续配送 → 前段获 80%
 *   backup_replace: 前段完成，后段取消 → 备选骑手接替 → 前段正常，备选 90%
 *   front_late: 前段迟到 → 前段扣 10% 补给后段
 *   user_cancel: 用户取消 → 各段按已完成比例结算
 *   goods_damaged: 商品丢失/损坏 → 暂停结算
 * @param {Object} options - 场景参数
 * @returns {Object} { fees: number[], subsidy: number }
 */
function handleAbnormalSplit(scenario, options) {
  const { totalFee, segments, completedSegments } = options;

  switch (scenario) {
    case 'front_continue': {
      // 前段完成（已得全段费用），后段未开始，前段继续配送 → 前段获 80% 总配送费
      const frontFee = +(totalFee * 0.8).toFixed(2);
      return { fees: [frontFee, 0], subsidy: 0 };
    }

    case 'backup_replace': {
      // 前段正常，备选骑手获后段 90%
      const normalFees = splitFee(totalFee, segments);
      const backupFee = +(normalFees[1] * 0.9).toFixed(2);
      const frontFee = normalFees[0];
      return { fees: [frontFee, backupFee], subsidy: 0 };
    }

    case 'front_late': {
      // 前段迟到 → 前段扣 10% 补给后段
      const normalFees = splitFee(totalFee, segments);
      const penalty = +(normalFees[0] * 0.1).toFixed(2);
      return {
        fees: [+(normalFees[0] - penalty).toFixed(2), +(normalFees[1] + penalty).toFixed(2)],
        subsidy: 0,
      };
    }

    case 'user_cancel': {
      // 各段按已完成比例结算
      const fees = segments.map((s, idx) => {
        const completed = completedSegments && completedSegments[idx] ? completedSegments[idx] : 0;
        return calculatePartialFee(completed, s.distance, totalFee / segments.length);
      });
      return { fees, subsidy: 0 };
    }

    case 'goods_damaged':
      // 暂停结算
      return { fees: segments.map(() => 0), subsidy: 0 };

    default:
      return { fees: splitFee(totalFee, segments), subsidy: 0 };
  }
}

module.exports = {
  splitFee,
  calculateDifficultyFactor,
  calculatePlatformSubsidy,
  calculatePartialFee,
  handleAbnormalSplit,
};
