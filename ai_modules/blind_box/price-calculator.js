'use strict';

/**
 * 盲盒价格计算器
 * 负责折扣价计算与平台补贴计算
 *
 * @module ai_modules/blind_box/price-calculator
 */

const config = require('../../config/ai_modules');

/**
 * 计算盲盒价格与平台补贴
 *
 * 规则：
 * 1. blindboxPrice = originalPrice * discountRate
 * 2. 如果折扣低于配置的最低折扣率，平台补贴差额部分
 * 3. 补贴上限由配置控制
 *
 * @param {number} originalPrice - 餐品原价（元）
 * @param {number} discountRate - 折扣率（如 0.50 表示五折）
 * @returns {{ blindboxPrice: number, platformSubsidy: number }}
 */
function calculateBlindboxPrice(originalPrice, discountRate) {
  // 验证参数
  if (typeof originalPrice !== 'number' || originalPrice <= 0) {
    throw new Error('原价无效');
  }
  if (typeof discountRate !== 'number' || discountRate <= 0 || discountRate > 1) {
    throw new Error('折扣率无效，必须在 0~1 之间');
  }

  const minDiscountRate = config.blindBox.minDiscountRate;
  const maxSubsidy = config.blindBox.maxSubsidyAmount;

  // 计算盲盒价 = 原价 * 折扣率
  const blindboxPrice = Math.round(originalPrice * discountRate * 100) / 100;

  // 计算最低折扣价（使用最低折扣率）
  const minDiscountPrice = Math.round(originalPrice * minDiscountRate * 100) / 100;

  // 平台补贴 = max(0, 最低折扣价 - 盲盒价)，但不能超过补贴上限
  let platformSubsidy = 0;
  if (blindboxPrice < minDiscountPrice) {
    platformSubsidy = Math.round((minDiscountPrice - blindboxPrice) * 100) / 100;
    // 限制补贴上限
    platformSubsidy = Math.min(platformSubsidy, maxSubsidy);
  }

  return {
    blindboxPrice,
    platformSubsidy,
  };
}

/**
 * 计算用户实际支付价格
 *
 * @param {number} blindboxPrice - 盲盒价
 * @param {number} platformSubsidy - 平台补贴
 * @returns {number} 用户支付价
 */
function calculateUserPay(blindboxPrice, platformSubsidy) {
  return Math.round((blindboxPrice - platformSubsidy) * 100) / 100;
}

module.exports = {
  calculateBlindboxPrice,
  calculateUserPay,
};
