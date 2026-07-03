'use strict';

/**
 * AI 盲盒匹配引擎
 * 实现智能餐品匹配逻辑，包含折扣排序、折中策略、随机因子、新店权重
 *
 * @module ai_modules/blind_box/matching-engine
 */

const poolManager = require('./pool-manager');
const { getErrorByCode } = require('../../config/error_codes');

/**
 * 匹配盲盒订单到合适的餐品
 *
 * 策略：
 * 1. 从 pool-manager 获取符合条件的餐品列表
 * 2. 按折扣率由高到低排序（高折扣优先给用户）
 * 3. 折中策略：不选折扣最高的（太便宜商家亏），不选折扣最低的（用户不划算），选中间区域
 * 4. 加入随机因子（惊喜感）：在前 30% 的餐品中随机选取
 * 5. 对新店/首发标记餐品给予 2x 权重
 * 6. 如果没有任何匹配餐品，返回错误 1001 "盲盒池为空"
 *
 * @param {Object} userOrder - 用户订单
 * @param {number} userOrder.budget_min - 预算下限
 * @param {number} userOrder.budget_max - 预算上限
 * @param {string[]} userOrder.taste_tags - 口味标签
 * @param {number} userOrder.district_id - 区域ID
 * @returns {{ dish: Object, blindboxPrice: number, platformSubsidy: number }}
 * @throws {Error} 当没有匹配餐品时抛出错误
 */
async function match(userOrder) {
  const { budget_min, budget_max, taste_tags, district_id } = userOrder;

  // 1. 获取符合条件的餐品
  const availableDishes = await poolManager.getAvailableDishes(
    district_id,
    taste_tags,
    budget_min,
    budget_max,
  );

  // 2. 没有匹配餐品
  if (!availableDishes || availableDishes.length === 0) {
    const error = getErrorByCode(1001);
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  // 3. 按折扣率降序排序（高折扣在前）
  const sortedDishes = [...availableDishes].sort((a, b) => {
    return parseFloat(b.discount_rate) - parseFloat(a.discount_rate);
  });

  // 4. 计算权重并重新排序
  const weightedDishes = sortedDishes.map((dish) => {
    let weight = 1.0;
    // 新店/首发标记餐品给予 2x 权重
    if (dish.is_featured) {
      weight *= 2.0;
    }
    return { dish, weight };
  });

  // 5. 按权重扩展后在候选池中选取
  // 构建加权候选列表（每个餐品按权重出现多次）
  const candidates = [];
  for (const item of weightedDishes) {
    const repeatCount = Math.round(item.weight);
    for (let i = 0; i < repeatCount; i++) {
      candidates.push(item.dish);
    }
  }

  // 6. 折中策略：取前 30% 的候选作为"惊喜池"，从中随机选取
  const topPercent = 0.3;
  const poolSize = Math.max(1, Math.ceil(candidates.length * topPercent));
  const surprisePool = candidates.slice(0, poolSize);

  // 7. 从惊喜池中随机选取
  if (!surprisePool || surprisePool.length === 0) {
    throw Object.assign(new Error('盲盒池为空，无可匹配餐品'), { code: 1001 });
  }
  const randomIndex = Math.floor(Math.random() * surprisePool.length);
  const matchedDish = surprisePool[randomIndex];

  return {
    dish: matchedDish,
    blindboxPrice: parseFloat(matchedDish.blindbox_price),
    originalPrice: parseFloat(matchedDish.original_price),
    platformSubsidy: 0, // 由 price-calculator 计算
  };
}

module.exports = {
  match,
};
