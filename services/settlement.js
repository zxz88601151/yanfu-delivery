'use strict';

/**
 * 自动结算服务
 * 每日凌晨自动生成商户结算单，计算佣金和应结金额
 *
 * @module services/settlement
 */

const { pool } = require('../config/database');

/**
 * 执行 T+1 自动结算
 * 对前一日所有已完成订单进行结算计算
 *
 * @param {Date} [settlementDate] - 结算日期（默认昨日）
 * @returns {Promise<Object>} 结算结果
 */
async function runDailySettlement(settlementDate) {
  const date = settlementDate || new Date(Date.now() - 86400000);
  const periodStart = date.toISOString().slice(0, 10) + ' 00:00:00';
  const periodEnd = date.toISOString().slice(0, 10) + ' 23:59:59';
  const periodLabel = date.toISOString().slice(0, 10);

  console.log(`[Settlement] 开始 T+1 自动结算: ${periodLabel}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 查询前一天所有已完成订单，按商家汇总
    const [orders] = await conn.query(
      `SELECT
        mo.merchant_id,
        COUNT(*) AS order_count,
        COALESCE(SUM(mo.actual_amount), 0) AS gross_amount,
        mc.commission_rate
      FROM merchant_orders mo
      LEFT JOIN merchant_contracts mc ON mc.merchant_id = mo.merchant_id
      WHERE mo.status = 'completed'
        AND mo.delivered_at >= ?
        AND mo.delivered_at <= ?
      GROUP BY mo.merchant_id`,
      [periodStart, periodEnd]
    );

    if (orders.length === 0) {
      console.log('[Settlement] 无待结算订单');
      await conn.rollback();
      return { settled: 0, period: periodLabel, merchants: [] };
    }

    const results = [];

    for (const order of orders) {
      const commissionRate = parseFloat(order.commission_rate || 8.0) / 100;
      const grossAmount = parseFloat(order.gross_amount);
      const commission = parseFloat((grossAmount * commissionRate).toFixed(2));
      const netAmount = parseFloat((grossAmount - commission).toFixed(2));

      // 2. 检查是否已存在该日结算单（幂等性）
      const [existing] = await conn.query(
        `SELECT id FROM merchant_settlements
         WHERE merchant_id = ? AND period_start = ? AND period_end = ?
         LIMIT 1`,
        [order.merchant_id, periodLabel, periodLabel]
      );

      if (existing.length > 0) {
        console.log(`[Settlement] 商家#${order.merchant_id} ${periodLabel} 已结算，跳过`);
        continue;
      }

      // 3. 插入结算单
      const [insertResult] = await conn.query(
        `INSERT INTO merchant_settlements
         (merchant_id, period_start, period_end, order_count, gross_amount, commission, net_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [order.merchant_id, periodLabel, periodLabel, order.order_count, grossAmount, commission, netAmount]
      );

      console.log(
        `[Settlement] 商家#${order.merchant_id}: ${order.order_count}单, ` +
        `总额¥${grossAmount}, 佣金¥${commission}(${(commissionRate*100).toFixed(1)}%), 应结¥${netAmount}`
      );

      results.push({
        settlementId: insertResult.insertId,
        merchantId: order.merchant_id,
        orderCount: order.order_count,
        grossAmount,
        commission,
        netAmount,
      });
    }

    await conn.commit();

    console.log(`[Settlement] 结算完成: ${results.length} 个商家`);
    return { settled: results.length, period: periodLabel, merchants: results };
  } catch (err) {
    await conn.rollback();
    console.error('[Settlement] 结算失败:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { runDailySettlement };
