// 客服工单系统路由
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { adminMiddleware } = require('../middleware/auth');

// ========== 工单列表（管理端） ==========

router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category, priority } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `SELECT t.*, u.name as user_name, u.phone as user_phone
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1`;
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (category && category !== 'all') {
      sql += ' AND t.category = ?';
      params.push(category);
    }
    if (priority && priority !== 'all') {
      sql += ' AND t.priority = ?';
      params.push(priority);
    }

    sql += ' ORDER BY t.priority DESC, t.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [tickets] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM tickets');

    res.json({ success: true, data: { tickets, total } });
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 工单详情 ==========

router.get('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const [tickets] = await pool.query(
      `SELECT t.*, u.name as user_name, u.phone as user_phone
       FROM tickets t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`, [id]
    );
    if (tickets.length === 0) return res.status(404).json({ success: false, message: '工单不存在' });

    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at', [id]
    );

    res.json({ success: true, data: { ticket: tickets[0], messages } });
  } catch (error) {
    console.error('Get ticket detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 分配工单 ==========

router.put('/:id/assign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId } = req.body;

    await pool.query(
      'UPDATE tickets SET status = "processing", assigned_to = ?, assigned_at = NOW() WHERE id = ?',
      [adminId || req.user.id, id]
    );

    res.json({ success: true, message: '工单已分配' });
  } catch (error) {
    console.error('Assign ticket error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 回复工单 ==========

router.post('/:id/reply', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, isInternal } = req.body;

    if (!content) return res.status(400).json({ success: false, message: '回复内容不能为空' });

    await pool.query(
      'INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, content, is_internal) VALUES (?, "admin", ?, ?, ?)',
      [id, req.user.id, content, isInternal ? 1 : 0]
    );

    // 更新工单状态为处理中
    await pool.query('UPDATE tickets SET status = "processing" WHERE id = ? AND status = "open"', [id]);

    res.json({ success: true, message: '回复成功' });
  } catch (error) {
    console.error('Reply ticket error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 解决工单 ==========

router.put('/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body;

    await pool.query(
      'UPDATE tickets SET status = "resolved", resolution = ?, resolved_at = NOW(), assigned_to = ? WHERE id = ?',
      [resolution || '', req.user.id, id]
    );

    res.json({ success: true, message: '工单已解决' });
  } catch (error) {
    console.error('Resolve ticket error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 关闭工单 ==========

router.put('/:id/close', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE tickets SET status = "closed" WHERE id = ?', [id]);
    res.json({ success: true, message: '工单已关闭' });
  } catch (error) {
    console.error('Close ticket error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 工单统计 ==========

router.get('/stats/summary', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [[stats]] = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent_count
      FROM tickets
    `);

    // 平均处理时间
    const [[avgTime]] = await pool.query(`
      SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, resolved_at)) as avg_resolve_hours
      FROM tickets WHERE status IN ('resolved', 'closed') AND resolved_at IS NOT NULL
    `);

    res.json({
      success: true,
      data: { ...stats, avgResolveHours: avgTime.avg_resolve_hours || 0 }
    });
  } catch (error) {
    console.error('Get ticket stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 用户端：创建工单 ==========

router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { category, title, content, relatedOrderId, relatedOrderType } = req.body;
    const userId = req.user.id;

    if (!category || !title || !content) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const ticketNo = 'TK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

    const [result] = await pool.query(
      `INSERT INTO tickets (ticket_no, user_id, user_type, category, title, content, related_order_id, related_order_type)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
      [ticketNo, userId, category, title, content, relatedOrderId || null, relatedOrderType || null]
    );

    res.json({ success: true, message: '工单已创建', data: { ticketId: result.insertId, ticketNo } });
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 用户端：我的工单列表 ==========

router.get('/my', authMiddleware, async (req, res) => {
  try {
    const [tickets] = await pool.query(
      'SELECT id, ticket_no, category, title, status, priority, created_at, updated_at FROM tickets WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, data: tickets });
  } catch (error) {
    console.error('Get my tickets error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
