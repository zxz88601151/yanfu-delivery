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
 * 盐阜配送 - 出餐时间管理路由
 * 商家出餐时间预估、实时统计、预警
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, merchantMiddleware } = require('../middleware/auth');

/**
 * POST /api/prep-time/calculate
 * 计算商家出餐时间
 */
router.post('/calculate', authMiddleware, async (req, res) => {
  try {
    const {
      merchant_id,
      order_items,
      order_amount,
      is_peak,
      weather
    } = req.body;

    // 1. 获取商家历史出餐数据
    const merchantStats = await getMerchantPrepStats(merchant_id);

    // 2. 计算预估出餐时间
    const prepTime = await calculatePrepTime({
      merchant_id,
      order_items,
      order_amount,
      is_peak,
      weather,
      merchantStats
    });

    // 3. 保存预估记录
    await savePrepTimeEstimate({
      merchant_id,
      estimated_minutes: prepTime.estimated_minutes,
      confidence: prepTime.confidence,
      breakdown: prepTime.breakdown
    });

    res.json({
      success: true,
      data: {
        merchant_id,
        estimated_minutes: prepTime.estimated_minutes,
        estimated_timestamp: prepTime.estimated_timestamp,
        confidence: prepTime.confidence,
        breakdown: prepTime.breakdown,
        suggestions: prepTime.suggestions
      }
    });

  } catch (error) {
    console.error('出餐时间计算失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/prep-time/merchant/:merchantId
 * 获取商家出餐统计
 */
router.get('/merchant/:merchantId', authMiddleware, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { days = 7 } = req.query;

    // 获取历史出餐时间统计
    const [stats] = await pool.query(
      `SELECT 
        AVG(prep_time_actual) as avg_prep_time,
        MIN(prep_time_actual) as min_prep_time,
        MAX(prep_time_actual) as max_prep_time,
        COUNT(*) as total_orders,
        SUM(CASE WHEN is_overtime = 1 THEN 1 ELSE 0 END) as overtime_count
       FROM orders 
       WHERE merchant_id = ? 
         AND prep_time_actual IS NOT NULL
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [merchantId, parseInt(days)]
    );

    // 获取时段分布
    const [timeDistribution] = await pool.query(
      `SELECT 
        HOUR(created_at) as hour,
        AVG(prep_time_actual) as avg_prep_time,
        COUNT(*) as order_count
       FROM orders 
       WHERE merchant_id = ? 
         AND prep_time_actual IS NOT NULL
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY HOUR(created_at)
       ORDER BY hour`,
      [merchantId, parseInt(days)]
    );

    // 获取品类出餐时间
    const [categoryStats] = await pool.query(
      `SELECT 
        category_name,
        AVG(prep_time_actual) as avg_prep_time,
        COUNT(*) as order_count
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE o.merchant_id = ? 
         AND o.prep_time_actual IS NOT NULL
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY mc.id, mc.name
       ORDER BY avg_prep_time DESC`,
      [merchantId, parseInt(days)]
    );

    res.json({
      success: true,
      data: {
        merchant_id: merchantId,
        period_days: parseInt(days),
        overall_stats: stats[0],
        time_distribution: timeDistribution,
        category_stats: categoryStats
      }
    });

  } catch (error) {
    console.error('获取商家出餐统计失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/prep-time/actual
 * 记录实际出餐时间
 */
router.post('/actual', authMiddleware, async (req, res) => {
  try {
    const { order_id, actual_minutes, reason } = req.body;

    // 1. 获取订单预估出餐时间
    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ?',
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];
    const isOvertime = order.prep_time_estimate && actual_minutes > order.prep_time_estimate;

    // 2. 更新订单实际出餐时间
    await pool.query(
      `UPDATE orders 
       SET prep_time_actual = ?, 
           is_overtime = ?,
           prep_completed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [actual_minutes, isOvertime ? 1 : 0, order_id]
    );

    // 3. 如果超时，记录原因
    if (isOvertime && reason) {
      await pool.query(
        `INSERT INTO prep_time_exceptions 
         (order_id, merchant_id, estimated_minutes, actual_minutes, reason, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [order_id, order.merchant_id, order.prep_time_estimate, actual_minutes, reason]
      );
    }

    // 4. 更新商家出餐统计数据
    await updateMerchantPrepStats(order.merchant_id);

    res.json({
      success: true,
      message: '实际出餐时间已记录',
      data: {
        order_id,
        actual_minutes,
        is_overtime: isOvertime,
        variance: isOvertime ? actual_minutes - order.prep_time_estimate : 0
      }
    });

  } catch (error) {
    console.error('记录实际出餐时间失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/prep-time/alerts
 * 获取出餐预警列表
 */
router.get('/alerts', authMiddleware, async (req, res) => {
  try {
    const { merchant_id, status = 'active' } = req.query;

    let sql = `
      SELECT 
        o.id as order_id,
        o.order_no,
        o.merchant_id,
        m.name as merchant_name,
        o.prep_time_estimate,
        o.prep_time_actual,
        TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) as elapsed_minutes,
        o.status
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.status IN ('pending', 'preparing')
        AND o.prep_time_estimate IS NOT NULL
        AND o.prep_time_actual IS NULL
    `;

    const params = [];

    if (merchant_id) {
      sql += ' AND o.merchant_id = ?';
      params.push(merchant_id);
    }

    // 找出可能超时的订单（已过预估时间的80%）
    sql += ` HAVING elapsed_minutes >= prep_time_estimate * 0.8`;

    sql += ` ORDER BY elapsed_minutes DESC`;

    const [alerts] = await pool.query(sql, params);

    // 标记预警级别
    const alertsWithLevel = alerts.map(alert => {
      const progress = alert.elapsed_minutes / alert.prep_time_estimate;
      let level = 'low';
      if (progress >= 1.2) level = 'high';
      else if (progress >= 1.0) level = 'medium';
      else if (progress >= 0.8) level = 'low';

      return {
        ...alert,
        progress_percent: Math.round(progress * 100),
        alert_level: level,
        remaining_minutes: Math.max(0, alert.prep_time_estimate - alert.elapsed_minutes)
      };
    });

    res.json({
      success: true,
      data: {
        total_alerts: alertsWithLevel.length,
        high_risk: alertsWithLevel.filter(a => a.alert_level === 'high').length,
        medium_risk: alertsWithLevel.filter(a => a.alert_level === 'medium').length,
        alerts: alertsWithLevel
      }
    });

  } catch (error) {
    console.error('获取出餐预警失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/prep-time/exceptions
 * 获取出餐异常记录
 */
router.get('/exceptions', authMiddleware, async (req, res) => {
  try {
    const { merchant_id, days = 7 } = req.query;

    let sql = `
      SELECT 
        pe.*,
        o.order_no,
        m.name as merchant_name
      FROM prep_time_exceptions pe
      JOIN orders o ON pe.order_id = o.id
      JOIN merchants m ON pe.merchant_id = m.id
      WHERE pe.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;

    const params = [parseInt(days)];

    if (merchant_id) {
      sql += ' AND pe.merchant_id = ?';
      params.push(merchant_id);
    }

    sql += ' ORDER BY pe.created_at DESC';

    const [exceptions] = await pool.query(sql, params);

    // 统计异常原因
    const reasonStats = {};
    exceptions.forEach(e => {
      reasonStats[e.reason] = (reasonStats[e.reason] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        total_exceptions: exceptions.length,
        reason_stats: reasonStats,
        exceptions: exceptions
      }
    });

  } catch (error) {
    console.error('获取出餐异常失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取商家出餐统计数据
 */
async function getMerchantPrepStats(merchantId) {
  const [stats] = await pool.query(
    `SELECT 
      AVG(prep_time_actual) as avg_prep_time,
      STDDEV(prep_time_actual) as std_dev,
      COUNT(*) as total_orders,
      AVG(CASE WHEN HOUR(created_at) BETWEEN 11 AND 13 THEN prep_time_actual END) as lunch_avg,
      AVG(CASE WHEN HOUR(created_at) BETWEEN 17 AND 19 THEN prep_time_actual END) as dinner_avg
     FROM orders 
     WHERE merchant_id = ? 
       AND prep_time_actual IS NOT NULL
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [merchantId]
  );

  return stats[0] || {
    avg_prep_time: 15,
    std_dev: 5,
    total_orders: 0,
    lunch_avg: 18,
    dinner_avg: 20
  };
}

/**
 * 计算出餐时间
 */
async function calculatePrepTime({ merchant_id, order_items, order_amount, is_peak, weather, merchantStats }) {
  // 1. 基础出餐时间
  let baseTime = merchantStats.avg_prep_time || 15;

  // 2. 订单复杂度（根据商品数量）
  const itemCount = order_items ? order_items.length : 1;
  const complexityTime = Math.min(itemCount * 2, 10);

  // 3. 高峰时段加成
  let peakFactor = 1.0;
  if (is_peak) {
    peakFactor = 1.3;
    baseTime = merchantStats.lunch_avg || merchantStats.dinner_avg || baseTime;
  }

  // 4. 订单金额加成（大额订单可能需要更多准备时间）
  const amountFactor = order_amount > 100 ? 1.1 : 1.0;

  // 5. 天气影响（恶劣天气可能影响食材准备）
  const weatherFactor = weather === 'rain' || weather === 'snow' ? 1.1 : 1.0;

  // 计算预估时间
  const estimatedMinutes = Math.round(
    (baseTime + complexityTime) * peakFactor * amountFactor * weatherFactor
  );

  // 计算置信度
  const confidence = calculatePrepConfidence(merchantStats);

  // 生成建议
  const suggestions = [];
  if (is_peak) suggestions.push('当前为高峰时段，建议提前准备');
  if (itemCount > 5) suggestions.push('订单商品较多，建议分批出餐');
  if (weather === 'rain') suggestions.push('雨天路滑，建议提前出餐');

  return {
    estimated_minutes: estimatedMinutes,
    estimated_timestamp: new Date(Date.now() + estimatedMinutes * 60000).toISOString(),
    confidence: confidence,
    breakdown: {
      base_time: Math.round(baseTime),
      complexity_time: complexityTime,
      peak_factor: peakFactor,
      amount_factor: amountFactor,
      weather_factor: weatherFactor
    },
    suggestions: suggestions
  };
}

/**
 * 保存出餐时间预估
 */
async function savePrepTimeEstimate({ merchant_id, estimated_minutes, confidence, breakdown }) {
  await pool.query(
    `INSERT INTO prep_time_estimates 
     (merchant_id, estimated_minutes, confidence, breakdown, created_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [merchant_id, estimated_minutes, confidence, JSON.stringify(breakdown)]
  );
}

/**
 * 更新商家出餐统计
 */
async function updateMerchantPrepStats(merchantId) {
  // 重新计算30天统计数据
  const [stats] = await pool.query(
    `SELECT 
      AVG(prep_time_actual) as avg_prep_time,
      COUNT(*) as total_orders
     FROM orders 
     WHERE merchant_id = ? 
       AND prep_time_actual IS NOT NULL
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [merchantId]
  );

  if (stats[0].total_orders > 0) {
    await pool.query(
      `INSERT INTO merchant_prep_stats 
       (merchant_id, avg_prep_time, total_orders, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       avg_prep_time = VALUES(avg_prep_time),
       total_orders = VALUES(total_orders),
       updated_at = VALUES(updated_at)`,
      [merchantId, stats[0].avg_prep_time, stats[0].total_orders]
    );
  }
}

/**
 * 计算出餐时间置信度
 */
function calculatePrepConfidence(stats) {
  let confidence = 0.75;

  // 数据量越大，置信度越高
  if (stats.total_orders > 100) confidence += 0.1;
  if (stats.total_orders > 500) confidence += 0.05;

  // 标准差越小，置信度越高
  if (stats.std_dev && stats.std_dev < 3) confidence += 0.05;
  if (stats.std_dev && stats.std_dev > 8) confidence -= 0.1;

  return Math.min(0.95, confidence);
}

module.exports = router;
