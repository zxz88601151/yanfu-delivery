'use strict';

/**
 * 绿色时段激励
 *
 * @module ai_modules/carbon_credit/green-incentive
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { getTimeSlot } = require('../common/date-utils');

/**
 * 获取绿色时段激励
 *
 * 午高峰(11:00-13:00) + 晚高峰(17:00-19:00) 使用电动车配送，额外奖励 5 积分/单
 * 持续7天使用电动车配送 → 额外奖励 50 积分/周
 *
 * @param {number} vehicleType - 车辆类型（1=电动车才触发奖励）
 * @param {Date|string} [orderTime] - 订单时间，默认当前时间
 * @param {number} [riderId] - 骑手ID（用于长期激励检查）
 * @returns {Promise<{ bonus: number, reason: string }>}
 */
async function getGreenBonus(vehicleType, orderTime, riderId) {
  // 必须为电动车才触发奖励
  if (vehicleType !== 1) {
    return { bonus: 0, reason: '' };
  }

  const orderDate = orderTime ? new Date(orderTime) : new Date();
  const timeSlot = getTimeSlot(orderDate);

  // 时段判断：午高峰(11:00-13:00)对应 lunch, 晚高峰(17:00-19:00)对应 dinner
  // getTimeSlot 返回 lunch 是 11-14, dinner 是 17-21
  // 我们需要精确判断 11-13 和 17-19
  const hour = orderDate.getHours();

  // 午高峰 11:00-13:00
  if (hour >= 11 && hour < 13) {
    // 检查长期激励
    if (riderId) {
      const weeklyBonus = await _checkWeeklyStreak(riderId);
      if (weeklyBonus.bonus > 0) {
        return weeklyBonus;
      }
    }
    // 时段激励
    return { bonus: 5, reason: '高峰绿色配送奖励' };
  }

  // 晚高峰 17:00-19:00
  if (hour >= 17 && hour < 19) {
    // 检查长期激励
    if (riderId) {
      const weeklyBonus = await _checkWeeklyStreak(riderId);
      if (weeklyBonus.bonus > 0) {
        return weeklyBonus;
      }
    }
    // 时段激励
    return { bonus: 5, reason: '高峰绿色配送奖励' };
  }

  // 非高峰时段，检查长期激励
  if (riderId) {
    const weeklyBonus = await _checkWeeklyStreak(riderId);
    if (weeklyBonus.bonus > 0) {
      return weeklyBonus;
    }
  }

  return { bonus: 0, reason: '' };
}

/**
 * 检查骑手近7天电动车配送连续达标情况
 *
 * @param {number} riderId - 骑手ID
 * @returns {Promise<{ bonus: number, reason: string }>}
 * @private
 */
async function _checkWeeklyStreak(riderId) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询近7天电动车配送单数
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS cnt FROM ai_carbon_emissions
       WHERE rider_id = ? AND vehicle_type = 1
       AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [riderId],
    );

    const count = rows[0].cnt;

    // 满7单奖励50积分
    if (count >= 7) {
      return { bonus: 50, reason: '连续7天绿色配送奖励' };
    }

    return { bonus: 0, reason: '' };
  } finally {
    await connection.end();
  }
}

/**
 * 获取激励政策说明文字
 *
 * @returns {Array<{ title: string, description: string }>}
 */
function getIncentiveDescription() {
  return [
    {
      title: '高峰绿色配送奖励',
      description: '午高峰(11:00-13:00)或晚高峰(17:00-19:00)使用电动车配送，每单额外奖励5碳积分',
    },
    {
      title: '连续绿行奖励',
      description: '连续7天使用电动车配送，额外奖励50碳积分/周',
    },
    {
      title: '电动车配送奖励',
      description: '使用电动车完成配送（里程≥1000米），每单奖励10碳积分',
    },
    {
      title: '摩托车配送奖励',
      description: '使用摩托车完成配送，每单奖励5碳积分',
    },
  ];
}

module.exports = {
  getGreenBonus,
  getIncentiveDescription,
};
