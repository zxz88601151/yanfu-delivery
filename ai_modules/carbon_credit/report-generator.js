'use strict';

/**
 * 碳足迹报告生成器
 *
 * @module ai_modules/carbon_credit/report-generator
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');
const { formatDateTime } = require('../common/date-utils');

/**
 * 生成碳足迹 ESG 报告
 *
 * 统计指定时间范围内的：
 * - 总配送次数
 * - 总减排量（kg CO₂）
 * - 总获得积分
 * - 车辆类型分布
 *
 * @param {number} userId - 用户ID
 * @param {string} startDate - 开始日期 (YYYY-MM-DD)
 * @param {string} endDate - 结束日期 (YYYY-MM-DD)
 * @returns {Promise<Object>} 结构化ESG报告
 */
async function generateReport(userId, startDate, endDate) {
  const connection = await mysql.createConnection(config.db);
  try {
    // 查询指定时间范围内的碳排放记录
    const [emissions] = await connection.query(
      `SELECT * FROM ai_carbon_emissions
       WHERE rider_id = ? AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
       ORDER BY created_at DESC`,
      [userId, startDate, endDate],
    );

    // 查询指定时间范围内的积分变化
    const [creditLogs] = await connection.query(
      `SELECT * FROM ai_carbon_credit_accounts_log
       WHERE user_id = ? AND change_type = 1
       AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [userId, startDate, endDate],
    );

    // 统计总配送次数
    const totalDeliveries = emissions.length;

    // 统计总减排量（每次配送的 saved 总和）
    let totalReduction = 0;
    let electricCount = 0;
    let motorcycleCount = 0;
    let carCount = 0;

    for (const em of emissions) {
      totalReduction += parseFloat(em.saved_vs_motorcycle || 0);
      if (em.vehicle_type === 1) {
        electricCount++;
      } else if (em.vehicle_type === 2) {
        motorcycleCount++;
      } else if (em.vehicle_type === 3) {
        carCount++;
      }
    }

    // 统计总获得积分
    let totalCredits = 0;
    for (const log of creditLogs) {
      totalCredits += log.amount;
    }

    // 计算平均每次减排
    const avgPerDelivery = totalDeliveries > 0
      ? parseFloat((totalReduction / totalDeliveries).toFixed(2))
      : 0;

    return {
      userId,
      period: { startDate, endDate },
      summary: {
        totalDeliveries,
        totalReduction: parseFloat(totalReduction.toFixed(2)),
        totalCredits,
        avgPerDelivery,
      },
      vehicleBreakdown: {
        electric: electricCount,
        motorcycle: motorcycleCount,
        car: carCount,
      },
      generatedAt: formatDateTime(new Date()),
    };
  } finally {
    await connection.end();
  }
}

module.exports = {
  generateReport,
};
