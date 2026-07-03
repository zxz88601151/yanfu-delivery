// 数据分析路由 - 留存率、转化率、骑手效率等
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/auth');

// ========== 留存率分析 ==========

// 用户留存率（次日/7日/30日）
router.get('/retention', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || '2026-01-01';
    const end = endDate || '2026-12-31';

    // 每日注册用户数
    const [dailyUsers] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as new_users
       FROM users WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY DATE(created_at) ORDER BY date`,
      [start, end]
    );

    // 次日留存
    const [day1Retention] = await pool.query(
      `SELECT
        DATE(u.created_at) as date,
        COUNT(DISTINCT u.id) as new_users,
        COUNT(DISTINCT o.user_id) as retained
       FROM users u
       LEFT JOIN merchant_orders o ON o.user_id = u.id
         AND DATEDIFF(o.created_at, u.created_at) = 1
       WHERE u.created_at BETWEEN ? AND ?
       GROUP BY DATE(u.created_at)
       ORDER BY date`,
      [start, end]
    );

    // 7日留存
    const [day7Retention] = await pool.query(
      `SELECT
        DATE(u.created_at) as date,
        COUNT(DISTINCT u.id) as new_users,
        COUNT(DISTINCT o.user_id) as retained
       FROM users u
       LEFT JOIN merchant_orders o ON o.user_id = u.id
         AND DATEDIFF(o.created_at, u.created_at) BETWEEN 1 AND 7
       WHERE u.created_at BETWEEN ? AND ?
       GROUP BY DATE(u.created_at)
       ORDER BY date`,
      [start, end]
    );

    res.json({
      success: true,
      data: {
        day1: day1Retention.map(r => ({
          date: r.date,
          rate: r.new_users > 0 ? parseFloat((r.retained / r.new_users * 100).toFixed(1)) : 0,
        })),
        day7: day7Retention.map(r => ({
          date: r.date,
          rate: r.new_users > 0 ? parseFloat((r.retained / r.new_users * 100).toFixed(1)) : 0,
        })),
      }
    });
  } catch (error) {
    console.error('Get retention error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 转化率漏斗 ==========

router.get('/funnel', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || '2026-01-01';
    const end = endDate || '2026-12-31';

    // 浏览商家 → 加入购物车 → 下单 → 支付 → 完成
    const [funnel] = await pool.query(`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM merchant_orders WHERE DATE(created_at) BETWEEN ? AND ?) as order_users,
        (SELECT COUNT(*) FROM merchant_orders WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'completed') as completed_orders,
        (SELECT COUNT(*) FROM merchant_orders WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'cancelled') as cancelled_orders,
        (SELECT COUNT(DISTINCT user_id) FROM merchant_orders WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'completed') as completed_users,
        (SELECT COUNT(*) FROM users WHERE DATE(created_at) <= ?) as total_users
    `, [start, end, start, end, start, end, start, end, end]);

    const data = funnel[0];
    res.json({
      success: true,
      data: {
        totalUsers: data.total_users,
        orderUsers: data.order_users,
        completedOrders: data.completed_orders,
        cancelledOrders: data.cancelled_orders,
        completedUsers: data.completed_users,
        orderRate: data.total_users > 0 ? parseFloat((data.order_users / data.total_users * 100).toFixed(1)) : 0,
        completionRate: data.order_users > 0 ? parseFloat((data.completed_orders / data.order_users * 100).toFixed(1)) : 0,
        cancelRate: data.order_users > 0 ? parseFloat((data.cancelled_orders / data.order_users * 100).toFixed(1)) : 0,
      }
    });
  } catch (error) {
    console.error('Get funnel error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 骑手效率分析 ==========

router.get('/rider-efficiency', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const [riders] = await pool.query(
      `SELECT
        r.id, r.name, r.phone,
        COUNT(o.id) as total_orders,
        AVG(TIMESTAMPDIFF(MINUTE, o.created_at, o.delivered_at)) as avg_delivery_time,
        SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        ROUND(AVG(rv.rating), 1) as avg_rating
       FROM riders r
       LEFT JOIN rider_orders o ON o.rider_id = r.id
         AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       LEFT JOIN reviews rv ON rv.rider_id = r.id
       GROUP BY r.id
       HAVING total_orders > 0
       ORDER BY total_orders DESC
       LIMIT 20`,
      [parseInt(days)]
    );

    res.json({ success: true, data: riders });
  } catch (error) {
    console.error('Get rider efficiency error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 商家经营分析 ==========

router.get('/merchant-analytics', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [merchants] = await pool.query(
      `SELECT
        m.id, m.name,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(o.actual_amount), 0) as total_revenue,
        AVG(o.actual_amount) as avg_order_amount,
        ROUND(AVG(rv.rating), 1) as avg_rating,
        MAX(o.created_at) as last_order_time
       FROM merchants m
       LEFT JOIN merchant_orders o ON o.merchant_id = m.id
         AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       LEFT JOIN reviews rv ON rv.merchant_id = m.id
       GROUP BY m.id
       ORDER BY total_revenue DESC
       LIMIT 20`,
      [parseInt(days)]
    );

    // 流失商家预警（30天无订单）
    const [inactiveMerchants] = await pool.query(
      `SELECT m.id, m.name, m.business_status,
        MAX(o.created_at) as last_order_date
       FROM merchants m
       LEFT JOIN merchant_orders o ON o.merchant_id = m.id
       WHERE m.business_status = 'open'
       GROUP BY m.id
       HAVING last_order_date IS NULL OR last_order_date < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       LIMIT 10`
    );

    res.json({
      success: true,
      data: {
        topMerchants: merchants,
        inactiveMerchants,
      }
    });
  } catch (error) {
    console.error('Get merchant analytics error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 平台概览数据 ==========

router.get('/overview', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [[todayStats]] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE DATE(created_at) = ?) as new_users_today,
        (SELECT COUNT(*) FROM merchant_orders WHERE DATE(created_at) = ?) as orders_today,
        (SELECT COALESCE(SUM(actual_amount), 0) FROM merchant_orders WHERE DATE(created_at) = ? AND status = 'completed') as revenue_today,
        (SELECT COUNT(*) FROM riders WHERE status = 'active') as active_riders,
        (SELECT COUNT(*) FROM merchants WHERE business_status = 'open') as active_merchants,
        (SELECT COUNT(*) FROM merchant_orders WHERE status = 'pending') as pending_orders
    `, [today, today, today]);

    const [[weekStats]] = await pool.query(`
      SELECT
        (SELECT COALESCE(SUM(actual_amount), 0) FROM merchant_orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status = 'completed') as revenue_week,
        (SELECT COUNT(*) FROM merchant_orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as orders_week
    `);

    res.json({
      success: true,
      data: { ...todayStats, ...weekStats }
    });
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
