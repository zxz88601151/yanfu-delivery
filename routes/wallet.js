'use strict';

/**
 * 钱包管理路由
 * 用户/骑手/商家的余额充值、交易记录查询
 *
 * @module routes/wallet
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

/**
 * 记录钱包交易流水
 */
async function recordTransaction(conn, { userType, userId, type, amount, balanceBefore, refType, refId, description, status }) {
  const balanceAfter = parseFloat((balanceBefore + amount).toFixed(2));
  const [r] = await conn.query(
    `INSERT INTO wallet_transactions
     (user_type, user_id, type, amount, balance_before, balance_after,
      reference_type, reference_id, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userType, userId, type, amount, balanceBefore, balanceAfter,
     refType || null, refId || null, description || null, status || 'completed']
  );
  return r.insertId;
}

// ========== 用户钱包 ==========

/**
 * 用户充值
 * POST /api/wallet/recharge
 */
router.post('/recharge', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, method } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '充值金额必须大于0' });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return res.status(400).json({ success: false, message: '金额格式不正确' });
    }
    if (Math.round(amount * 100) !== amount * 100) {
      return res.status(400).json({ success: false, message: '金额最多保留两位小数' });
    }
    if (amount > 50000) {
      return res.status(400).json({ success: false, message: '单次充值不能超过50000元' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 获取当前余额
      const [users] = await conn.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (users.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: '用户不存在' });
      }

      const balanceBefore = parseFloat(users[0].balance || 0);
      const balanceAfter = parseFloat((balanceBefore + amount).toFixed(2));

      // 更新余额
      await conn.query('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);

      // 记录交易
      await recordTransaction(conn, {
        userType: 'user',
        userId,
        type: 'recharge',
        amount,
        balanceBefore,
        refType: 'recharge',
        refId: `R${Date.now()}`,
        description: method === 'alipay' ? '支付宝充值' : method === 'wxpay' ? '微信充值' : '在线充值',
        status: 'completed',
      });

      await conn.commit();

      res.json({
        success: true,
        message: '充值成功',
        data: { amount, balance: balanceAfter, method: method || 'online' },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Recharge error:', error);
    res.status(500).json({ success: false, message: '充值失败' });
  }
});

/**
 * 获取余额
 * GET /api/wallet/balance?type=user&id=1
 */
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const { type, id } = req.query;
    const userId = parseInt(id) || req.user?.id;
    const userType = type || 'user';

    let balance = 0;
    if (userType === 'user') {
      const [users] = await pool.query('SELECT balance FROM users WHERE id = ?', [userId]);
      balance = users.length > 0 ? parseFloat(users[0].balance || 0) : 0;
    } else if (userType === 'rider') {
      const [riders] = await pool.query('SELECT balance FROM riders WHERE id = ?', [userId]);
      balance = riders.length > 0 ? parseFloat(riders[0].balance || 0) : 0;
    }

    res.json({ success: true, data: { balance, userType, userId } });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

/**
 * 交易记录
 * GET /api/wallet/transactions?type=user&id=1&page=1&size=20
 */
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const { type, id } = req.query;
    const userId = parseInt(id) || req.user?.id;
    const userType = type || 'user';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const offset = (page - 1) * size;

    const [records] = await pool.query(
      `SELECT id, type, amount, balance_before, balance_after,
              reference_type, reference_id, description, status, created_at
       FROM wallet_transactions
       WHERE user_type = ? AND user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userType, userId, size, offset]
    );

    const [countResult] = await pool.query(
      'SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_type = ? AND user_id = ?',
      [userType, userId]
    );

    res.json({
      success: true,
      data: {
        records,
        pagination: { page, size, total: countResult[0].total },
      },
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

/**
 * 汇总统计
 * GET /api/wallet/summary?type=user&id=1
 */
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { type, id } = req.query;
    const userId = parseInt(id) || req.user?.id;
    const userType = type || 'user';

    const [stats] = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'recharge' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_recharge,
        COALESCE(SUM(CASE WHEN type = 'payment' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_spent,
        COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_refund
       FROM wallet_transactions
       WHERE user_type = ? AND user_id = ?`,
      [userType, userId]
    );

    let currentBalance = 0;
    if (userType === 'user') {
      const [u] = await pool.query('SELECT balance FROM users WHERE id = ?', [userId]);
      currentBalance = u.length > 0 ? parseFloat(u[0].balance || 0) : 0;
    } else if (userType === 'rider') {
      const [r] = await pool.query('SELECT balance FROM riders WHERE id = ?', [userId]);
      currentBalance = r.length > 0 ? parseFloat(r[0].balance || 0) : 0;
    }

    res.json({
      success: true,
      data: {
        currentBalance,
        totalRecharge: parseFloat(stats[0].total_recharge),
        totalSpent: parseFloat(stats[0].total_spent),
        totalRefund: parseFloat(stats[0].total_refund),
      },
    });
  } catch (error) {
    console.error('Wallet summary error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = { router, recordTransaction };
