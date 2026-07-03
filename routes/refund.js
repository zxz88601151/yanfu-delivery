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

// 退款系统路由
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// ========== 用户端 ==========

// 申请退款
router.post('/apply', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { orderId, orderType, amount, reason } = req.body;
    const userId = req.user.id;

    // 参数校验
    if (!orderId || !orderType || !amount || !reason) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: '退款金额必须大于0' });
    }

    await conn.beginTransaction();

    // 查找关联支付记录
    const orderTable = orderType === 'merchant' ? 'merchant_orders' : 'rider_orders';
    const [orders] = await conn.query(
      `SELECT id, user_id, status FROM ${orderTable} WHERE id = ? AND user_id = ?`,
      [orderId, userId]
    );

    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];

    // 检查订单状态（已完成的订单才能退款）
    if (order.status !== 'completed') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '当前订单状态不支持退款' });
    }

    // 查找支付记录
    const [payments] = await conn.query(
      `SELECT id, amount, channel, status FROM payments
       WHERE ${orderType === 'merchant' ? 'merchant_order_id' : 'rider_order_id'} = ?
       AND user_id = ? AND status = 'success'
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, userId]
    );

    if (payments.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: '未找到支付记录' });
    }

    const payment = payments[0];

    // 检查退款金额不能超过支付金额
    if (parseFloat(amount) > parseFloat(payment.amount)) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '退款金额不能超过支付金额' });
    }

    // 检查是否已有进行中的退款
    const [existingRefunds] = await conn.query(
      'SELECT id, status FROM refunds WHERE payment_id = ? AND status IN ("pending", "processing")',
      [payment.id]
    );
    if (existingRefunds.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '该订单已有进行中的退款申请' });
    }

    // 生成退款单号
    const refundNo = 'RF' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();

    // 插入退款记录
    await conn.query(
      `INSERT INTO refunds (refund_no, payment_id, user_id, order_id, order_type, amount, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [refundNo, payment.id, userId, orderId, orderType, amount, reason]
    );

    await conn.commit();
    res.json({ success: true, message: '退款申请已提交', data: { refundNo } });
  } catch (error) {
    await conn.rollback();
    console.error('Apply refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 查询退款进度
router.get('/status/:refundNo', authMiddleware, async (req, res) => {
  try {
    const { refundNo } = req.params;
    const userId = req.user.id;

    const [refunds] = await pool.query(
      'SELECT * FROM refunds WHERE refund_no = ? AND user_id = ?',
      [refundNo, userId]
    );

    if (refunds.length === 0) {
      return res.status(404).json({ success: false, message: '退款记录不存在' });
    }

    const refund = refunds[0];
    res.json({
      success: true,
      data: {
        refundNo: refund.refund_no,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status,
        rejectReason: refund.reject_reason,
        createdAt: refund.created_at,
        handledAt: refund.handled_at,
      }
    });
  } catch (error) {
    console.error('Get refund status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取用户的退款列表
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = 'SELECT * FROM refunds WHERE user_id = ?';
    const params = [userId];

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [refunds] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM refunds WHERE user_id = ?',
      [userId]
    );

    res.json({
      success: true,
      data: {
        refunds,
        pagination: { page: parseInt(page), limit: parseInt(limit), total }
      }
    });
  } catch (error) {
    console.error('Get refund list error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
