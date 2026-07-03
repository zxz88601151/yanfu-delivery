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

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, riderMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// 生成订单号
const generateOrderNo = () => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `R${dateStr}${random}`;
};

// 生成取餐码
const generatePickupCode = () => {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
};

// 获取骑手信息
router.get('/profile', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [riders] = await pool.query('SELECT * FROM riders WHERE id = ?', [req.user.id]);
    
    if (riders.length === 0) {
      return res.status(404).json({ success: false, message: '骑手不存在' });
    }

    const rider = riders[0];
    res.json({
      success: true,
      data: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        level: rider.level,
        status: rider.status,
        totalOrders: rider.total_orders,
        rating: rider.rating,
        todayIncome: rider.today_income,
        monthIncome: rider.month_income,
        balance: rider.balance
      }
    });
  } catch (error) {
    console.error('Get rider profile error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新骑手状态
router.put('/status', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['online', 'offline', 'rest'].includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态' });
    }

    await pool.query('UPDATE riders SET status = ? WHERE id = ?', [status, req.user.id]);
    
    res.json({ success: true, message: '状态更新成功' });
  } catch (error) {
    console.error('Update rider status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取待接单订单
router.get('/orders/pending', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT * FROM rider_orders WHERE status = "pending" ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      data: orders.map(order => ({
        id: order.id,
        orderNo: order.order_no,
        merchantName: order.merchant_name,
        merchantAddress: order.merchant_address,
        pickupAddress: order.pickup_address,
        deliveryAddress: order.delivery_address,
        deliveryName: order.delivery_name,
        deliveryPhone: order.delivery_phone,
        distance: order.distance,
        baseFare: order.base_fare,
        peakBonus: order.peak_bonus,
        weatherBonus: order.weather_bonus,
        longDistanceBonus: order.long_distance_bonus,
        rewardBonus: order.reward_bonus,
        totalIncome: order.total_income,
        pickupCode: order.pickup_code,
        weather: order.weather,
        pickupLatitude: order.pickup_latitude,
        pickupLongitude: order.pickup_longitude,
        deliveryLatitude: order.delivery_latitude,
        deliveryLongitude: order.delivery_longitude,
        createdAt: order.created_at
      }))
    });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取我的订单
router.get('/orders/my', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT * FROM rider_orders WHERE rider_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: orders.map(order => ({
        id: order.id,
        orderNo: order.order_no,
        merchantName: order.merchant_name,
        merchantAddress: order.merchant_address,
        pickupAddress: order.pickup_address,
        deliveryAddress: order.delivery_address,
        deliveryName: order.delivery_name,
        deliveryPhone: order.delivery_phone,
        distance: order.distance,
        baseFare: order.base_fare,
        peakBonus: order.peak_bonus,
        weatherBonus: order.weather_bonus,
        longDistanceBonus: order.long_distance_bonus,
        rewardBonus: order.reward_bonus,
        totalIncome: order.total_income,
        status: order.status,
        pickupCode: order.pickup_code,
        weather: order.weather,
        pickupLatitude: order.pickup_latitude,
        pickupLongitude: order.pickup_longitude,
        deliveryLatitude: order.delivery_latitude,
        deliveryLongitude: order.delivery_longitude,
        createdAt: order.created_at,
        pickedAt: order.picked_at,
        deliveredAt: order.delivered_at
      }))
    });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 接单
router.post('/orders/:id/accept', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    
    // 条件更新，只有pending状态才能接单
    const [result] = await pool.query(
      'UPDATE rider_orders SET rider_id = ?, status = "assigned" WHERE id = ? AND status = "pending"',
      [req.user.id, orderId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: '接单失败，订单已被其他骑手抢走' });
    }
    
    res.json({ success: true, message: '接单成功' });
  } catch (error) {
    console.error('Accept order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新订单状态
router.put('/orders/:id/status', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;
    
    // 验证订单归属
    const [orders] = await pool.query(
      'SELECT * FROM rider_orders WHERE id = ? AND rider_id = ?',
      [orderId, req.user.id]
    );
    
    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }

    const order = orders[0];
    const validTransitions = {
      'assigned': ['picking', 'cancelled'],
      'picking': ['delivering', 'cancelled'],
      'delivering': ['completed', 'cancelled']
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({ success: false, message: `不能从 ${order.status} 转换为 ${status}` });
    }

    const updateData = { status };
    if (status === 'picking') updateData.picked_at = new Date();
    if (status === 'delivering') {
      // 同步更新商家订单状态为配送中
      await pool.query(
        "UPDATE merchant_orders SET status = 'delivering' WHERE order_no = ? AND status IN ('ready', 'accepted')",
        [order.order_no]
      );
    }
    if (status === 'completed') {
      updateData.delivered_at = new Date();
      
      // 更新骑手收入
      await pool.query(
        'UPDATE riders SET today_income = today_income + ?, month_income = month_income + ?, total_orders = total_orders + 1 WHERE id = ?',
        [order.total_income, order.total_income, req.user.id]
      );
      
      // 添加收入记录
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(`
        INSERT INTO income_records (rider_id, date, base_income, peak_bonus, weather_bonus, reward_bonus, total, order_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
        base_income = base_income + VALUES(base_income),
        peak_bonus = peak_bonus + VALUES(peak_bonus),
        weather_bonus = weather_bonus + VALUES(weather_bonus),
        reward_bonus = reward_bonus + VALUES(reward_bonus),
        total = total + VALUES(total),
        order_count = order_count + 1
      `, [req.user.id, today, order.base_fare, order.peak_bonus, order.weather_bonus, order.reward_bonus, order.total_income]);
      
      // ========== 结算分账 ==========
      // 通过order_no关联商家订单
      const [merchantOrders] = await pool.query(
        'SELECT * FROM merchant_orders WHERE order_no = ?',
        [order.order_no]
      );
      
      if (merchantOrders.length > 0) {
        const mo = merchantOrders[0];
        
        // 更新商家订单状态为已完成
        await pool.query(
          "UPDATE merchant_orders SET status = 'completed' WHERE id = ?",
          [mo.id]
        );
        
        // 商家结算金额 = 订单金额 - 佣金
        const merchantSettlement = mo.order_amount - (mo.commission || 0);
        
        // 更新商家收入
        await pool.query(
          'UPDATE merchants SET month_revenue = month_revenue + ? WHERE id = ?',
          [merchantSettlement, mo.merchant_id]
        );
        
        // 记录商家结算（使用admin_logs代替merchant_settlements表）
        await pool.query(
          `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
           VALUES (0, 'merchant_settlement', 'merchant', ?, ?, NOW())`,
          [mo.merchant_id, JSON.stringify({
            orderNo: mo.order_no,
            orderId: mo.id,
            orderAmount: mo.order_amount,
            commission: mo.commission,
            settlementAmount: merchantSettlement
          })]
        );
        
        // 平台利润 = 佣金 + 配送费 - 骑手配送费
        const platformProfit = (mo.commission || 0) + (mo.delivery_fee || 0) - (order.total_income || 0);
        
        // 记录平台收入（可选：写入platform_revenue表）
        await pool.query(
          `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, created_at)
           VALUES (0, 'order_settlement', 'order', ?, ?, NOW())`,
          [mo.id, JSON.stringify({
            orderNo: mo.order_no,
            merchantSettlement,
            riderIncome: order.total_income,
            platformProfit,
            commission: mo.commission,
            deliveryFee: mo.delivery_fee
          })]
        );
      }
    }

    await pool.query('UPDATE rider_orders SET ? WHERE id = ?', [updateData, orderId]);
    
    res.json({ success: true, message: '状态更新成功' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取周收入
router.get('/income/week', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    const startStr = startDate.toISOString().slice(0, 10);
    
    const [records] = await pool.query(
      'SELECT * FROM income_records WHERE rider_id = ? AND date >= ? ORDER BY date ASC',
      [req.user.id, startStr]
    );
    
    res.json({
      success: true,
      data: records.map(r => ({
        date: r.date,
        baseIncome: r.base_income,
        peakBonus: r.peak_bonus,
        weatherBonus: r.weather_bonus,
        rewardBonus: r.reward_bonus,
        total: r.total,
        orderCount: r.order_count
      }))
    });
  } catch (error) {
    console.error('Get week income error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 提现 [P0修复] 使用事务 + FOR UPDATE锁防止竞态条件
router.post('/withdraw', authMiddleware, riderMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: '提现金额必须大于0' });
    }

    const withdrawAmount = parseFloat(amount);
    
    // 单次提现上限校验
    const MAX_WITHDRAWAL = 50000;
    if (withdrawAmount > MAX_WITHDRAWAL) {
      return res.status(400).json({ success: false, message: `单次提现金额不能超过${MAX_WITHDRAWAL / 10000}万元` });
    }

    await conn.beginTransaction();
    try {
      // [P0修复] 使用 FOR UPDATE 锁定行，防止并发竞态
      const [riders] = await conn.query(
        'SELECT id, balance FROM riders WHERE id = ? FOR UPDATE',
        [req.user.id]
      );
      
      if (riders.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: '骑手不存在' });
      }

      const rider = riders[0];
      const currentBalance = parseFloat(rider.balance || 0);
      
      // [P0修复] 使用原子操作检查并扣除余额
      if (currentBalance < withdrawAmount) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: '余额不足' });
      }

      // 创建提现记录
      const [result] = await conn.query(
        'INSERT INTO withdrawals (rider_id, amount) VALUES (?, ?)',
        [req.user.id, withdrawAmount]
      );

      // 原子扣除余额
      const [updateResult] = await conn.query(
        'UPDATE riders SET balance = balance - ? WHERE id = ? AND balance >= ?',
        [withdrawAmount, req.user.id, withdrawAmount]
      );
      
      if (updateResult.affectedRows === 0) {
        // 余额可能被其他请求修改，回滚
        await conn.rollback();
        return res.status(400).json({ success: false, message: '余额不足，请重试' });
      }

      await conn.commit();
      
      res.json({ 
        success: true, 
        message: '提现申请已提交',
        data: {
          id: result.insertId,
          amount: withdrawAmount,
          status: 'pending',
          remainingBalance: currentBalance - withdrawAmount
        }
      });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    }
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 获取提现记录
router.get('/withdrawals', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [records] = await pool.query(
      'SELECT * FROM withdrawals WHERE rider_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: records.map(r => ({
        id: r.id,
        amount: r.amount,
        status: r.status,
        createdAt: r.created_at,
        completedAt: r.completed_at,
        remark: r.remark
      }))
    });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /orders/available → 可接订单（必须在 /orders/:id 之前）
