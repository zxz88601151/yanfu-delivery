const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ============================================================
// 前端兼容层 - 修复前后端API不匹配问题 (必须放在通用路由之前)
// ============================================================

// 1. 用户封禁/解封 (POST 兼容层)
router.post('/users/:id/ban', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['banned', id]);
    res.json({ success: true, message: '用户已封禁' });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/users/:id/unban', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['active', id]);
    res.json({ success: true, message: '用户已解封' });
  } catch (error) {
    console.error('Unban user error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 2. 骑手冻结/解冻 (POST 兼容层)
router.post('/riders/:id/freeze', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query('UPDATE riders SET status = ?, freeze_reason = ?, freeze_at = NOW() WHERE id = ?', ['offline', reason || '', id]);
    res.json({ success: true, message: '骑手已冻结' });
  } catch (error) {
    console.error('Freeze rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/riders/:id/unfreeze', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE riders SET status = ?, freeze_reason = NULL, freeze_at = NULL WHERE id = ?', ['offline', id]);
    res.json({ success: true, message: '骑手已解冻' });
  } catch (error) {
    console.error('Unfreeze rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 3. 骑手审核通过/拒绝 (POST 兼容层)
router.post('/riders/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE riders SET status = ?, real_name_status = ?, freeze_reason = NULL, freeze_at = NULL WHERE id = ?', ['offline', 'approved', id]);
    res.json({ success: true, message: '骑手审核通过' });
  } catch (error) {
    console.error('Approve rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/riders/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query('UPDATE riders SET status = ?, real_name_status = ?, reject_reason = ? WHERE id = ?', ['offline', 'rejected', reason || '', id]);
    res.json({ success: true, message: '骑手审核已拒绝' });
  } catch (error) {
    console.error('Reject rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 4. 商家审核通过/拒绝 (POST 兼容层)
router.post('/merchants/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE merchants SET status = ?, qualification_status = ? WHERE id = ?', ['active', 'approved', id]);
    res.json({ success: true, message: '商家审核通过' });
  } catch (error) {
    console.error('Approve merchant error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/merchants/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query('UPDATE merchants SET status = ?, qualification_status = ?, reject_reason = ? WHERE id = ?', ['rejected', 'rejected', reason || '', id]);
    res.json({ success: true, message: '商家审核已拒绝' });
  } catch (error) {
    console.error('Reject merchant error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 5. 订单取消/改派 (POST 兼容层)
router.post('/orders/:id/cancel', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query("UPDATE merchant_orders SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason || '管理员取消', id]);
    res.json({ success: true, message: '订单已取消' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/orders/:id/reassign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rider_id } = req.body;

    if (!rider_id) {
      return res.status(400).json({ success: false, message: '缺少骑手ID' });
    }

    // 验证骑手存在且在线
    const [riders] = await pool.query('SELECT id, status FROM riders WHERE id = ? AND status = "online"', [rider_id]);
    if (riders.length === 0) {
      return res.status(400).json({ success: false, message: '骑手不存在或不在线' });
    }

    // 验证订单存在且状态允许改派
    const [orders] = await pool.query('SELECT id, status FROM rider_orders WHERE id = ?', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }
    if (!['pending', 'accepted'].includes(orders[0].status)) {
      return res.status(400).json({ success: false, message: '订单状态不支持重新分配' });
    }

    await pool.query('UPDATE rider_orders SET rider_id = ? WHERE id = ?', [rider_id, id]);
    res.json({ success: true, message: '订单已改派' });
  } catch (error) {
    console.error('Reassign order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 6. 财务结算执行 (POST 兼容层)
router.post('/finance/settlements/:id/execute', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query(
      "UPDATE merchant_settlements SET status = 'settled', settled_at = NOW() WHERE id = ? AND status = 'pending'",
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: '结算单已被处理' });
    }

    // 审计日志
    try {
      const [settlement] = await pool.query('SELECT amount FROM merchant_settlements WHERE id = ?', [id]);
      await pool.query(
        'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [req.user.id, 'execute_settlement', 'settlement', id, JSON.stringify({ amount: settlement[0]?.amount })]
      );
    } catch (logErr) {
      console.error('Settlement audit log error:', logErr);
    }

    res.json({ success: true, message: '结算已执行' });
  } catch (error) {
    console.error('Execute settlement error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 7. 提现审批 (POST 兼容层)
router.post('/finance/withdrawals/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE withdrawals SET status = 'approved', reviewed_at = NOW() WHERE id = ?", [id]);
    res.json({ success: true, message: '提现已批准' });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.post('/finance/withdrawals/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    await pool.query("UPDATE withdrawals SET status = 'rejected', reject_reason = ?, reviewed_at = NOW() WHERE id = ?", [reason || '', id]);
    res.json({ success: true, message: '提现已拒绝' });
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 8. 订单查询别名 (GET 兼容层)
router.get('/orders/merchant', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, merchant_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let sql = 'SELECT id, order_no, merchant_id, user_id, order_amount, commission, actual_amount, status, cancel_reason, created_at, delivered_at FROM merchant_orders WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (merchant_id) {
      sql += ' AND merchant_id = ?';
      params.push(merchant_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [orders] = await pool.query(sql, params);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM merchant_orders WHERE 1=1', params.slice(0, -2));

    res.json({
      success: true,
      data: orders,
      pagination: { page: parseInt(page), limit, total: countResult[0].total }
    });
  } catch (error) {
    console.error('Get merchant orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

router.get('/orders/rider', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, rider_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let sql = 'SELECT id, order_no, rider_id, merchant_name, pickup_address, delivery_address, delivery_name, delivery_phone, distance, total_income, status, created_at, delivered_at FROM rider_orders WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (rider_id) {
      sql += ' AND rider_id = ?';
      params.push(rider_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [orders] = await pool.query(sql, params);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM rider_orders WHERE 1=1', params.slice(0, -2));

    res.json({
      success: true,
      data: orders,
      pagination: { page: parseInt(page), limit, total: countResult[0].total }
    });
  } catch (error) {
    console.error('Get rider orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 9. 财务结算查询 (GET 兼容层)
router.get('/finance/settlements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, merchant_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let sql = 'SELECT id, merchant_id, period_start, period_end, total_amount, commission, delivery_fee, status, created_at, settled_at FROM merchant_settlements WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (merchant_id) {
      sql += ' AND merchant_id = ?';
      params.push(merchant_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [settlements] = await pool.query(sql, params);
    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM merchant_settlements WHERE 1=1', params.slice(0, -2));

    res.json({
      success: true,
      data: settlements,
      pagination: { page: parseInt(page), limit, total: countResult[0].total }
    });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 10. 待审核骑手列表 (GET 兼容层)
router.get('/riders/pending', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;

    const [riders] = await pool.query(
      'SELECT id, name, phone, real_name, real_name_status, status, created_at FROM riders WHERE real_name_status = ? OR status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      ['pending', 'pending_review', limit, offset]
    );

    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM riders WHERE real_name_status = ? OR status = ?',
      ['pending', 'pending_review']
    );

    res.json({
      success: true,
      data: riders,
      pagination: { page: parseInt(page), limit, total: countResult[0].total }
    });
  } catch (error) {
    console.error('Get pending riders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取统计数据
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [riderCount] = await pool.query('SELECT COUNT(*) as count FROM riders');
    const [merchantCount] = await pool.query('SELECT COUNT(*) as count FROM merchants');
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    
    const today = new Date().toISOString().slice(0, 10);
    const [todayRiderOrders] = await pool.query(
      'SELECT COUNT(*) as count FROM rider_orders WHERE DATE(created_at) = ?',
      [today]
    );
    const [todayMerchantOrders] = await pool.query(
      'SELECT COUNT(*) as count FROM merchant_orders WHERE DATE(created_at) = ?',
      [today]
    );
    
    res.json({
      success: true,
      data: {
        riderCount: riderCount[0].count,
        merchantCount: merchantCount[0].count,
        userCount: userCount[0].count,
        todayRiderOrders: todayRiderOrders[0].count,
        todayMerchantOrders: todayMerchantOrders[0].count
      }
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 骑手管理 ==========

// 获取骑手列表
router.get('/riders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, keyword } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT id, name, phone, level, status, total_orders, rating, today_income, month_income, balance, last_latitude, last_longitude, last_address, last_location_at, created_at FROM riders WHERE 1=1';
    const params = [];

    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${safeKeyword}%`, `%${safeKeyword}%`);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [riders] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM riders WHERE 1=1 ${keyword ? ' AND (name LIKE ? OR phone LIKE ?)' : ''}`,
      keyword ? (() => { const s = keyword.replace(/[%_\\]/g, '\\$&'); return [`%${s}%`, `%${s}%`]; })() : []
    );

    res.json({ success: true, data: riders.map(r => ({
          id: r.id, name: r.name, phone: r.phone, level: r.level,
          status: r.status, totalOrders: r.total_orders, rating: parseFloat(r.rating),
          todayIncome: parseFloat(r.today_income || 0), monthIncome: parseFloat(r.month_income || 0),
          balance: parseFloat(r.balance || 0), createdAt: r.created_at,
        })), total });
  } catch (error) {
    console.error('Get riders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 商家管理 ==========

// 获取商家列表
router.get('/merchants', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, keyword, isOpen } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT id, name, phone, address, category, is_open, rating, total_orders, today_revenue, created_at FROM merchants WHERE 1=1';
    const params = [];

    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${safeKeyword}%`, `%${safeKeyword}%`);
    }

    if (isOpen !== undefined) {
      sql += ' AND is_open = ?';
      params.push(isOpen === 'true' ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [merchants] = await pool.query(sql, params);

    res.json({
      success: true,
      data: merchants.map(m => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        address: m.address,
        category: m.category,
        isOpen: m.is_open === 1,
        rating: m.rating,
        totalOrders: m.total_orders,
        todayRevenue: m.today_revenue,
        createdAt: m.created_at
      }))
    });
  } catch (error) {
    console.error('Get merchants error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 订单管理 ==========

// 获取骑手订单列表
router.get('/rider-orders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, date } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT ro.id, ro.order_no, ro.rider_id, ro.merchant_name, ro.pickup_address, ro.delivery_address, ro.delivery_name, ro.delivery_phone, ro.distance, ro.total_income, ro.status, ro.created_at, ro.delivered_at, r.name as rider_name, r.phone as rider_phone FROM rider_orders ro LEFT JOIN riders r ON ro.rider_id = r.id WHERE 1=1';
    const params = [];
    
    if (status) {
      sql += ' AND ro.status = ?';
      params.push(status);
    }
    
    if (date) {
      sql += ' AND DATE(ro.created_at) = ?';
      params.push(date);
    }
    
    sql += ' ORDER BY ro.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [orders] = await pool.query(sql, params);

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        orderNo: o.order_no,
        riderId: o.rider_id,
        riderName: o.rider_name,
        riderPhone: o.rider_phone,
        merchantName: o.merchant_name,
        pickupAddress: o.pickup_address,
        deliveryAddress: o.delivery_address,
        deliveryName: o.delivery_name,
        deliveryPhone: o.delivery_phone,
        distance: o.distance,
        totalIncome: o.total_income,
        status: o.status,
        createdAt: o.created_at,
        deliveredAt: o.delivered_at
      }))
    });
  } catch (error) {
    console.error('Get rider orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取商家订单列表
router.get('/merchant-orders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, date } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT mo.id, mo.order_no, mo.merchant_id, mo.user_id, mo.order_amount, mo.commission, mo.actual_amount, mo.status, mo.created_at, mo.delivered_at, m.name as merchant_name, u.name as user_name FROM merchant_orders mo JOIN merchants m ON mo.merchant_id = m.id JOIN users u ON mo.user_id = u.id WHERE 1=1';
    const params = [];
    
    if (status) {
      sql += ' AND mo.status = ?';
      params.push(status);
    }
    
    if (date) {
      sql += ' AND DATE(mo.created_at) = ?';
      params.push(date);
    }
    
    sql += ' ORDER BY mo.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [orders] = await pool.query(sql, params);

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        orderNo: o.order_no,
        merchantId: o.merchant_id,
        merchantName: o.merchant_name,
        userId: o.user_id,
        userName: o.user_name,
        orderAmount: o.order_amount,
        commission: o.commission,
        actualAmount: o.actual_amount,
        status: o.status,
        createdAt: o.created_at,
        deliveredAt: o.delivered_at
      }))
    });
  } catch (error) {
    console.error('Get merchant orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 提现管理 ==========

// 获取提现申请列表
router.get('/withdrawals', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT w.id, w.rider_id, w.amount, w.status, w.remark, w.created_at, w.completed_at, r.name as rider_name, r.phone as rider_phone FROM withdrawals w JOIN riders r ON w.rider_id = r.id WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND w.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY w.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);
    
    const [withdrawals] = await pool.query(sql, params);

    res.json({
      success: true,
      data: withdrawals.map(w => ({
        id: w.id,
        riderId: w.rider_id,
        riderName: w.rider_name,
        riderPhone: w.rider_phone,
        amount: w.amount,
        status: w.status,
        createdAt: w.created_at,
        completedAt: w.completed_at,
        remark: w.remark
      }))
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核提现
router.put('/withdrawals/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status, remark } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态' });
    }

    const [withdrawals] = await conn.query('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [req.params.id, 'pending']);
    if (withdrawals.length === 0) {
      return res.status(400).json({ success: false, message: '提现已被处理，无法重复操作' });
    }

    const withdrawal = withdrawals[0];

    await conn.beginTransaction();

    if (status === 'rejected') {
      // 拒绝时返还余额
      const [refundResult] = await conn.query(
        'UPDATE riders SET balance = balance + ? WHERE id = ?',
        [withdrawal.amount, withdrawal.rider_id]
      );
      if (refundResult.affectedRows === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: '骑手不存在' });
      }
    }

    const [result] = await conn.query(
      'UPDATE withdrawals SET status = ?, remark = ?, completed_at = NOW() WHERE id = ? AND status = ?',
      [status, remark || '', req.params.id, 'pending']
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '提现已被处理' });
    }

    await conn.commit();
    res.json({ success: true, message: `提现申请已${status === 'approved' ? '通过' : '拒绝'}` });
  } catch (error) {
    await conn.rollback();
    console.error('Review withdrawal error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 系统操作 ==========

// 创建骑手订单（模拟用户下单生成骑手取餐任务）
router.post('/rider-orders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { merchantName, merchantAddress, pickupAddress, deliveryAddress, deliveryName, deliveryPhone, distance } = req.body;
    
    // 计算费用
    const baseFare = 5 + distance * 1.5;
    const peakBonus = Math.random() > 0.5 ? 2 : 0;
    const weatherBonus = Math.random() > 0.7 ? 1.5 : 0;
    const longDistanceBonus = distance > 5 ? (distance - 5) * 1 : 0;
    const rewardBonus = 0;
    const totalIncome = baseFare + peakBonus + weatherBonus + longDistanceBonus + rewardBonus;
    
    const orderNo = `R${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    
    await pool.query(
      `INSERT INTO rider_orders 
       (order_no, merchant_name, merchant_address, pickup_address, delivery_address, delivery_name, delivery_phone, distance, base_fare, peak_bonus, weather_bonus, long_distance_bonus, reward_bonus, total_income) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, merchantName, merchantAddress, pickupAddress, deliveryAddress, deliveryName, deliveryPhone, distance, baseFare, peakBonus, weatherBonus, longDistanceBonus, rewardBonus, totalIncome]
    );
    
    res.json({ success: true, message: '骑手订单创建成功', orderNo });
  } catch (error) {
    console.error('Create rider order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 1. 用户管理扩展
// ============================================================

// 用户详情（订单+消费+风控标签）
// GET /api/admin/users/:id/detail
router.get('/users/:id/detail', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT id, name, phone, avatar, balance, points, member_level, status, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' });

    const [[orderStats]] = await pool.query(
      'SELECT COUNT(*) AS totalOrders, COALESCE(SUM(actual_amount), 0) AS totalSpent FROM merchant_orders WHERE user_id = ? AND status = "completed"',
      [req.params.id]
    );

    const [recentOrders] = await pool.query(
      'SELECT id, order_no, actual_amount, status, created_at FROM merchant_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...user,
        totalOrders: parseInt(orderStats.totalOrders),
        totalSpent: parseFloat(parseFloat(orderStats.totalSpent).toFixed(2)),
        recentOrders
      }
    });
  } catch (error) {
    console.error('Get user detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户运营：拉黑/解禁
// PUT /api/admin/users/:id/status
router.put('/users/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!['active', 'banned'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态' });
    }

    await pool.query(
      'UPDATE users SET status = ?, ban_reason = ? WHERE id = ?',
      [status, reason || null, req.params.id]
    );

    // 记录操作日志
    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES (?,?,?,?,?)',
      [req.user.id, status === 'banned' ? 'ban_user' : 'unban_user', 'user', req.params.id, reason || '']
    );

    res.json({ success: true, message: `用户已${status === 'banned' ? '拉黑' : '解禁'}` });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 给用户发券
// POST /api/admin/users/:id/send-coupon
router.post('/users/:id/send-coupon', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { couponId, expireDays } = req.body;

    const expireAt = expireDays
      ? new Date(Date.now() + expireDays * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    await pool.query(
      'INSERT INTO user_coupons (user_id, coupon_id, expire_at) VALUES (?,?,?)',
      [req.params.id, couponId, expireAt]
    );

    res.json({ success: true, message: '优惠券已发放' });
  } catch (error) {
    console.error('Send coupon error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 2. 商家管理扩展
// ============================================================

// 商家入驻审核列表
// GET /api/admin/merchant-qualifications?status=pending
router.get('/merchant-qualifications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status = 'pending', page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [rows] = await pool.query(
      `SELECT mq.*, m.name AS merchant_name, m.phone AS merchant_phone
       FROM merchant_qualifications mq
       JOIN merchants m ON mq.merchant_id = m.id
       WHERE mq.status = ?
       ORDER BY mq.submitted_at DESC LIMIT ? OFFSET ?`,
      [status, limit, (parseInt(page) - 1) * limit]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get qualifications error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核商家入驻
// PUT /api/admin/merchant-qualifications/:id/review
router.put('/merchant-qualifications/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { approve, rejectReason } = req.body;

    const [[qual]] = await pool.query('SELECT merchant_id FROM merchant_qualifications WHERE id = ?', [req.params.id]);
    if (!qual) return res.status(404).json({ success: false, message: '审核记录不存在' });

    const status = approve ? 'approved' : 'rejected';

    await pool.query(
      'UPDATE merchant_qualifications SET status = ?, reject_reason = ?, reviewed_at = NOW(), reviewer_id = ? WHERE id = ?',
      [status, rejectReason || null, req.user.id, req.params.id]
    );

    await pool.query(
      'UPDATE merchants SET qualification_status = ? WHERE id = ?',
      [status, qual.merchant_id]
    );

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES (?,?,?,?,?)',
      [req.user.id, `review_qualification_${status}`, 'merchant', qual.merchant_id, rejectReason || '']
    );

    res.json({ success: true, message: approve ? '审核通过' : '已驳回' });
  } catch (error) {
    console.error('Review qualification error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家违规处罚
// POST /api/admin/merchants/:id/punish
router.post('/merchants/:id/punish', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, reason, amount, duration } = req.body;
    const validTypes = ['warning', 'fine', 'suspend', 'close'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: '无效的处罚类型' });
    }

    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ success: false, message: '无效的金额' });
      }
    }

    await pool.query(
      'INSERT INTO merchant_punishments (merchant_id, admin_id, type, reason, amount, duration_days) VALUES (?,?,?,?,?,?)',
      [req.params.id, req.user.id, type, reason, amount || 0, duration || 0]
    );

    if (type === 'suspend' || type === 'close') {
      await pool.query('UPDATE merchants SET is_open = 0, status = ? WHERE id = ?', [type, req.params.id]);
    }

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES (?,?,?,?,?)',
      [req.user.id, `punish_merchant_${type}`, 'merchant', req.params.id, reason]
    );

    res.json({ success: true, message: '处罚已记录' });
  } catch (error) {
    console.error('Punish merchant error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家详情（含营收/评价/违规记录）
// GET /api/admin/merchants/:id/detail
router.get('/merchants/:id/detail', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [[merchant]] = await pool.query('SELECT id, name, phone, address, category, is_open, rating, total_orders, today_revenue, status, qualification_status, created_at FROM merchants WHERE id = ?', [req.params.id]);
    if (!merchant) return res.status(404).json({ success: false, message: '商家不存在' });

    const [[stats]] = await pool.query(
      'SELECT COUNT(*) AS totalOrders, COALESCE(SUM(actual_amount), 0) AS totalRevenue FROM merchant_orders WHERE merchant_id = ? AND status = "completed"',
      [req.params.id]
    );

    const [punishments] = await pool.query(
      'SELECT type, reason, created_at FROM merchant_punishments WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );

    res.json({
      success: true,
      data: { ...merchant, totalOrders: parseInt(stats.totalOrders), totalRevenue: parseFloat(stats.totalRevenue), recentPunishments: punishments }
    });
  } catch (error) {
    console.error('Get merchant detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 3. 骑手管理扩展
// ============================================================

// 骑手审核（实名/资质）
// GET /api/admin/rider-qualifications?status=pending
router.get('/rider-qualifications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status = 'pending', page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [rows] = await pool.query(
      `SELECT r.id, r.name, r.phone, r.real_name, r.real_name_status, r.real_name_submitted_at
       FROM riders r
       WHERE r.real_name_status = ?
       ORDER BY r.real_name_submitted_at DESC LIMIT ? OFFSET ?`,
      [status, limit, (parseInt(page) - 1) * limit]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get rider qualifications error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核骑手实名认证
// PUT /api/admin/rider-qualifications/:riderId/review
router.put('/rider-qualifications/:riderId/review', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { approve, rejectReason } = req.body;
    const status = approve ? 'approved' : 'rejected';

    await pool.query(
      'UPDATE riders SET real_name_status = ?, real_name_reject_reason = ? WHERE id = ?',
      [status, rejectReason || null, req.params.riderId]
    );

    res.json({ success: true, message: approve ? '认证通过' : '认证驳回' });
  } catch (error) {
    console.error('Review rider qualification error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手风控：冻结/解冻
// PUT /api/admin/riders/:id/freeze
router.put('/riders/:id/freeze', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { freeze, reason } = req.body;

    await pool.query(
      'UPDATE riders SET status = ?, freeze_reason = ?, freeze_at = ? WHERE id = ?',
      [freeze ? 'offline' : 'offline', reason || null, freeze ? new Date() : null, req.params.id]
    );

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES (?,?,?,?,?)',
      [req.user.id, freeze ? 'freeze_rider' : 'unfreeze_rider', 'rider', req.params.id, reason || '']
    );

    res.json({ success: true, message: freeze ? '骑手已冻结' : '骑手已解冻' });
  } catch (error) {
    console.error('Freeze rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手详情
// GET /api/admin/riders/:id/detail
router.get('/riders/:id/detail', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT id, name, phone, status, level, credit_score, rating, total_orders, balance, real_name_status, freeze_reason, created_at FROM riders WHERE id = ?',
      [req.params.id]
    );
    if (!rider) return res.status(404).json({ success: false, message: '骑手不存在' });

    const [[income]] = await pool.query(
      'SELECT COALESCE(SUM(total), 0) AS totalIncome FROM income_records WHERE rider_id = ?',
      [req.params.id]
    );

    const [recentOrders] = await pool.query(
      'SELECT id, order_no, total_income, status, created_at FROM rider_orders WHERE rider_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );

    res.json({ success: true, data: { ...rider, totalIncome: parseFloat(income.totalIncome), recentOrders } });
  } catch (error) {
    console.error('Get rider detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 4. 全平台订单管理
// ============================================================

// 全平台订单列表（用户订单，带多维筛选）
// GET /api/admin/orders?status=&userId=&merchantId=&startDate=&endDate=&page=1
router.get('/orders', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, userId, merchantId, startDate, endDate, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;

    let sql = `SELECT mo.id, mo.order_no, mo.status, mo.actual_amount, mo.created_at,
                      u.name AS user_name, u.phone AS user_phone,
                      m.name AS merchant_name
               FROM merchant_orders mo
               JOIN users u ON mo.user_id = u.id
               JOIN merchants m ON mo.merchant_id = m.id
               WHERE 1=1`;
    const params = [];

    if (status) { sql += ' AND mo.status = ?'; params.push(status); }
    if (userId) { sql += ' AND mo.user_id = ?'; params.push(userId); }
    if (merchantId) { sql += ' AND mo.merchant_id = ?'; params.push(merchantId); }
    if (startDate) { sql += ' AND DATE(mo.created_at) >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND DATE(mo.created_at) <= ?'; params.push(endDate); }

    const countSql = sql.replace(/SELECT .+ FROM merchant_orders/, 'SELECT COUNT(*) AS total FROM merchant_orders');
    const [[{ total }]] = await pool.query(countSql, params);

    sql += ' ORDER BY mo.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [orders] = await pool.query(sql, params);

    res.json({ success: true, data: { list: orders, total, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get all orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 订单干预：取消订单
// PUT /api/admin/orders/:id/cancel
router.put('/orders/:id/cancel', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;

    await pool.query(
      'UPDATE merchant_orders SET status = "cancelled", cancel_reason = ?, cancelled_at = NOW() WHERE id = ?',
      [reason || '平台取消', req.params.id]
    );

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, detail) VALUES (?,?,?,?,?)',
      [req.user.id, 'cancel_order', 'order', req.params.id, reason || '']
    );

    res.json({ success: true, message: '订单已取消' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 申诉仲裁
// POST /api/admin/appeals/:id/arbitrate
router.post('/appeals/:id/arbitrate', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { decision, result, penalty } = req.body; // decision: approve|reject|both_wrong

    await pool.query(
      'UPDATE rider_appeals SET status = ?, result = ?, arbitrated_by = ?, arbitrated_at = NOW() WHERE id = ?',
      [decision === 'approve' ? 'approved' : 'rejected', result, req.user.id, req.params.id]
    );

    res.json({ success: true, message: '仲裁结果已记录' });
  } catch (error) {
    console.error('Arbitrate appeal error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 订单统计
// GET /api/admin/orders/stats?startDate=&endDate=
router.get('/orders/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const start = startDate || now.toISOString().slice(0, 10);
    const end = endDate || now.toISOString().slice(0, 10);

    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) AS totalOrders,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completedOrders,
         COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelledOrders,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS totalRevenue,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN commission END), 0) AS totalCommission,
         COALESCE(AVG(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS avgOrderValue
       FROM merchant_orders
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [start, end]
    );

    res.json({ success: true, data: { startDate: start, endDate: end, ...stats } });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 5. 营销活动管理
// ============================================================

// 广告位管理
// GET /api/admin/banners
router.get('/banners', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [banners] = await pool.query('SELECT id, position, image, title, link_type, link_target, sort_order, is_active, start_at, end_at, created_by, created_at FROM platform_banners ORDER BY sort_order ASC, created_at DESC');
    res.json({ success: true, data: banners });
  } catch (error) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建/更新广告位
// POST /api/admin/banners
router.post('/banners', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id, position, image, title, linkType, linkTarget, sortOrder, isActive, startAt, endAt } = req.body;

    if (id) {
      await pool.query(
        'UPDATE platform_banners SET position=?, image=?, title=?, link_type=?, link_target=?, sort_order=?, is_active=?, start_at=?, end_at=? WHERE id=?',
        [position, image, title, linkType, linkTarget, sortOrder || 0, isActive ? 1 : 0, startAt, endAt, id]
      );
      res.json({ success: true, message: '广告位更新成功' });
    } else {
      const [result] = await pool.query(
        'INSERT INTO platform_banners (position, image, title, link_type, link_target, sort_order, is_active, start_at, end_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [position, image, title, linkType, linkTarget, sortOrder || 0, isActive ? 1 : 0, startAt, endAt, req.user.id]
      );
      res.json({ success: true, message: '广告位创建成功', id: result.insertId });
    }
  } catch (error) {
    console.error('Save banner error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 6. 财务与结算
// ============================================================

// 平台财务总览
// GET /api/admin/finance/overview?startDate=&endDate=
router.get('/finance/overview', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const start = startDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = endDate || now.toISOString().slice(0, 10);

    const [[stats]] = await pool.query(
      `SELECT
         COALESCE(SUM(actual_amount), 0) AS grossRevenue,
         COALESCE(SUM(commission), 0) AS commissionRevenue,
         COALESCE(SUM(delivery_fee), 0) AS deliveryRevenue,
         COALESCE(SUM(discount), 0) AS discountExpense,
         COUNT(*) AS totalOrders,
         COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelledOrders
       FROM merchant_orders
       WHERE DATE(created_at) BETWEEN ? AND ?`,
      [start, end]
    );

    res.json({
      success: true,
      data: {
        startDate: start, endDate: end,
        grossRevenue: parseFloat(parseFloat(stats.grossRevenue).toFixed(2)),
        commissionRevenue: parseFloat(parseFloat(stats.commissionRevenue).toFixed(2)),
        deliveryRevenue: parseFloat(parseFloat(stats.deliveryRevenue).toFixed(2)),
        discountExpense: parseFloat(parseFloat(stats.discountExpense).toFixed(2)),
        totalOrders: parseInt(stats.totalOrders),
        cancelledOrders: parseInt(stats.cancelledOrders)
      }
    });
  } catch (error) {
    console.error('Get finance overview error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家结算列表
// GET /api/admin/finance/merchant-settlements?status=pending
router.get('/finance/merchant-settlements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = `SELECT ms.*, m.name AS merchant_name, m.phone AS merchant_phone
               FROM merchant_settlements ms
               JOIN merchants m ON ms.merchant_id = m.id
               WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND ms.status = ?'; params.push(status); }
    sql += ' ORDER BY ms.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Get merchant settlements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核/执行商家结算
// PUT /api/admin/finance/merchant-settlements/:id/settle
router.put('/finance/merchant-settlements/:id/settle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { bankInfo } = req.body;

    await pool.query(
      'UPDATE merchant_settlements SET status = "settled", settled_at = NOW(), bank_info = ?, settled_by = ? WHERE id = ?',
      [bankInfo || null, req.user.id, req.params.id]
    );

    res.json({ success: true, message: '结算已完成' });
  } catch (error) {
    console.error('Settle merchant error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 7. 风控
// ============================================================

// 风控事件列表
// GET /api/admin/risk/events?type=&status=pending
router.get('/risk/events', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, status = 'pending', page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = 'SELECT id, type, status, action, note, target_id, target_type, handled_by, handled_at, created_at FROM risk_events WHERE status = ?';
    const params = [status];
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (parseInt(page) - 1) * limit);

    const [events] = await pool.query(sql, params);
    res.json({ success: true, data: events });
  } catch (error) {
    console.error('Get risk events error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 处理风控事件
// PUT /api/admin/risk/events/:id/handle
router.put('/risk/events/:id/handle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { action, note } = req.body;

    await pool.query(
      'UPDATE risk_events SET status = "handled", action = ?, handled_by = ?, handled_at = NOW(), note = ? WHERE id = ?',
      [action, req.user.id, note || null, req.params.id]
    );

    res.json({ success: true, message: '风控事件已处理' });
  } catch (error) {
    console.error('Handle risk event error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 8. 数据大屏
// ============================================================

// 实时监控数据
// GET /api/admin/dashboard/realtime
router.get('/dashboard/realtime', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[orderStats]] = await pool.query(
      `SELECT
         COUNT(*) AS totalOrders,
         COUNT(CASE WHEN status NOT IN ('completed','cancelled') THEN 1 END) AS activeOrders,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS todayRevenue,
         COALESCE(AVG(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS avgOrderValue
       FROM merchant_orders WHERE DATE(created_at) = ?`,
      [today]
    );

    const [[onlineRiders]] = await pool.query(
      "SELECT COUNT(*) AS count FROM riders WHERE status = 'online'"
    );

    const [[onlineMerchants]] = await pool.query(
      "SELECT COUNT(*) AS count FROM merchants WHERE is_open = 1"
    );

    const [[activeUsers]] = await pool.query(
      'SELECT COUNT(DISTINCT user_id) AS count FROM merchant_orders WHERE DATE(created_at) = ?',
      [today]
    );

    const [[badReviewRate]] = await pool.query(
      `SELECT
         ROUND(SUM(rating <= 2) / COUNT(*) * 100, 2) AS rate
       FROM merchant_reviews
       WHERE DATE(created_at) = ?`,
      [today]
    );

    res.json({
      success: true,
      data: {
        todayOrders: parseInt(orderStats.totalOrders),
        activeOrders: parseInt(orderStats.activeOrders),
        todayRevenue: parseFloat(parseFloat(orderStats.todayRevenue).toFixed(2)),
        avgOrderValue: parseFloat(parseFloat(orderStats.avgOrderValue).toFixed(2)),
        onlineRiders: parseInt(onlineRiders.count),
        onlineMerchants: parseInt(onlineMerchants.count),
        activeUsers: parseInt(activeUsers.count),
        badReviewRate: parseFloat(badReviewRate.rate || 0)
      }
    });
  } catch (error) {
    console.error('Get realtime dashboard error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 经营趋势（日/周/月）
// GET /api/admin/dashboard/trends?period=week
router.get('/dashboard/trends', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const now = new Date();
    let startDate;

    if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      startDate = d.toISOString().slice(0, 10);
    } else if (period === 'month') {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      startDate = now.toISOString().slice(0, 10);
    }

    const [daily] = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*) AS orders,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN commission END), 0) AS commission,
         COUNT(DISTINCT user_id) AS activeUsers
       FROM merchant_orders
       WHERE DATE(created_at) >= ?
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [startDate]
    );

    const [newUsers] = await pool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
       FROM users WHERE DATE(created_at) >= ?
       GROUP BY DATE(created_at)`,
      [startDate]
    );

    res.json({
      success: true,
      data: {
        period,
        orders: daily.map(d => ({ date: String(d.date).slice(0, 10), count: parseInt(d.orders), revenue: parseFloat(d.revenue), commission: parseFloat(d.commission), activeUsers: parseInt(d.activeUsers) })),
        newUsers: newUsers.map(u => ({ date: u.date ? (u.date instanceof Date ? u.date.toISOString().slice(0, 10) : String(u.date).slice(0, 10)) : '', count: parseInt(u.count) }))
      }
    });
  } catch (error) {
    console.error('Get trends error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户分析
// GET /api/admin/dashboard/user-analysis
router.get('/dashboard/user-analysis', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [[totals]] = await pool.query('SELECT COUNT(*) AS totalUsers FROM users');

    const [[newMonth]] = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE DATE(created_at) >= ?', [thirtyDaysAgo]
    );

    // 复购用户（30天内下单2次以上）
    const [[repurchase]] = await pool.query(
      `SELECT COUNT(*) AS count FROM (
        SELECT user_id FROM merchant_orders
        WHERE DATE(created_at) >= ? AND status = 'completed'
        GROUP BY user_id HAVING COUNT(*) >= 2
      ) AS sub`,
      [thirtyDaysAgo]
    ).then(([[r]]) => [[r || { count: 0 }]]).catch(() => [[{ count: 0 }]]);

    // 今日活跃用户
    const [[todayActive]] = await pool.query(
      'SELECT COUNT(DISTINCT user_id) AS count FROM merchant_orders WHERE DATE(created_at) = ?', [today]
    );

    res.json({
      success: true,
      data: {
        totalUsers: parseInt(totals.totalUsers),
        newUsersMonth: parseInt(newMonth.count),
        repurchaseUsers: parseInt(repurchase.count || 0),
        todayActiveUsers: parseInt(todayActive.count)
      }
    });
  } catch (error) {
    console.error('Get user analysis error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 运营日志
// GET /api/admin/operation-logs?page=1
router.get('/operation-logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    const [logs] = await pool.query(
      `SELECT l.*, u.name AS admin_name
       FROM admin_operation_logs l
       LEFT JOIN users u ON l.admin_id = u.id
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [limit, (parseInt(page) - 1) * limit]
    );

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Get operation logs error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 用户管理（新增） ==========

// 获取用户列表
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, keyword, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;

    let sql = 'SELECT id, phone, name, avatar, balance, created_at FROM users WHERE 1=1';
    const params = [];

    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${safeKeyword}%`, `%${safeKeyword}%`);
    }
    // status 字段暂不存在于 users 表
    if (false && status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [users] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM users');

    res.json({ success: true, data: users, total });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户详情
router.get('/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const [users] = await pool.query('SELECT id, phone, name, avatar, balance, created_at FROM users WHERE id = ?', [id]);
    if (users.length === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    const [orderStats] = await pool.query(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(actual_amount), 0) as total_spent
       FROM merchant_orders WHERE user_id = ?`, [id]
    );

    res.json({ success: true, data: { ...users[0], ...orderStats[0] } });
  } catch (error) {
    console.error('Get user detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 封禁/解封用户
router.put('/users/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'banned'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);

    // 记录操作日志
    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, status === 'banned' ? 'ban_user' : 'unban_user', 'user', parseInt(id), JSON.stringify({ reason: reason || '' })]
    );

    res.json({ success: true, message: status === 'banned' ? '用户已封禁' : '用户已解封' });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 商家管理（增强） ==========

// 商家入驻审核列表
router.get('/merchants/pending', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [merchants] = await pool.query(
      "SELECT id, name, phone, address, category, is_open, rating, total_orders, qualification_status, created_at FROM merchants WHERE qualification_status = 'pending' ORDER BY created_at DESC"
    );
    res.json({ success: true, data: merchants });
  } catch (error) {
    console.error('Get pending merchants error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核商家
router.put('/merchants/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: 'approve' 或 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: '无效的审核操作' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await pool.query('UPDATE merchants SET qualification_status = ? WHERE id = ?', [newStatus, id]);

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, `review_merchant_${action}`, 'merchant', parseInt(id), JSON.stringify({ reason: reason || '' })]
    );

    res.json({ success: true, message: action === 'approve' ? '商家审核通过' : '商家审核已拒绝' });
  } catch (error) {
    console.error('Review merchant error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家状态管理（暂停/恢复/关闭）
router.put('/merchants/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, businessStatus } = req.body;
    const finalStatus = businessStatus || status;
    if (!["open","paused","closed"].includes(finalStatus)) {
      return res.status(400).json({ success: false, message: "无效的状态" });
    }
    await pool.query("UPDATE merchants SET business_status = ? WHERE id = ?", [finalStatus, id]);
    await pool.query("INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)", [req.user.id, "set_merchant_status_" + finalStatus, "merchant", parseInt(id), JSON.stringify({status: finalStatus})]);
    res.json({ success: true, message: "商家状态已更新" });
  } catch (error) {
    console.error("Update merchant status error:", error);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});

// ========== 订单管理（增强） ==========

// 订单详情
router.get('/orders/:type/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, id } = req.params;
    // 白名单验证表名
    const allowedTables = { 'merchant': 'merchant_orders', 'rider': 'rider_orders' };
    if (!allowedTables[type]) {
      return res.status(400).json({ success: false, message: '无效的订单类型' });
    }
    const table = allowedTables[type];

    const [orders] = await pool.query(`SELECT id, order_no, user_id, merchant_id, order_amount, commission, actual_amount, delivery_fee, discount, status, cancel_reason, created_at, delivered_at FROM ${table} WHERE id = ?`, [parseInt(id)]);
    if (orders.length === 0) return res.status(404).json({ success: false, message: '订单不存在' });

    // 获取操作日志
    const [logs] = await pool.query(
      'SELECT id, admin_id, action, target_type, target_id, details, created_at FROM admin_operation_logs WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC',
      [`order_${type}`, parseInt(id)]
    );

    res.json({ success: true, data: { order: orders[0], logs } });
  } catch (error) {
    console.error('Get order detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 强制取消订单
router.put('/orders/:type/:id/cancel', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;
    // 白名单验证表名
    const allowedTables = { 'merchant': 'merchant_orders', 'rider': 'rider_orders' };
    if (!allowedTables[type]) {
      return res.status(400).json({ success: false, message: '无效的订单类型' });
    }
    const table = allowedTables[type];

    const [orders] = await pool.query(`SELECT id, order_no, user_id, merchant_id, order_amount, commission, actual_amount, delivery_fee, discount, status, cancel_reason, created_at, delivered_at FROM ${table} WHERE id = ?`, [parseInt(id)]);
    if (orders.length === 0) return res.status(404).json({ success: false, message: '订单不存在' });

    await pool.query(`UPDATE ${table} SET status = 'cancelled', cancel_reason = ? WHERE id = ?`, [reason || '管理员强制取消', parseInt(id)]);

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'force_cancel_order', `order_${type}`, parseInt(id), JSON.stringify({ reason: reason || '' })]
    );

    res.json({ success: true, message: '订单已取消' });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 改派骑手
router.put('/orders/rider/:id/reassign', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { riderId } = req.body;

    if (!riderId) return res.status(400).json({ success: false, message: '缺少骑手ID' });

    // 验证骑手存在且在线
    const [riders] = await pool.query('SELECT id, status FROM riders WHERE id = ? AND status = "online"', [riderId]);
    if (riders.length === 0) {
      return res.status(400).json({ success: false, message: '骑手不存在或不在线' });
    }

    // 验证订单存在且状态允许改派
    const [orders] = await pool.query('SELECT id, status FROM rider_orders WHERE id = ?', [parseInt(id)]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }
    if (!['pending', 'accepted'].includes(orders[0].status)) {
      return res.status(400).json({ success: false, message: '订单状态不支持重新分配' });
    }

    await pool.query('UPDATE rider_orders SET rider_id = ? WHERE id = ?', [riderId, parseInt(id)]);

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'reassign_rider', 'order_rider', parseInt(id), JSON.stringify({ newRiderId: riderId })]
    );

    res.json({ success: true, message: '骑手已改派' });
  } catch (error) {
    console.error('Reassign rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 优惠券管理 ==========

// 获取优惠券列表
router.get('/coupons', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;

    let sql = 'SELECT id, code, name, type, discount_type, discount_value, threshold_amount, max_discount, total_quantity, remaining_quantity, per_user_limit, start_time, end_time, merchant_id, status, created_at FROM coupons WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [coupons] = await pool.query(sql, params);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM coupons');

    res.json({ success: true, data: { coupons, total } });
  } catch (error) {
    console.error('Get coupons error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建优惠券
router.post('/coupons', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, type, discountType, discountValue, thresholdAmount, maxDiscount, totalQuantity, perUserLimit, startTime, endTime, merchantId } = req.body;

    if (!name || !discountType || !discountValue || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const parsedDiscountValue = parseFloat(discountValue);
    if (isNaN(parsedDiscountValue) || !isFinite(parsedDiscountValue) || parsedDiscountValue <= 0) {
      return res.status(400).json({ success: false, message: '无效的优惠金额' });
    }

    if (thresholdAmount !== undefined) {
      const v = parseFloat(thresholdAmount);
      if (isNaN(v) || !isFinite(v) || v < 0) return res.status(400).json({ success: false, message: '无效的门槛金额' });
    }

    const code = 'CPN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

    const [result] = await pool.query(
      `INSERT INTO coupons (code, name, type, discount_type, discount_value, threshold_amount, max_discount, total_quantity, remaining_quantity, per_user_limit, start_time, end_time, merchant_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [code, name, type || 'platform', discountType, discountValue, thresholdAmount || 0, maxDiscount || null, totalQuantity || 0, totalQuantity || 0, perUserLimit || 1, startTime, endTime, merchantId || null, req.user.id]
    );

    res.json({ success: true, message: '优惠券创建成功', data: { id: result.insertId, code } });
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 停用/启用优惠券
router.put('/coupons/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const ALLOWED_STATUSES = ['active', 'inactive', 'expired'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    await pool.query('UPDATE coupons SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: '优惠券状态已更新' });
  } catch (error) {
    console.error('Update coupon status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 公告管理 ==========

// 获取公告列表
router.get('/announcements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, type, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;

    let sql = 'SELECT id, title, content, type, priority, start_time, end_time, is_top, status, created_by, published_at, created_at FROM announcements WHERE 1=1';
    const params = [];

    if (type && type !== 'all') {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (status && status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY is_top DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [announcements] = await pool.query(sql, params);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM announcements');

    res.json({ success: true, data: announcements, total });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建公告
router.post('/announcements', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, content, type, priority, startTime, endTime, isTop } = req.body;

    if (!title || !content || !type) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    await pool.query(
      `INSERT INTO announcements (title, content, type, priority, start_time, end_time, is_top, status, created_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, NOW())`,
      [title, content, type, priority || 'normal', startTime || new Date(), endTime || null, isTop ? 1 : 0, req.user.id]
    );

    res.json({ success: true, message: '公告已发布' });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除/归档公告
router.put('/announcements/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const ALLOWED_STATUSES = ['published', 'archived', 'deleted'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    await pool.query('UPDATE announcements SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: '公告状态已更新' });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 配送费配置 ==========

// 获取配送费配置
router.get('/delivery-fee', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [configs] = await pool.query("SELECT id, base_fee, base_distance, extra_fee_per_km, max_fee, night_fee_extra, night_start_time, night_end_time, status FROM delivery_fee_configs WHERE status = 'active' ORDER BY is_default DESC");
    res.json({ success: true, data: configs });
  } catch (error) {
    console.error('Get delivery fee config error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新配送费配置
router.put('/delivery-fee/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { baseFee, baseDistance, extraFeePerKm, maxFee, nightFeeExtra, nightStartTime, nightEndTime } = req.body;

    if (baseFee !== undefined) {
      const v = parseFloat(baseFee);
      if (isNaN(v) || !isFinite(v) || v < 0) return res.status(400).json({ success: false, message: '无效的基础配送费' });
    }
    if (baseDistance !== undefined) {
      const v = parseFloat(baseDistance);
      if (isNaN(v) || !isFinite(v) || v <= 0) return res.status(400).json({ success: false, message: '无效的基础距离' });
    }
    if (extraFeePerKm !== undefined) {
      const v = parseFloat(extraFeePerKm);
      if (isNaN(v) || !isFinite(v) || v < 0) return res.status(400).json({ success: false, message: '无效的超出费用' });
    }
    if (maxFee !== undefined) {
      const v = parseFloat(maxFee);
      if (isNaN(v) || !isFinite(v) || v <= 0) return res.status(400).json({ success: false, message: '无效的最大费用' });
    }

    await pool.query(
      `UPDATE delivery_fee_configs SET base_fee = ?, base_distance = ?, extra_fee_per_km = ?, max_fee = ?, night_fee_extra = ?, night_start_time = ?, night_end_time = ? WHERE id = ?`,
      [baseFee, baseDistance, extraFeePerKm, maxFee, nightFeeExtra, nightStartTime, nightEndTime, id]
    );

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'update_delivery_fee', 'delivery_fee_config', parseInt(id), JSON.stringify(req.body)]
    );

    res.json({ success: true, message: '配送费配置已更新' });
  } catch (error) {
    console.error('Update delivery fee error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 增强统计（新增） ==========

// 营收趋势（近7天/30天）
router.get('/stats/revenue-trend', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const [trend] = await pool.query(
      `SELECT DATE(created_at) as date, SUM(actual_amount) as revenue, COUNT(*) as orders
       FROM merchant_orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND status = 'completed'
       GROUP BY DATE(created_at) ORDER BY date`,
      [parseInt(days)]
    );

    res.json({ success: true, data: trend });
  } catch (error) {
    console.error('Get revenue trend error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手审核
router.put('/riders/:id/review', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    const newStatus = action === 'approve' ? 'offline' : 'offline';
    await pool.query('UPDATE riders SET status = ? WHERE id = ?', [newStatus, id]);

    await pool.query(
      'INSERT INTO admin_operation_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, `review_rider_${action}`, 'rider', parseInt(id), JSON.stringify({ reason: reason || '' })]
    );

    res.json({ success: true, message: action === 'approve' ? '骑手审核通过' : '骑手审核已拒绝' });
  } catch (error) {
    console.error('Review rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 管理员信息 ==========

// 获取管理员个人信息
// GET /api/admin/profile
router.get('/profile', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // 管理员是系统内置角色，没有独立的 admins 表
    // 从 JWT 中提取信息，并补充平台统计
    const [[{ riderCount }]] = await pool.query('SELECT COUNT(*) as riderCount FROM riders');
    const [[{ merchantCount }]] = await pool.query('SELECT COUNT(*) as merchantCount FROM merchants');
    const [[{ userCount }]] = await pool.query('SELECT COUNT(*) as userCount FROM users');

    res.json({
      success: true,
      data: {
        id: req.user.id,
        username: req.user.phone || 'admin',
        role: req.user.role,
        platformStats: {
          totalRiders: riderCount,
          totalMerchants: merchantCount,
          totalUsers: userCount
        }
      }
    });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 仪表盘概览 ==========

// 获取管理仪表盘数据
// GET /api/admin/dashboard
router.get('/dashboard', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // 今日订单统计
    const [[orderStats]] = await pool.query(
      `SELECT
         COUNT(*) AS totalOrders,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pendingOrders,
         COUNT(CASE WHEN status = 'accepted' THEN 1 END) AS acceptedOrders,
         COUNT(CASE WHEN status = 'ready' THEN 1 END) AS readyOrders,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completedOrders,
         COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelledOrders,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_amount END), 0) AS todayRevenue,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN commission END), 0) AS todayCommission
       FROM merchant_orders
       WHERE DATE(created_at) = ?`,
      [today]
    );

    // 在线状态
    const [[onlineRiders]] = await pool.query(
      "SELECT COUNT(*) AS count FROM riders WHERE status = 'online'"
    );
    const [[onlineMerchants]] = await pool.query(
      'SELECT COUNT(*) AS count FROM merchants WHERE is_open = 1'
    );
    const [[totalRiders]] = await pool.query('SELECT COUNT(*) AS count FROM riders');
    const [[totalMerchants]] = await pool.query('SELECT COUNT(*) AS count FROM merchants');
    const [[totalUsers]] = await pool.query('SELECT COUNT(*) AS count FROM users');

    // 今日活跃用户
    const [[activeUsers]] = await pool.query(
      'SELECT COUNT(DISTINCT user_id) AS count FROM merchant_orders WHERE DATE(created_at) = ?',
      [today]
    );

    // 近7天营收趋势
    const [recentOrders] = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*) AS orders,
         COALESCE(SUM(actual_amount), 0) AS revenue
       FROM merchant_orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    // 今日新用户
    const [[newUsers]] = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE DATE(created_at) = ?',
      [today]
    );

    // 今日新增骑手
    const [[newRiders]] = await pool.query(
      'SELECT COUNT(*) AS count FROM riders WHERE DATE(created_at) = ?',
      [today]
    );

    // 待处理提现
    const [[pendingWithdrawals]] = await pool.query(
      "SELECT COUNT(*) AS count FROM withdrawals WHERE status = 'pending'"
    );

    // 最近订单列表（最新5条）
    const [latestOrders] = await pool.query(
      `SELECT mo.id, mo.order_no, mo.status, mo.actual_amount, mo.created_at,
              u.name AS user_name, m.name AS merchant_name
       FROM merchant_orders mo
       LEFT JOIN users u ON mo.user_id = u.id
       LEFT JOIN merchants m ON mo.merchant_id = m.id
       ORDER BY mo.created_at DESC LIMIT 5`
    );

    res.json({
      success: true,
      data: {
        // 核心指标卡片
        overview: {
          todayOrders: parseInt(orderStats.totalOrders),
          todayRevenue: parseFloat(parseFloat(orderStats.todayRevenue).toFixed(2)),
          todayCommission: parseFloat(parseFloat(orderStats.todayCommission).toFixed(2)),
          activeUsers: parseInt(activeUsers.count),
          newUsers: parseInt(newUsers.count),
          newRiders: parseInt(newRiders.count)
        },
        // 订单状态分布
        orderStatus: {
          pending: parseInt(orderStats.pendingOrders),
          accepted: parseInt(orderStats.acceptedOrders),
          ready: parseInt(orderStats.readyOrders),
          completed: parseInt(orderStats.completedOrders),
          cancelled: parseInt(orderStats.cancelledOrders)
        },
        // 平台资源
        platformResources: {
          totalRiders: totalRiders.count,
          onlineRiders: onlineRiders.count,
          totalMerchants: totalMerchants.count,
          onlineMerchants: onlineMerchants.count,
          totalUsers: totalUsers.count
        },
        // 营收趋势（近7天）
        revenueTrend: recentOrders.map(d => ({
          date: d.date ? (d.date instanceof Date ? d.date.toISOString().slice(0, 10) : String(d.date).slice(0, 10)) : '',
          orders: parseInt(d.orders),
          revenue: parseFloat(parseFloat(d.revenue).toFixed(2))
        })),
        // 待处理事项
        pendingItems: {
          withdrawals: pendingWithdrawals.count
        },
        // 最新订单
        latestOrders: latestOrders.map(o => ({
          id: o.id,
          orderNo: o.order_no,
          userName: o.user_name,
          merchantName: o.merchant_name,
          status: o.status,
          amount: parseFloat(o.actual_amount),
          createdAt: o.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 评价管理
// ============================================================

// 获取评价列表（支持按商家/用户/评分筛选）
router.get('/reviews', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, merchant_id, user_id, min_rating, max_rating, keyword } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (merchant_id) { where += ' AND mr.merchant_id = ?'; params.push(merchant_id); }
    if (user_id) { where += ' AND mr.user_id = ?'; params.push(user_id); }
    if (min_rating) { where += ' AND mr.rating >= ?'; params.push(min_rating); }
    if (max_rating) { where += ' AND mr.rating <= ?'; params.push(max_rating); }
    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      where += ' AND (mr.content LIKE ? OR u.name LIKE ?)';
      params.push(`%${safeKeyword}%`, `%${safeKeyword}%`);
    }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM merchant_reviews mr LEFT JOIN users u ON mr.user_id = u.id ${where}`, params);
    const [reviews] = await pool.query(
      `SELECT mr.id, mr.merchant_id, mr.user_id, mr.order_id, mr.rating, mr.content, mr.reply, mr.created_at, u.name as user_name, u.avatar as user_avatar, m.name as merchant_name
       FROM merchant_reviews mr
       LEFT JOIN users u ON mr.user_id = u.id
       LEFT JOIN merchants m ON mr.merchant_id = m.id
       ${where} ORDER BY mr.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { reviews, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除评价
router.delete('/reviews/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM merchant_reviews WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM review_images WHERE review_id = ?', [req.params.id]);
    res.json({ success: true, message: '评价已删除' });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 退款管理
// ============================================================

// 获取退款列表
router.get('/refunds', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, merchant_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND rf.status = ?'; params.push(status); }
    if (merchant_id) { where += ' AND rf.merchant_id = ?'; params.push(merchant_id); }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM merchant_refunds rf ${where}`, params);
    const [refunds] = await pool.query(
      `SELECT rf.*, m.name as merchant_name, u.name as user_name, mo.order_no
       FROM merchant_refunds rf
       LEFT JOIN merchants m ON rf.merchant_id = m.id
       LEFT JOIN merchant_orders mo ON rf.order_id = mo.id
       LEFT JOIN users u ON mo.user_id = u.id
       ${where} ORDER BY rf.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { refunds, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get refunds error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 退款仲裁（通过/拒绝）
router.put('/refunds/:id/arbitrate', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { action, remark } = req.body; // action: 'approve' | 'reject'
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: '无效操作' });
    }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await pool.query('UPDATE merchant_refunds SET status = ?, admin_remark = ?, processed_at = NOW() WHERE id = ?', [newStatus, remark || '', req.params.id]);

    if (action === 'approve') {
      // 退款通过时更新订单状态
      const [refund] = await pool.query('SELECT order_id FROM merchant_refunds WHERE id = ?', [req.params.id]);
      if (refund.length > 0) {
        await pool.query("UPDATE merchant_orders SET status = 'cancelled' WHERE id = ?", [refund[0].order_id]);
      }
    }

    res.json({ success: true, message: action === 'approve' ? '退款已通过' : '退款已拒绝' });
  } catch (error) {
    console.error('Arbitrate refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 支付流水
// ============================================================

// 获取支付流水列表
router.get('/payments', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status, channel, start_date, end_date } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (channel) { where += ' AND p.channel = ?'; params.push(channel); }
    if (start_date) { where += ' AND p.created_at >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND p.created_at <= ?'; params.push(end_date + ' 23:59:59'); }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM payments p ${where}`, params);
    const [payments] = await pool.query(
      `SELECT p.*, u.name as user_name
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { payments, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 商家菜品管理（查看）
// ============================================================

// 获取商家菜品列表
router.get('/merchants/:id/menu', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [items] = await pool.query(
      'SELECT id, merchant_id, name, description, price, original_price, image, category_id, sort_order, status, sales_count FROM merchant_menu WHERE merchant_id = ? ORDER BY sort_order ASC, id DESC',
      [req.params.id]
    );
    const [categories] = await pool.query(
      'SELECT id, merchant_id, name, sort_order FROM menu_categories WHERE merchant_id = ? ORDER BY sort_order ASC',
      [req.params.id]
    );
    res.json({ success: true, data: { items, categories } });
  } catch (error) {
    console.error('Get merchant menu error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 管理端下架菜品
router.put('/menu/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    const ALLOWED_STATUSES = ['active', 'inactive', 'sold_out'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    await pool.query('UPDATE merchant_menu SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: '菜品状态已更新' });
  } catch (error) {
    console.error('Update menu status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 用户数据管理（扩展）
// ============================================================

// 获取用户详细信息（含积分、会员、地址数等）
router.get('/users/:id/full', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, name, phone, avatar, gender, birthday, points, member_level, balance, status, created_at FROM users WHERE id = ?', [req.params.id]);
    if (users.length === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    const [orderStats] = await pool.query('SELECT COUNT(*) as total_orders, COALESCE(SUM(actual_amount), 0) as total_spent FROM merchant_orders WHERE user_id = ?', [req.params.id]);
    const [addressCount] = await pool.query('SELECT COUNT(*) as count FROM user_addresses WHERE user_id = ? AND is_deleted = 0', [req.params.id]);
    const [couponCount] = await pool.query("SELECT COUNT(*) as count FROM user_coupons WHERE user_id = ? AND status = 'unused'", [req.params.id]);
    const [reviewCount] = await pool.query('SELECT COUNT(*) as count FROM merchant_reviews WHERE user_id = ?', [req.params.id]);

    res.json({ success: true, data: { ...users[0], orderStats: orderStats[0], addressCount: addressCount[0].count, couponCount: couponCount[0].count, reviewCount: reviewCount[0].count } });
  } catch (error) {
    console.error('Get user full error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取用户收货地址列表
router.get('/users/:id/addresses', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [addresses] = await pool.query('SELECT id, user_id, name, phone, province, city, district, detail, is_default, created_at FROM user_addresses WHERE user_id = ? AND is_deleted = 0 ORDER BY is_default DESC, id DESC', [req.params.id]);
    res.json({ success: true, data: addresses });
  } catch (error) {
    console.error('Get user addresses error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取用户反馈列表
router.get('/feedbacks', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND f.status = ?'; params.push(status); }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM user_feedback f ${where}`, params);
    const [feedbacks] = await pool.query(
      `SELECT f.*, u.name as user_name, u.phone as user_phone
       FROM user_feedback f
       LEFT JOIN users u ON f.user_id = u.id
       ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { feedbacks, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get feedbacks error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 处理用户反馈
router.put('/feedbacks/:id/handle', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, reply } = req.body;

    const ALLOWED_STATUSES = ['pending', 'processed', 'closed'];
    const resolvedStatus = ALLOWED_STATUSES.includes(status) ? status : 'processed';

    await pool.query('UPDATE user_feedback SET status = ?, admin_reply = ?, processed_at = NOW() WHERE id = ?', [resolvedStatus, reply || '', req.params.id]);
    res.json({ success: true, message: '反馈已处理' });
  } catch (error) {
    console.error('Handle feedback error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 骑手数据管理（扩展）
// ============================================================

// 获取骑手收入明细
router.get('/riders/:id/income', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (parseInt(page) - 1) * limit;
    const [records] = await pool.query(
      'SELECT id, rider_id, date, total AS amount, order_count, base_income, peak_bonus, weather_bonus, reward_bonus FROM income_records WHERE rider_id = ? ORDER BY date DESC LIMIT ? OFFSET ?',
      [req.params.id, limit, parseInt(offset)]
    );
    const [summary] = await pool.query(
      'SELECT COALESCE(SUM(total), 0) as total_income, COUNT(*) as total_orders FROM income_records WHERE rider_id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: { records, summary: summary[0] } });
  } catch (error) {
    console.error('Get rider income error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取骑手申诉列表
router.get('/appeals', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND a.status = ?'; params.push(status); }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM rider_appeals a ${where}`, params);
    const [appeals] = await pool.query(
      `SELECT a.*, r.name as rider_name, r.phone as rider_phone
       FROM rider_appeals a
       LEFT JOIN riders r ON a.rider_id = r.id
       ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { appeals, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get appeals error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取商家活动列表
router.get('/merchant-promotions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, merchant_id, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (parseInt(page) - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (merchant_id) { where += ' AND mp.merchant_id = ?'; params.push(merchant_id); }
    if (status) { where += ' AND mp.status = ?'; params.push(status); }

    const [total] = await pool.query(`SELECT COUNT(*) as count FROM merchant_promotions mp ${where}`, params);
    const [promotions] = await pool.query(
      `SELECT mp.*, m.name as merchant_name
       FROM merchant_promotions mp
       LEFT JOIN merchants m ON mp.merchant_id = m.id
       ${where} ORDER BY mp.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, parseInt(offset)]
    );
    res.json({ success: true, data: { promotions, total: total[0].count, page: parseInt(page), limit } });
  } catch (error) {
    console.error('Get merchant promotions error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 管理端关闭商家活动
router.put('/merchant-promotions/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    const ALLOWED_STATUSES = ['active', 'inactive', 'expired', 'cancelled'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    await pool.query('UPDATE merchant_promotions SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: '活动状态已更新' });
  } catch (error) {
    console.error('Update promotion status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// Dashboard 统计概览
router.get('/dashboard/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [
      [userCount],
      [riderCount],
      [merchantCount],
      [orderCount],
      [todayOrders],
      [todayRevenue]
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM users'),
      pool.query('SELECT COUNT(*) AS total FROM riders'),
      pool.query('SELECT COUNT(*) AS total FROM merchants'),
      pool.query('SELECT COUNT(*) AS total FROM merchant_orders'),
      pool.query("SELECT COUNT(*) AS total FROM merchant_orders WHERE DATE(created_at) = CURDATE()"),
      pool.query("SELECT COALESCE(SUM(actual_amount), 0) AS total FROM merchant_orders WHERE DATE(created_at) = CURDATE()")
    ]);

    res.json({
      success: true,
      data: {
        users: userCount[0].total,
        riders: riderCount[0].total,
        merchants: merchantCount[0].total,
        totalOrders: orderCount[0].total,
        todayOrders: todayOrders[0].total,
        todayRevenue: parseFloat(todayRevenue[0].total)
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 系统设置
router.get('/settings', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [deliveryFee] = await pool.query(
      'SELECT * FROM delivery_fee_configs ORDER BY id'
    );
    const [couponCount] = await pool.query('SELECT COUNT(*) AS total FROM coupons');
    const [announcementCount] = await pool.query('SELECT COUNT(*) AS total FROM announcements');

    res.json({
      success: true,
      data: {
        deliveryFeeConfig: deliveryFee.length > 0 ? deliveryFee[0] : null,
        totalCoupons: couponCount[0].total,
        totalAnnouncements: announcementCount[0].total,
        appVersion: {
          rider: '1.0.0',
          merchant: '1.0.0',
          user: '1.0.0'
        },
        features: {
          enableRealtimeTracking: true,
          enableAIAssignment: false,
          enablePushNotification: true
        }
      }
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 前端兼容层 - 补充缺失路由
// ============================================================

// GET /categories → 分类管理列表
router.get('/categories', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [cats] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
    res.json({
      success: true,
      data: cats.map(c => ({
        id: c.id, name: c.name, icon: c.icon, sortOrder: c.sort_order,
        status: c.status || 'active', createdAt: c.created_at
      }))
    });
  } catch (error) {
    if (error.message.includes('doesn\'t exist')) {
      return res.json({ success: true, data: [] });
    }
    console.error('Get admin categories error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

const { sendCsv } = require('../services/export');

// 订单CSV导出
router.get('/orders/export', async (req, res) => {
  try {
    const { status = 'all', type = 'rider' } = req.query;
    let where = '';
    if (status !== 'all') where += `WHERE o.status = '${status}' `;
    
    const [orders] = await pool.query(
      `SELECT o.id, o.order_no, o.status, o.total_amount, o.created_at,
              m.name as merchant_name, u.name as user_name
       FROM orders o
       LEFT JOIN merchants m ON o.merchant_id = m.id
       LEFT JOIN users u ON o.user_id = u.id
       ${where}
       ORDER BY o.created_at DESC LIMIT 5000`
    );
    
    sendCsv(res, '订单导出', 
      ['订单号','状态','金额','商家','用户','创建时间'],
      ['order_no','status','total_amount','merchant_name','user_name','created_at'],
      orders
    );
  } catch (error) {
    console.error('Export orders error:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

// 财务CSV导出
router.get('/finance/export', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let where = '';
    if (start_date) where += `AND p.created_at >= '${start_date}' `;
    if (end_date) where += `AND p.created_at <= '${end_date}' `;
    
    const [payments] = await pool.query(
      `SELECT p.id, p.order_no, p.amount, p.channel, p.status, p.created_at
       FROM payments p
       WHERE 1=1 ${where}
       ORDER BY p.created_at DESC LIMIT 5000`
    );
    
    sendCsv(res, '财务流水导出',
      ['流水号','订单号','金额','渠道','状态','时间'],
      ['id','order_no','amount','channel','status','created_at'],
      payments
    );
  } catch (error) {
    console.error('Export finance error:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});


// ========== [API补丁] 管理后台缺失接口 ==========

// 骑手详情别名
router.get('/riders/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone, level, status, total_orders, rating, today_income, month_income, balance, last_latitude, last_longitude, credit_score, real_name_status, freeze_reason, created_at FROM riders WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: '骑手不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { console.error('Get rider error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 骑手信用查询
router.get('/riders/:id/credit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rider] = await pool.query('SELECT id, credit_score FROM riders WHERE id = ?', [req.params.id]);
    if (rider.length === 0) return res.status(404).json({ success: false, message: '骑手不存在' });
    res.json({ success: true, data: { creditScore: rider[0].credit_score || 100, totalDeducted: 0, deductions: [] } });
  } catch (e) { console.error('Get rider credit error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 骑手信用调整
router.post('/riders/:id/credit/adjust', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { score, reason } = req.body;
    await pool.query('UPDATE riders SET credit_score = GREATEST(0, COALESCE(credit_score, 100) + ?) WHERE id = ?', [score || 0, req.params.id]);
    res.json({ success: true, message: '信用分已更新' });
  } catch (e) { console.error('Adjust credit error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 骑手排行榜
router.get('/leaderboard', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone, level, credit_score, rating, total_orders, month_income as total_income FROM riders ORDER BY total_orders DESC LIMIT 50');
    res.json({ success: true, data: { rankings: rows } });
  } catch (e) { console.error('Get leaderboard error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 提现列表（兼容前端路径）
router.get('/finance/withdrawals', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    let sql = 'SELECT w.id, w.rider_id, r.name as rider_name, r.phone as rider_phone, w.amount, w.status, w.created_at, w.remark FROM withdrawals w LEFT JOIN riders r ON w.rider_id = r.id WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND w.status = ?'; params.push(status); }
    sql += ' ORDER BY w.created_at DESC LIMIT 20 OFFSET ?';
    params.push((parseInt(page) - 1) * 20);
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (e) { console.error('Get withdrawals error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 黑名单列表
router.get('/blacklist/list', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, blocked_type, blocked_id, blocked_name, blocked_phone, reason, blocker_type, created_at FROM blacklist ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (e) { console.error('Get blacklist error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 黑名单配额
router.get('/blacklist/quota', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT blocked_type, COUNT(*) as count FROM blacklist GROUP BY blocked_type');
    res.json({ success: true, data: rows });
  } catch (e) { console.error('Get blacklist quota error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 取消拉黑
router.post('/blacklist/remove', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, blocked_id } = req.body;
    await pool.query('DELETE FROM blacklist WHERE blocked_type = ? AND blocked_id = ?', [blocked_type, blocked_id]);
    res.json({ success: true, message: '已取消拉黑' });
  } catch (e) { console.error('Remove blacklist error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// Banner 更新（兼容 PUT）
router.put('/banners/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { position, image, title, linkType, linkTarget, sortOrder, isActive } = req.body;
    await pool.query('UPDATE platform_banners SET position=?, image=?, title=?, link_type=?, link_target=?, sort_order=?, is_active=? WHERE id=?', [position, image, title, linkType, linkTarget, sortOrder||0, isActive?1:0, req.params.id]);
    res.json({ success: true, message: '广告位已更新' });
  } catch (e) { console.error('Update banner error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

// 配送费配置创建
router.post('/delivery-fee', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { baseFee, baseDistance, extraFeePerKm, maxFee, nightFeeExtra, nightStartTime, nightEndTime } = req.body;
    await pool.query("INSERT INTO delivery_fee_configs (base_fee, base_distance, extra_fee_per_km, max_fee, night_fee_extra, night_start_time, night_end_time, status, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1)", [baseFee||5, baseDistance||2, extraFeePerKm||2, maxFee||30, nightFeeExtra||2, nightStartTime||'22:00', nightEndTime||'06:00']);
    res.json({ success: true, message: '配送费配置已创建' });
  } catch (e) { console.error('Create delivery fee error:', e); res.status(500).json({ success: false, message: '服务器错误' }); }
});

module.exports = router;