router.get('/orders/available', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT * FROM rider_orders WHERE status = "pending" ORDER BY created_at DESC LIMIT 50'
    );
    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id, orderNo: o.order_no, merchantName: o.merchant_name,
        pickupAddress: o.pickup_address, deliveryAddress: o.delivery_address,
        distance: o.distance, amount: parseFloat(o.amount || 0),
        status: o.status, createdAt: o.created_at
      }))
    });
  } catch (error) {
    console.error('Get available orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单详情
router.get('/orders/:id', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT * FROM rider_orders WHERE id = ? AND rider_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];
    res.json({
      success: true,
      data: {
        id: order.id,
        orderNo: order.order_no,
        merchantName: order.merchant_name,
        merchantAddress: order.merchant_address,
        pickupAddress: order.pickup_address,
        deliveryAddress: order.delivery_address,
        deliveryName: order.delivery_name,
        deliveryPhone: order.delivery_phone,
        distance: order.distance,
        baseFare: order.base_fare,
        peakBonus: order.peak_bonus,
        weatherBonus: order.weather_bonus,
        longDistanceBonus: order.long_distance_bonus,
        rewardBonus: order.reward_bonus,
        totalIncome: order.total_income,
        status: order.status,
        pickupCode: order.pickup_code,
        weather: order.weather,
        pickupLatitude: order.pickup_latitude,
        pickupLongitude: order.pickup_longitude,
        deliveryLatitude: order.delivery_latitude,
        deliveryLongitude: order.delivery_longitude,
        createdAt: order.created_at,
        pickedAt: order.picked_at,
        deliveredAt: order.delivered_at
      }
    });
  } catch (error) {
    console.error('Get order detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手位置上报
// PUT /api/rider/location { latitude, longitude, address }
router.put('/location', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: '缺少经纬度参数' });
    }

    await pool.query(
      `UPDATE riders
       SET last_latitude = ?, last_longitude = ?, last_address = ?, last_location_at = NOW()
       WHERE id = ?`,
      [latitude, longitude, address || null, req.user.id]
    );

    res.json({ success: true, message: '位置更新成功' });
  } catch (error) {
    console.error('Update rider location error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 评价与信用模块
// ============================================================

// 获取收到的评价列表
// GET /api/rider/reviews?page=1&pageSize=20
router.get('/reviews', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const [reviews] = await pool.query(
      `SELECT id, order_id, order_no, rating, comment, type, created_at
       FROM rider_reviews
       WHERE rider_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM rider_reviews WHERE rider_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: reviews.map(r => ({
          id: r.id,
          orderId: r.order_id,
          orderNo: r.order_no,
          rating: r.rating,
          comment: r.comment,
          reply: null,
          type: r.type,
          createdAt: r.created_at
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取信用分详情
// GET /api/rider/credit
router.get('/credit', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT credit_score, level, rating, total_orders FROM riders WHERE id = ?',
      [req.user.id]
    );

    if (!rider) {
      return res.status(404).json({ success: false, message: '骑手不存在' });
    }

    // 获取最近30天扣分记录
    const [deductions] = await pool.query(
      `SELECT id, reason, score, created_at
       FROM credit_deductions
       WHERE rider_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        creditScore: rider.credit_score || 100,
        level: rider.level,
        rating: rider.rating,
        totalOrders: rider.total_orders,
        recentDeductions: deductions.map(d => ({
          id: d.id,
          reason: d.reason,
          score: d.score,
          createdAt: d.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get credit error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 提交申诉（差评/扣分申诉）
// POST /api/rider/appeals
// body: { type, targetId, reason, evidence[] }
router.post('/appeals', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { type, targetId, reason, evidence } = req.body;

    if (!type || !targetId || !reason) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    if (!['review', 'deduction', 'order'].includes(type)) {
      return res.status(400).json({ success: false, message: '申诉类型无效' });
    }

    // 检查是否重复申诉
    const [existing] = await pool.query(
      'SELECT id FROM rider_appeals WHERE rider_id = ? AND type = ? AND target_id = ? AND status = "pending"',
      [req.user.id, type, targetId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该项已在申诉中，请勿重复提交' });
    }

    const evidenceJson = evidence ? JSON.stringify(evidence) : null;
    await pool.query(
      'INSERT INTO rider_appeals (rider_id, type, target_id, reason, evidence) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, type, targetId, reason, evidenceJson]
    );

    res.json({ success: true, message: '申诉已提交，预计1-3个工作日内处理' });
  } catch (error) {
    console.error('Submit appeal error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取申诉列表
// GET /api/rider/appeals
router.get('/appeals', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [appeals] = await pool.query(
      `SELECT id, type, target_id, reason, status, result, created_at, updated_at
       FROM rider_appeals
       WHERE rider_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: appeals.map(a => ({
        id: a.id,
        type: a.type,
        targetId: a.target_id,
        reason: a.reason,
        status: a.status,   // pending/approved/rejected
        result: a.result,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      }))
    });
  } catch (error) {
    console.error('Get appeals error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取骑手公告列表
// GET /api/rider/announcements
router.get('/announcements', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [announcements] = await pool.query(
      `SELECT id, title, content, type, status, created_at
       FROM announcements
       WHERE (type = 'platform' OR type = 'rider') AND status = 'published'
       ORDER BY created_at DESC
       LIMIT 20`
    );

    res.json({
      success: true,
      data: announcements.map(a => ({
        id: a.id,
        title: a.title,
        content: a.content,
        type: a.type,
        published: a.status === 'published'
      }))
    });
  } catch (error) {
    console.error('Get rider announcements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 收入扩展模块
// ============================================================

// 月收入统计
// GET /api/rider/income/month?year=2025&month=5
router.get('/income/month', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    const [records] = await pool.query(
      `SELECT date, base_income, peak_bonus, weather_bonus, reward_bonus, total, order_count
       FROM income_records
       WHERE rider_id = ? AND date LIKE ?
       ORDER BY date ASC`,
      [req.user.id, `${monthStr}%`]
    );

    const totalMonth = records.reduce((sum, r) => sum + parseFloat(r.total || 0), 0);
    const totalOrders = records.reduce((sum, r) => sum + parseInt(r.order_count || 0), 0);

    res.json({
      success: true,
      data: {
        year,
        month,
        totalIncome: parseFloat(totalMonth.toFixed(2)),
        totalOrders,
        dailyList: records.map(r => ({
          date: r.date,
          baseIncome: r.base_income,
          peakBonus: r.peak_bonus,
          weatherBonus: r.weather_bonus,
          rewardBonus: r.reward_bonus,
          total: r.total,
          orderCount: r.order_count
        }))
      }
    });
  } catch (error) {
    console.error('Get month income error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 扣款明细
// GET /api/rider/income/deductions?page=1&pageSize=20
router.get('/income/deductions', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const [deductions] = await pool.query(
      `SELECT id, order_id, order_no, amount, reason, status, created_at
       FROM income_deductions
       WHERE rider_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) AS total FROM income_deductions WHERE rider_id = ?',
      [req.user.id]
    );

    const [[{ totalAmount }]] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS totalAmount FROM income_deductions WHERE rider_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: deductions.map(d => ({
          id: d.id,
          orderId: d.order_id,
          orderNo: d.order_no,
          amount: d.amount,
          reason: d.reason,
          status: d.status,
          createdAt: d.created_at
        })),
        total,
        totalAmount: parseFloat(totalAmount),
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get deductions error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 奖励活动列表
// GET /api/rider/rewards/activities
router.get('/rewards/activities', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [activities] = await pool.query(
      `SELECT id, title, description, reward_amount, target_count, current_count,
              status, start_at, end_at, created_at
       FROM rider_reward_activities
       WHERE rider_id = ? OR rider_id IS NULL
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: activities.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        rewardAmount: a.reward_amount,
        targetCount: a.target_count,
        currentCount: a.current_count,
        status: a.status,   // active/completed/expired
        startAt: a.start_at,
        endAt: a.end_at
      }))
    });
  } catch (error) {
    console.error('Get reward activities error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 订单异常处理模块
// ============================================================

// 异常订单上报
// POST /api/rider/orders/:id/report
// body: { type, description, photos[] }
router.post('/orders/:id/report', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { type, description, photos } = req.body;

    if (!type || !description) {
      return res.status(400).json({ success: false, message: '缺少异常类型或描述' });
    }

    // 验证订单归属
    const [orders] = await pool.query(
      'SELECT id, order_no FROM rider_orders WHERE id = ? AND rider_id = ?',
      [orderId, req.user.id]
    );
    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }

    const photosJson = photos ? JSON.stringify(photos) : null;
    await pool.query(
      `INSERT INTO order_exceptions (order_id, rider_id, type, description, photos)
       VALUES (?, ?, ?, ?, ?)`,
      [orderId, req.user.id, type, description, photosJson]
    );

    // 标记订单异常状态
    await pool.query(
      'UPDATE rider_orders SET has_exception = 1 WHERE id = ?',
      [orderId]
    );

    res.json({ success: true, message: '异常已上报，请等待平台处理' });
  } catch (error) {
    console.error('Report order exception error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 接单设置模块
// ============================================================

// 获取接单设置
// GET /api/rider/settings
router.get('/settings', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM rider_settings WHERE rider_id = ?',
      [req.user.id]
    );

    // 若无记录则返回默认值
    const settings = rows.length > 0 ? rows[0] : {
      max_distance: 10,
      accept_normal: 1,
      accept_long: 1,
      accept_errand: 0,
      auto_accept: 0,
      voice_broadcast: 1
    };

    res.json({
      success: true,
      data: {
        maxDistance: settings.max_distance,
        acceptNormal: !!settings.accept_normal,
        acceptLong: !!settings.accept_long,
        acceptErrand: !!settings.accept_errand,
        autoAccept: !!settings.auto_accept,
        voiceBroadcast: !!settings.voice_broadcast
      }
    });
  } catch (error) {
    console.error('Get rider settings error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新接单设置
// PUT /api/rider/settings
// body: { maxDistance, acceptNormal, acceptLong, acceptErrand, autoAccept, voiceBroadcast }
router.put('/settings', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { maxDistance, acceptNormal, acceptLong, acceptErrand, autoAccept, voiceBroadcast } = req.body;

    await pool.query(
      `INSERT INTO rider_settings
         (rider_id, max_distance, accept_normal, accept_long, accept_errand, auto_accept, voice_broadcast)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         max_distance   = COALESCE(VALUES(max_distance), max_distance),
         accept_normal  = COALESCE(VALUES(accept_normal), accept_normal),
         accept_long    = COALESCE(VALUES(accept_long), accept_long),
         accept_errand  = COALESCE(VALUES(accept_errand), accept_errand),
         auto_accept    = COALESCE(VALUES(auto_accept), auto_accept),
         voice_broadcast = COALESCE(VALUES(voice_broadcast), voice_broadcast)`,
      [
        req.user.id,
        maxDistance != null ? maxDistance : 10,
        acceptNormal != null ? (acceptNormal ? 1 : 0) : 1,
        acceptLong != null ? (acceptLong ? 1 : 0) : 1,
        acceptErrand != null ? (acceptErrand ? 1 : 0) : 0,
        autoAccept != null ? (autoAccept ? 1 : 0) : 0,
        voiceBroadcast != null ? (voiceBroadcast ? 1 : 0) : 1
      ]
    );

    res.json({ success: true, message: '设置已保存' });
  } catch (error) {
    console.error('Update rider settings error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 工作统计模块
// ============================================================

// 工作时长与统计数据
// GET /api/rider/work/stats?period=today|week|month
router.get('/work/stats', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const period = req.query.period || 'today';
    let startDate;
    const now = new Date();

    if (period === 'today') {
      startDate = now.toISOString().slice(0, 10);
    } else if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      startDate = d.toISOString().slice(0, 10);
    } else if (period === 'month') {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      return res.status(400).json({ success: false, message: '无效的统计周期' });
    }

    // 在线时长（分钟）
    const [workLogs] = await pool.query(
      `SELECT COALESCE(SUM(duration_minutes), 0) AS totalMinutes
       FROM rider_work_logs
       WHERE rider_id = ? AND log_date >= ?`,
      [req.user.id, startDate]
    );

    // 收入汇总
    const [incomeSummary] = await pool.query(
      `SELECT
         COALESCE(SUM(total), 0) AS totalIncome,
         COALESCE(SUM(order_count), 0) AS totalOrders
       FROM income_records
       WHERE rider_id = ? AND date >= ?`,
      [req.user.id, startDate]
    );

    const totalMinutes = parseInt(workLogs[0].totalMinutes || 0);
    const totalIncome = parseFloat(incomeSummary[0].totalIncome || 0);
    const totalOrders = parseInt(incomeSummary[0].totalOrders || 0);

    res.json({
      success: true,
      data: {
        period,
        workHours: parseFloat((totalMinutes / 60).toFixed(1)),
        workMinutes: totalMinutes,
        totalIncome: parseFloat(totalIncome.toFixed(2)),
        totalOrders,
        avgIncomePerOrder: totalOrders > 0
          ? parseFloat((totalIncome / totalOrders).toFixed(2))
          : 0,
        avgIncomePerHour: totalMinutes > 0
          ? parseFloat((totalIncome / (totalMinutes / 60)).toFixed(2))
          : 0
      }
    });
  } catch (error) {
    console.error('Get work stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 上报工作时长（上线/下线打点）
// POST /api/rider/work/log
// body: { action: 'online'|'offline', durationMinutes }
router.post('/work/log', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { action, durationMinutes } = req.body;

    if (!['online', 'offline'].includes(action)) {
      return res.status(400).json({ success: false, message: '无效的操作类型' });
    }

    const today = new Date().toISOString().slice(0, 10);

    if (action === 'offline' && durationMinutes > 0) {
      await pool.query(
        `INSERT INTO rider_work_logs (rider_id, log_date, duration_minutes)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE duration_minutes = duration_minutes + VALUES(duration_minutes)`,
        [req.user.id, today, durationMinutes]
      );
    }

    res.json({ success: true, message: '工作日志已记录' });
  } catch (error) {
    console.error('Log work time error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 实名认证模块
// ============================================================

// 提交实名认证
// POST /api/rider/real-name-auth
// body: { realName, idNumber, idFrontPhoto, idBackPhoto, holdingPhoto }
router.post('/real-name-auth', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { realName, idNumber, idFrontPhoto, idBackPhoto, holdingPhoto } = req.body;

    if (!realName || !idNumber || !idFrontPhoto || !idBackPhoto) {
      return res.status(400).json({ success: false, message: '请提交完整的认证信息' });
    }

    // 验证身份证号格式（简单校验）
    const idReg = /^\d{17}[\dXx]$/;
    if (!idReg.test(idNumber)) {
      return res.status(400).json({ success: false, message: '身份证号格式不正确' });
    }

    // 检查是否已认证
    const [[rider]] = await pool.query(
      'SELECT real_name_status FROM riders WHERE id = ?',
      [req.user.id]
    );
    if (rider && rider.real_name_status === 'approved') {
      return res.status(400).json({ success: false, message: '已完成实名认证，无需重复提交' });
    }

    // 更新认证信息
    await pool.query(
      `UPDATE riders
       SET real_name = ?, id_number = ?, id_front_photo = ?, id_back_photo = ?,
           holding_photo = ?, real_name_status = 'pending', real_name_submitted_at = NOW()
       WHERE id = ?`,
      [realName, idNumber, idFrontPhoto, idBackPhoto, holdingPhoto || null, req.user.id]
    );

    res.json({ success: true, message: '实名认证材料已提交，预计1个工作日内审核完成' });
  } catch (error) {
    console.error('Real name auth error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 查询实名认证状态
// GET /api/rider/real-name-auth
router.get('/real-name-auth', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT real_name, real_name_status, real_name_submitted_at, real_name_reject_reason FROM riders WHERE id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        realName: rider.real_name ? rider.real_name.replace(/(?<=.).(?=.)/g, '*') : null,
        status: rider.real_name_status || 'none',  // none/pending/approved/rejected
        submittedAt: rider.real_name_submitted_at,
        rejectReason: rider.real_name_reject_reason
      }
    });
  } catch (error) {
    console.error('Get real name auth status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 银行卡管理模块
// ============================================================

// 获取绑定银行卡列表
// GET /api/rider/bank-cards
router.get('/bank-cards', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [cards] = await pool.query(
      `SELECT id, bank_name, card_number_last4, card_holder, is_default, created_at
       FROM rider_bank_cards
       WHERE rider_id = ? AND is_deleted = 0
       ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: cards.map(c => ({
        id: c.id,
        bankName: c.bank_name,
        cardNumberLast4: c.card_number_last4,
        cardHolder: c.card_holder,
        isDefault: !!c.is_default,
        createdAt: c.created_at
      }))
    });
  } catch (error) {
    console.error('Get bank cards error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 绑定银行卡
// POST /api/rider/bank-cards
// body: { bankName, cardNumber, cardHolder, isDefault }
router.post('/bank-cards', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { bankName, cardNumber, cardHolder, isDefault } = req.body;

    if (!bankName || !cardNumber || !cardHolder) {
      return res.status(400).json({ success: false, message: '请填写完整的银行卡信息' });
    }

    // 银行卡号基本校验（13-19位数字）
    if (!/^\d{13,19}$/.test(cardNumber)) {
      return res.status(400).json({ success: false, message: '银行卡号格式不正确' });
    }

    const cardLast4 = cardNumber.slice(-4);

    // 检查是否已绑定相同卡号
    const [existing] = await pool.query(
      'SELECT id FROM rider_bank_cards WHERE rider_id = ? AND card_number_last4 = ? AND bank_name = ? AND is_deleted = 0',
      [req.user.id, cardLast4, bankName]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该银行卡已绑定' });
    }

    // 若设为默认，先取消其他默认卡
    if (isDefault) {
      await pool.query(
        'UPDATE rider_bank_cards SET is_default = 0 WHERE rider_id = ?',
        [req.user.id]
      );
    }

    await pool.query(
      `INSERT INTO rider_bank_cards (rider_id, bank_name, card_number_last4, card_holder, is_default)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, bankName, cardLast4, cardHolder, isDefault ? 1 : 0]
    );

    res.json({ success: true, message: '银行卡绑定成功' });
  } catch (error) {
    console.error('Add bank card error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除/解绑银行卡
// DELETE /api/rider/bank-cards/:id
router.delete('/bank-cards/:id', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE rider_bank_cards SET is_deleted = 1 WHERE id = ? AND rider_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '银行卡不存在' });
    }

    res.json({ success: true, message: '银行卡已解绑' });
  } catch (error) {
    console.error('Delete bank card error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 消息通知模块
// ============================================================

// 获取消息列表
// GET /api/rider/messages?page=1&pageSize=20
router.get('/messages', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const offset = (page - 1) * pageSize;

    const [messages] = await pool.query(
      `SELECT id, type, title, content, is_read, created_at
       FROM rider_messages
       WHERE rider_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, pageSize, offset]
    );

    const [[{ unread }]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM rider_messages WHERE rider_id = ? AND is_read = 0',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: messages.map(m => ({
          id: m.id,
          type: m.type,   // system/order/income/notice
          title: m.title,
          content: m.content,
          isRead: !!m.is_read,
          createdAt: m.created_at
        })),
        unreadCount: parseInt(unread)
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 标记消息为已读
// PUT /api/rider/messages/:id/read
router.put('/messages/:id/read', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const msgId = req.params.id;

    if (msgId === 'all') {
      // 全部标为已读
      await pool.query(
        'UPDATE rider_messages SET is_read = 1 WHERE rider_id = ?',
        [req.user.id]
      );
    } else {
      // 标记单条消息为已读
      await pool.query(
        'UPDATE rider_messages SET is_read = 1 WHERE id = ? AND rider_id = ?',
        [msgId, req.user.id]
      );
    }

    res.json({ success: true, message: '已标记为已读' });
  } catch (error) {
    console.error('Mark message read error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 账号安全模块
// ============================================================

// 获取账号状态（冻结/正常/审核中）
// GET /api/rider/account/status
router.get('/account/status', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT status, freeze_reason, freeze_at, real_name_status FROM riders WHERE id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        status: rider.status,
        freezeReason: rider.freeze_reason || null,
        freezeAt: rider.freeze_at || null,
        realNameStatus: rider.real_name_status || 'none'
      }
    });
  } catch (error) {
    console.error('Get account status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 安全报备（骑手位置+安全状态主动上报）
// POST /api/rider/safety/report
// body: { latitude, longitude, note }
router.post('/safety/report', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { latitude, longitude, note } = req.body;

    await pool.query(
      `INSERT INTO rider_safety_reports (rider_id, latitude, longitude, note)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, latitude || null, longitude || null, note || null]
    );

    res.json({ success: true, message: '安全报备已提交' });
  } catch (error) {
    console.error('Safety report error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 可抢订单列表
// GET /api/rider/available-orders
router.get('/available-orders', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    // 只返回未分配骑手（rider_id IS NULL）且状态为待接单的骑手配送订单
    const [orders] = await pool.query(
      `SELECT o.id, o.order_no, o.status, o.total_income, o.created_at,
              o.merchant_name, o.pickup_address, o.delivery_address, o.distance
       FROM rider_orders o
       WHERE o.rider_id IS NULL AND o.status = 'pending'
       ORDER BY o.created_at ASC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM rider_orders WHERE rider_id IS NULL AND status = 'pending'`
    );

    res.json({
      success: true,
      data: {
        list: orders.map(o => ({
          id: o.id,
          orderNo: o.order_no,
          status: o.status,
          totalIncome: o.total_income,
          createdAt: o.created_at,
          merchantName: o.merchant_name,
          pickupAddress: o.pickup_address,
          deliveryAddress: o.delivery_address,
          distance: o.distance
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get available orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手订单列表（已接手的订单）
// GET /api/rider/orders
router.get('/orders', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const status = req.query.status; // all, pending, accepted, delivering, completed, cancelled
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    let whereClause = 'WHERE ro.rider_id = ?';
    const params = [req.user.id];

    if (status && status !== 'all') {
      whereClause += ' AND ro.status = ?';
      params.push(status);
    }

    const [orders] = await pool.query(
      `SELECT ro.id, ro.status, ro.pickup_code, ro.delivery_address, ro.delivery_name, ro.delivery_phone,
              ro.distance, ro.base_fare, ro.peak_bonus, ro.weather_bonus, ro.reward_bonus, ro.total_income,
              ro.pickup_latitude, ro.pickup_longitude, ro.delivery_latitude, ro.delivery_longitude, ro.weather,
              ro.created_at, ro.picked_at, ro.delivered_at
       FROM rider_orders ro
       ${whereClause}
       ORDER BY ro.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM rider_orders ro WHERE ro.rider_id = ? ${status && status !== 'all' ? ' AND ro.status = ?' : ''}`,
      status && status !== 'all' ? [req.user.id, status] : [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: orders.map(o => ({
          id: o.id,
          orderNo: o.pickup_code || `RO-${o.id}`,
          status: o.status,
          totalIncome: o.total_income,
          baseFare: o.base_fare,
          peakBonus: o.peak_bonus,
          weatherBonus: o.weather_bonus,
          rewardBonus: o.reward_bonus,
          distance: o.distance,
          createdAt: o.created_at,
          pickedAt: o.picked_at,
          deliveredAt: o.delivered_at,
          deliveryAddress: o.delivery_address,
          deliveryName: o.delivery_name,
          deliveryPhone: o.delivery_phone
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get rider orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手排行榜
// GET /api/rider/leaderboard
router.get('/leaderboard', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const { type = 'daily', page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql, params;

    if (type === 'daily') {
      const today = new Date().toISOString().slice(0, 10);
      sql = `SELECT id, name, rating, total_orders, today_income, level, status 
             FROM riders 
             WHERE status != 'frozen' 
             ORDER BY today_income DESC 
             LIMIT ? OFFSET ?`;
      params = [limit, (parseInt(page) - 1) * limit];
    } else if (type === 'weekly') {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      sql = `SELECT r.id, r.name, r.rating, r.total_orders, COALESCE(SUM(i.total), 0) AS weekIncome, r.level, r.status 
             FROM riders r 
             LEFT JOIN income_records i ON r.id = i.rider_id AND i.date >= ? 
             WHERE r.status != 'frozen' 
             GROUP BY r.id 
             ORDER BY weekIncome DESC 
             LIMIT ? OFFSET ?`;
      params = [weekAgo, limit, (parseInt(page) - 1) * limit];
    } else {
      sql = `SELECT id, name, rating, total_orders, month_income, level, status 
             FROM riders 
             WHERE status != 'frozen' 
             ORDER BY month_income DESC 
             LIMIT ? OFFSET ?`;
      params = [limit, (parseInt(page) - 1) * limit];
    }

    const [riders] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query(
      type === 'daily' 
        ? 'SELECT COUNT(*) as total FROM riders WHERE status != "frozen"'
        : type === 'weekly'
        ? 'SELECT COUNT(DISTINCT rider_id) as total FROM income_records WHERE date >= ?'
        : 'SELECT COUNT(*) as total FROM riders WHERE status != "frozen"',
      type === 'weekly' ? [new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)] : []
    );

    res.json({
      success: true,
      data: {
        list: riders.map((r, idx) => ({
          rank: (parseInt(page) - 1) * limit + idx + 1,
          id: r.id,
          name: r.name,
          rating: r.rating,
          totalOrders: r.total_orders,
          income: r.today_income || r.weekIncome || r.month_income,
          level: r.level,
          status: r.status
        })),
        total,
        page: parseInt(page),
        pageSize: limit
      }
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手邀请奖励
// GET /api/rider/referral
router.get('/referral', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    // referral_code 列不存在，暂时返回假数据避免报错
    res.json({
      success: true,
      data: {
        code: 'RIDER' + req.user.id,
        referralCount: 0,
        referralIncome: 0
      }
    });
  } catch (error) {
    console.error('Get referral error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手培训
// GET /api/rider/training
router.get('/training', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    // rider_training_materials 和 rider_training_progress 表不存在，返回空数据
    res.json({
      success: true,
      data: {
        materials: [],
        progress: {}
      }
    });
  } catch (error) {
    console.error('Get training error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 前端兼容层 - 补充缺失路由
// ============================================================

// GET /income/summary → 收入概览
router.get('/income/summary', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT today_income, month_income, balance, total_orders FROM riders WHERE id = ?',
      [req.user.id]
    );
    if (!rider) return res.status(404).json({ success: false, message: '骑手不存在' });
    res.json({
      success: true,
      data: {
        todayIncome: parseFloat(rider.today_income || 0),
        monthIncome: parseFloat(rider.month_income || 0),
        balance: parseFloat(rider.balance || 0),
        totalOrders: rider.total_orders || 0
      }
    });
  } catch (error) {
    console.error('Get income summary error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /income/records → 收入明细记录
router.get('/income/records', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const [records] = await pool.query(
      `SELECT id, type, amount, description, created_at FROM rider_income_records
       WHERE rider_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    res.json({
      success: true,
      data: records.map(r => ({
        id: r.id, type: r.type, amount: parseFloat(r.amount || 0),
        description: r.description, createdAt: r.created_at
      })),
      pagination: { page, limit }
    });
  } catch (error) {
    // 表可能不存在
    if (error.message.includes('doesn\'t exist')) {
      return res.json({ success: true, data: [], pagination: { page: parseInt(req.query.page) || 1, limit: 20 } });
    }
    console.error('Get income records error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /credit/score → 信用分
router.get('/credit/score', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const [[rider]] = await pool.query(
      'SELECT credit_score, level, rating FROM riders WHERE id = ?',
      [req.user.id]
    );
    if (!rider) return res.status(404).json({ success: false, message: '骑手不存在' });
    res.json({
      success: true,
      data: {
        score: rider.credit_score || 100,
        level: rider.level || 'newbie',
        rating: parseFloat(rider.rating || 5.0)
      }
    });
  } catch (error) {
    console.error('Get credit score error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /credit/records → 信用记录
router.get('/credit/records', authMiddleware, riderMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const [records] = await pool.query(
      `SELECT id, reason, score, created_at FROM credit_deductions
       WHERE rider_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    res.json({
      success: true,
      data: records.map(r => ({
        id: r.id, reason: r.reason, score: r.score, createdAt: r.created_at
      })),
      pagination: { page, limit }
    });
  } catch (error) {
    if (error.message.includes('doesn\'t exist')) {
      return res.json({ success: true, data: [], pagination: { page: parseInt(req.query.page) || 1, limit: 20 } });
    }
    console.error('Get credit records error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /training/list → 培训列表（同 /training）
router.get('/training/list', authMiddleware, riderMiddleware, async (req, res) => {
  res.json({ success: true, data: { materials: [], progress: {} } });
});

module.exports = router;




// ========== 骑手位置查询（无需认证，用于地图追踪） ==========
router.get("/location/public/:riderId", async (req, res) => {
  try {
    const [riders] = await pool.query(
      "SELECT id, name, last_latitude, last_longitude, last_location_at, status FROM riders WHERE id = ?",
      [req.params.riderId]
    );
    if (riders.length === 0) return res.json({ success: false, message: "骑手不存在" });

    const rider = riders[0];
    const [orders] = await pool.query(
      "SELECT id, order_no, status, pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude, pickup_address, delivery_address FROM rider_orders WHERE rider_id = ? AND status IN (\"accepted\",\"picking\",\"delivering\") ORDER BY id DESC LIMIT 1",
      [req.params.riderId]
    );

    res.json({
      success: true,
      timestamp: Date.now(),
      rider: {
        id: rider.id, name: rider.name,
        latitude: parseFloat(rider.last_latitude) || 0,
        longitude: parseFloat(rider.last_longitude) || 0,
        lastUpdate: rider.last_location_at,
        status: rider.status,
      },
      order: orders.length > 0 ? {
        id: orders[0].id, orderNo: orders[0].order_no,
        status: orders[0].status,
        pickupLat: parseFloat(orders[0].pickup_latitude) || 0,
        pickupLng: parseFloat(orders[0].pickup_longitude) || 0,
        pickupAddress: orders[0].pickup_address || "",
        deliveryLat: parseFloat(orders[0].delivery_latitude) || 0,
        deliveryLng: parseFloat(orders[0].delivery_longitude) || 0,
        deliveryAddress: orders[0].delivery_address || "",
      } : null,
    });
  } catch (e) {
    console.error("Get rider location error:", e);
    res.status(500).json({ success: false, message: "服务器错误" });
  }
});
