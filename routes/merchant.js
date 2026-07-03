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
const { authMiddleware, merchantMiddleware } = require('../middleware/auth');
const { dispatchRider, notifyRider } = require('./rider_pool');
const { sendCsv } = require('../services/export');
const { generateReportPDF } = require('../services/report-pdf');

// ============================================================
// 安全辅助函数
// ============================================================

function safeJSON(str, fallback = null) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function maskBankInfo(bankInfo) {
  if (!bankInfo) return bankInfo;
  try {
    const info = typeof bankInfo === 'string' ? JSON.parse(bankInfo) : bankInfo;
    if (info.cardNumber && info.cardNumber.length > 4) {
      info.cardNumber = '****' + info.cardNumber.slice(-4);
    }
    return info;
  } catch { return bankInfo; }
}

// ============================================================
// 前端兼容层 - 修复前后端API不匹配问题 (必须放在通用路由之前)
// ============================================================

// 1. 菜单分类路径修复 - 前端调用 /menu/categories，后端实际为 /categories
router.post('/menu/categories', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { name, sort_order = 0 } = req.body;
    const merchantId = req.user.id;
    
    if (!name) {
      return res.status(400).json({ success: false, message: '分类名称不能为空' });
    }
    
    const [result] = await pool.query(
      'INSERT INTO menu_categories (merchant_id, name, sort_order) VALUES (?, ?, ?)',
      [merchantId, name, sort_order]
    );
    
    res.json({
      success: true,
      message: '分类创建成功',
      data: { id: result.insertId, name, sort_order }
    });
  } catch (error) {
    console.error('Create menu category error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取菜单分类列表 - 前端调用 GET /menu/categories
router.get('/menu/categories', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [cats] = await pool.query(
      'SELECT * FROM menu_categories WHERE merchant_id = ? ORDER BY sort_order ASC, id ASC',
      [req.user.id]
    );

    res.json({
      success: true,
      data: cats.map(c => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_id,
        sortOrder: c.sort_order,
        isVisible: !!c.is_visible
      }))
    });
  } catch (error) {
    console.error('Get menu categories error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 2. 退款列表查询 - 前端需要 GET /refunds
router.get('/refunds', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const merchantId = req.user.id;
    
    let sql = `
      SELECT r.*, mo.order_no, mo.order_amount, u.name as user_name, u.phone as user_phone
      FROM refunds r
      JOIN merchant_orders mo ON r.order_id = mo.id
      LEFT JOIN users u ON mo.user_id = u.id
      WHERE mo.merchant_id = ?
    `;
    const params = [merchantId];
    
    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
    
    const [refunds] = await pool.query(sql, params);
    
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM refunds r JOIN merchant_orders mo ON r.order_id = mo.id WHERE mo.merchant_id = ?',
      [merchantId]
    );
    
    res.json({
      success: true,
      data: refunds.map(r => ({
        ...r,
        user_phone: maskPhone(r.user_phone)
      })),
      pagination: { page: parseInt(page), limit, total: countResult[0].total }
    });
  } catch (error) {
    console.error('Get refunds error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 3. 单个退款详情 - 前端调用 PUT /refunds/:id，后端实际为 PUT /refunds/:id/review
router.put('/refunds/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;
    const merchantId = req.user.id;
    
    // 验证退款是否属于当前商家
    const [refunds] = await pool.query(
      'SELECT r.* FROM refunds r JOIN merchant_orders mo ON r.order_id = mo.id WHERE r.id = ? AND mo.merchant_id = ?',
      [id, merchantId]
    );
    
    if (refunds.length === 0) {
      return res.status(404).json({ success: false, message: '退款记录不存在' });
    }
    
    if (action === 'approve') {
      const [result] = await pool.query(
        "UPDATE refunds SET status = ?, approved_at = NOW(), approved_by = ? WHERE id = ? AND status = 'pending'",
        ['approved', merchantId, id]
      );
      if (result.affectedRows === 0) {
        return res.status(400).json({ success: false, message: '退款已被处理，无法重复操作' });
      }
      res.json({ success: true, message: '退款已同意' });
    } else if (action === 'reject') {
      const [result] = await pool.query(
        "UPDATE refunds SET status = ?, reject_reason = ?, rejected_at = NOW() WHERE id = ? AND status = 'pending'",
        ['rejected', reason || '', id]
      );
      if (result.affectedRows === 0) {
        return res.status(400).json({ success: false, message: '退款已被处理，无法重复操作' });
      }
      res.json({ success: true, message: '退款已拒绝' });
    } else {
      res.status(400).json({ success: false, message: '无效的操作' });
    }
  } catch (error) {
    console.error('Update refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 4. 资质认证方法修复 - 前端调用 PUT /qualification，后端实际为 POST /qualification
router.put('/qualification', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const merchantId = req.user.id;
    const {
      businessLicense,
      businessLicenseImage,
      foodLicense,
      foodLicenseImage,
      idCardFront,
      idCardBack,
      healthCertificate,
      bankAccount,
      bankName,
      accountName
    } = req.body;
    
    // 更新商家资质信息
    await pool.query(
      `UPDATE merchants SET 
        business_license = ?, business_license_image = ?,
        food_license = ?, food_license_image = ?,
        id_card_front = ?, id_card_back = ?,
        health_certificate = ?, bank_account = ?,
        bank_name = ?, account_name = ?,
        qualification_status = 'pending'
      WHERE id = ?`,
      [
        businessLicense, businessLicenseImage,
        foodLicense, foodLicenseImage,
        idCardFront, idCardBack,
        healthCertificate, bankAccount,
        bankName, accountName,
        merchantId
      ]
    );
    
    res.json({ success: true, message: '资质信息已提交，等待审核' });
  } catch (error) {
    console.error('Update qualification error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 原有路由 ==========

// 获取商家信息
router.get('/profile', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [merchants] = await pool.query('SELECT * FROM merchants WHERE id = ?', [req.user.id]);
    
    if (merchants.length === 0) {
      return res.status(404).json({ success: false, message: '商家不存在' });
    }

    const merchant = merchants[0];
    res.json({
      success: true,
      data: {
        id: merchant.id,
        name: merchant.name,
        phone: merchant.phone,
        address: merchant.address,
        category: merchant.category,
        avatar: merchant.avatar,
        isOpen: merchant.is_open === 1,
        autoAccept: merchant.auto_accept === 1,
        voiceReminder: merchant.voice_reminder === 1,
        rating: merchant.rating,
        totalOrders: merchant.total_orders,
        todayRevenue: merchant.today_revenue,
        monthRevenue: merchant.month_revenue,
        deliveryRange: merchant.delivery_range,
        minOrderAmount: merchant.min_order_amount
      }
    });
  } catch (error) {
    console.error('Get merchant profile error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取商家设置 - 前端调用 GET /settings
router.get('/settings', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT is_open, auto_accept, voice_reminder, delivery_range, min_order_amount,
              name, phone, address, category, description,
              open_time, close_time, delivery_fee, estimated_time,
              latitude, longitude, status
       FROM merchants WHERE id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '商家不存在' });
    }

    const m = rows[0];
    res.json({
      success: true,
      data: {
        isOpen: !!m.is_open,
        autoAccept: !!m.auto_accept,
        voiceReminder: !!m.voice_reminder,
        deliveryRange: m.delivery_range || 3,
        minOrderAmount: parseFloat(m.min_order_amount || 0),
        name: m.name,
        phone: m.phone,
        address: m.address,
        category: m.category,
        description: m.description,
        openTime: m.open_time,
        closeTime: m.close_time,
        deliveryFee: parseFloat(m.delivery_fee || 0),
        estimatedTime: m.estimated_time,
        latitude: m.latitude,
        longitude: m.longitude,
        status: m.status
      }
    });
  } catch (error) {
    console.error('Get merchant settings error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新商家设置
router.put('/settings', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { isOpen, autoAccept, voiceReminder, deliveryRange, minOrderAmount } = req.body;
    
    const updateData = {};
    if (isOpen !== undefined) updateData.is_open = isOpen ? 1 : 0;
    if (autoAccept !== undefined) updateData.auto_accept = autoAccept ? 1 : 0;
    if (voiceReminder !== undefined) updateData.voice_reminder = voiceReminder ? 1 : 0;
    if (deliveryRange !== undefined) updateData.delivery_range = deliveryRange;
    if (minOrderAmount !== undefined) updateData.min_order_amount = minOrderAmount;

    const allowedFields = ['is_open', 'auto_accept', 'voice_reminder', 'delivery_range', 'min_order_amount'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.user.id);
    await pool.query(`UPDATE merchants SET ${fields.join(', ')} WHERE id = ?`, values);
    
    res.json({ success: true, message: '设置更新成功' });
  } catch (error) {
    console.error('Update merchant settings error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单列表
router.get('/orders', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    
    let sql = 'SELECT mo.*, u.name as user_name FROM merchant_orders mo LEFT JOIN users u ON mo.user_id = u.id WHERE mo.merchant_id = ?';
    const params = [req.user.id];
    
    if (status && status !== 'all') {
      sql += ' AND mo.status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY mo.created_at DESC';
    
    const [orders] = await pool.query(sql, params);
    
    res.json({
      success: true,
      data: orders.map(order => ({
        id: order.id,
        orderNo: order.order_no,
        userName: order.user_name,
        status: order.status,
        orderAmount: order.order_amount,
        commission: order.commission,
        deliveryFee: order.delivery_fee,
        discount: order.discount,
        actualAmount: order.actual_amount,
        items: safeJSON(order.items, []),
        deliveryAddress: order.delivery_address,
        deliveryName: order.delivery_name,
        deliveryPhone: order.delivery_phone,
        pickupCode: order.pickup_code,
        riderName: order.rider_name,
        riderPhone: order.rider_phone,
        createdAt: order.created_at,
        acceptedAt: order.accepted_at,
        readyAt: order.ready_at,
        deliveredAt: order.delivered_at
      }))
    });
  } catch (error) {
    console.error('Get merchant orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取待处理订单数
router.get('/orders/pending/count', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [result] = await pool.query(
      'SELECT COUNT(*) as count FROM merchant_orders WHERE merchant_id = ? AND status = "pending"',
      [req.user.id]
    );
    
    res.json({ success: true, data: { count: result[0].count } });
  } catch (error) {
    console.error('Get pending order count error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 接单
router.put('/orders/:id/accept', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    
    // 验证订单归属
    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [orderId, req.user.id]
    );
    
    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }
    
    if (orders[0].status !== 'pending') {
      return res.status(400).json({ success: false, message: '订单状态不允许接单' });
    }

    const pickupCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    await pool.query(
      'UPDATE merchant_orders SET status = "accepted", accepted_at = NOW(), pickup_code = ? WHERE id = ?',
      [pickupCode, orderId]
    );
    
    res.json({ success: true, message: '接单成功', pickupCode });
  } catch (error) {
    console.error('Accept merchant order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 确认出餐（同时触发三池派单）
router.put('/orders/:id/ready', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    
    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [orderId, req.user.id]
    );
    
    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }
    
    if (orders[0].status !== 'accepted') {
      return res.status(400).json({ success: false, message: '订单状态不允许确认出餐' });
    }

    const order = orders[0];

    // 1. 更新商家订单为出餐状态
    await pool.query(
      'UPDATE merchant_orders SET status = "ready", ready_at = NOW() WHERE id = ?',
      [orderId]
    );

    // 2. 获取商家信息（含GPS坐标，供ML派单使用）
    const [merchantInfo] = await pool.query(
      'SELECT name, address, latitude, longitude FROM merchants WHERE id = ?',
      [order.merchant_id]
    );
    const merchantName = merchantInfo.length > 0 ? merchantInfo[0].name : '未知商家';
    const merchantAddress = merchantInfo.length > 0 ? merchantInfo[0].address : '';
    const merchantLat = merchantInfo.length > 0 ? parseFloat(merchantInfo[0].latitude) || null : null;
    const merchantLng = merchantInfo.length > 0 ? parseFloat(merchantInfo[0].longitude) || null : null;

    // 3. 检查是否已有 rider_orders（下单时可能已创建）
    const [existingDispatch] = await pool.query(
      'SELECT id, rider_id, status FROM rider_orders WHERE order_no = ? LIMIT 1',
      [order.order_no]
    );

    if (existingDispatch.length > 0) {
      // 已有骑手分配，更新状态通知骑手取餐
      if (existingDispatch[0].status !== 'cancelled') {
        await pool.query(
          'UPDATE rider_orders SET status = "assigned" WHERE id = ?',
          [existingDispatch[0].id]
        );
        if (existingDispatch[0].rider_id) {
          await notifyRider(existingDispatch[0].rider_id, {
            type: 'order_ready',
            order_id: orderId,
            order_no: order.order_no,
            message: `商家已出餐，请尽快取餐`
          });
        }
      }
    } else {
      // 4. 没有骑手分配 → ML增强三池派单
      // 构建完整订单对象，传递ML模型所需的全部字段
      const now = new Date();
      const currentHour = now.getHours();
      const estimatedDistance = order.delivery_range || 3.0;

      const dispatchResult = await dispatchRider({
        id: order.id,
        order_no: order.order_no,
        merchant_id: order.merchant_id,
        delivery_address: order.delivery_address,
        // 金额字段 → ML收入特征
        total_income: parseFloat(order.actual_amount) || parseFloat(order.order_amount) || 0,
        amount: parseFloat(order.actual_amount) || parseFloat(order.order_amount) || 0,
        base_fare: parseFloat(order.delivery_fee) || 0,
        delivery_fee: parseFloat(order.delivery_fee) || 0,
        // 距离字段
        distance_km: estimatedDistance,
        distance: estimatedDistance,
        // 奖金字段（根据时段和天气动态计算）
        peak_bonus: (currentHour >= 11 && currentHour <= 13) || (currentHour >= 17 && currentHour <= 19) ? 3 : 0,
        weather_bonus: 0,  // 可由天气服务动态注入
        long_distance_bonus: estimatedDistance > 5 ? estimatedDistance * 0.5 : 0,
        reward_bonus: 0,
        // GPS坐标（商家位置作为取餐点）
        pickup_lat: merchantLat,
        pickup_lng: merchantLng,
        merchant_lat: merchantLat,
        merchant_lng: merchantLng,
        // 异常标记
        has_exception: 0,
        type: 'normal',
      });

      if (dispatchResult) {
        const { rider } = dispatchResult;

        // 创建 rider_orders
        await pool.query(
          `INSERT INTO rider_orders 
           (order_no, rider_id, merchant_name, pickup_address, delivery_address,
            delivery_name, delivery_phone, distance, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            order.order_no, rider.id,
            merchantName, merchantAddress,
            order.delivery_address, order.delivery_name,
            order.delivery_phone, estimatedDistance
          ]
        );

        // 更新 merchant_orders 的骑手信息
        await pool.query(
          'UPDATE merchant_orders SET rider_id = ? WHERE id = ?',
          [rider.id, orderId]
        );

        // WS 推送骑手
        await notifyRider(rider.id, {
          type: 'new_order',
          order_id: orderId,
          order_no: order.order_no,
          message: '您有新的配送订单，请尽快接单'
        });

        console.log(`[派单] 订单${order.order_no}已分配给骑手#${rider.id}(${rider.name})`);
        // ML评分日志
        if (dispatchResult.mlScore) {
          console.log(`[ML派单] score=${dispatchResult.mlScore.score} timeout=${(dispatchResult.mlScore.timeoutProb*100).toFixed(1)}% risk=${dispatchResult.mlPrediction?.timeout?.risk_level || 'unknown'} pool=${dispatchResult.poolType}`);
        }
      } else {
        console.log(`[派单] 订单${order.order_no}暂无可用骑手，等待后续分配`);
      }
    }

    // 5. WS 推送商家订单状态变更
    try {
      const { emitOrderStatus } = require('../services/websocket');
      emitOrderStatus(orderId, 'ready', {
        orderNo: order.order_no,
        merchantId: order.merchant_id,
        userId: order.user_id
      });
    } catch (wsErr) {
      console.log('WebSocket 推送订单状态失败:', wsErr.message);
    }
    
    res.json({ success: true, message: '已确认出餐' });
  } catch (error) {
    console.error('Confirm ready error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 拒单（同步取消已分配的骑手）
router.put('/orders/:id/cancel', authMiddleware, merchantMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const orderId = req.params.id;
    
    const [orders] = await conn.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [orderId, req.user.id]
    );
    
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }
    
    if (!['pending', 'accepted'].includes(orders[0].status)) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '订单状态不允许拒单' });
    }

    const order = orders[0];

    // 0. 自动退款：如果订单已支付，退回用户余额
    const [payments] = await conn.query(
      "SELECT * FROM payments WHERE merchant_order_id = ? AND status = 'success'",
      [orderId]
    );
    if (payments.length > 0) {
      const payment = payments[0];
      const refundAmount = parseFloat(payment.amount);
      if (payment.channel === 'balance') {
        await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [refundAmount, payment.user_id]);
      }
      await conn.query("UPDATE payments SET status = 'refunded' WHERE id = ?", [payment.id]);
      console.log(`[Refund] Merchant reject order ${orderId}, refunded ${refundAmount} via ${payment.channel}`);
    }

    // 1. 取消商家订单
    await conn.query(
      'UPDATE merchant_orders SET status = "cancelled" WHERE id = ?',
      [orderId]
    );

    // 2. 取消已分配的骑手配送单
    const [riderOrders] = await conn.query(
      'SELECT id, rider_id FROM rider_orders WHERE order_no = ? AND status != "completed"',
      [order.order_no]
    );
    if (riderOrders.length > 0) {
      await conn.query(
        'UPDATE rider_orders SET status = "cancelled" WHERE order_no = ?',
        [order.order_no]
      );
      // 通知骑手订单已取消
      for (const ro of riderOrders) {
        if (ro.rider_id) {
          try {
            await notifyRider(ro.rider_id, {
              type: 'order_cancelled',
              order_id: orderId,
              order_no: order.order_no,
              message: '商家已拒单，配送任务已取消'
            });
          } catch (notifyErr) {
            console.log('通知骑手取消失败:', notifyErr.message);
          }
        }
      }
    }

    await conn.commit();
    res.json({ success: true, message: payments.length > 0 ? '已拒单，退款已处理' : '已拒单' });
  } catch (error) {
    try { await conn.rollback(); } catch (e) {}
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 催骑手
router.post('/orders/:id/remind', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    
    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [orderId, req.user.id]
    );
    
    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }

    const order = orders[0];
    const riderId = order.rider_id;

    if (riderId) {
      try {
        const { emitToRider, emitOrderStatus } = require('../services/websocket');
        emitToRider(riderId, 'system_message', {
          type: 'reminder',
          orderId: orderId,
          orderNo: order.order_no,
          message: `商家提醒您尽快取餐配送`,
          merchantName: req.user.name || '商家',
        });
        console.log(`催单WS通知: 订单${orderId} → 骑手#${riderId}`);
      } catch (wsErr) {
        console.warn('催单WS通知失败:', wsErr.message);
      }
    } else {
      console.log(`催单: 订单${orderId}尚未分配骑手`);
    }
    
    res.json({ success: true, message: '已通知骑手' });
  } catch (error) {
    console.error('Remind rider error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 延长备餐时间
// POST /api/merchant/orders/:id/extend
router.post('/orders/:id/extend', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { minutes } = req.body;
    const orderId = req.params.id;

    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [orderId, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(403).json({ success: false, message: '无权操作此订单' });
    }

    // TODO: 实际应更新预估完成时间
    console.log(`延长备餐时间: 订单${orderId}延长${minutes || 5}分钟`);

    res.json({ success: true, message: '已通知骑手预计延迟' });
  } catch (error) {
    console.error('Extend prep time error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单派单状态
// GET /api/merchant/orders/:id/dispatch
router.get('/orders/:id/dispatch', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];

    // 查找关联的骑手配送信息
    const [dispatch] = await pool.query(
      'SELECT * FROM rider_orders WHERE order_no = ?',
      [order.order_no]
    );

    res.json({
      success: true,
      data: {
        orderId: order.id,
        orderNo: order.order_no,
        status: order.status,
        riderId: order.rider_id,
        riderName: order.rider_name,
        riderPhone: order.rider_phone,
        riderLocation: dispatch.length > 0 ? {
          lat: dispatch[0].current_lat,
          lng: dispatch[0].current_lng
        } : null,
        dispatchStatus: dispatch.length > 0 ? dispatch[0].status : null,
        estimatedPickup: order.accepted_at,
        estimatedDelivery: order.ready_at
      }
    });
  } catch (error) {
    console.error('Get dispatch status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单详情
router.get('/orders/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT mo.*, 
             u.name as user_name, u.phone as user_phone,
             r.name as rider_name, r.phone as rider_phone
      FROM merchant_orders mo 
      LEFT JOIN users u ON mo.user_id = u.id
      LEFT JOIN riders r ON mo.rider_id = r.id
      WHERE mo.id = ? AND mo.merchant_id = ?
    `, [req.params.id, req.user.id]);
    
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];
    res.json({
      success: true,
      data: {
        id: order.id,
        orderNo: order.order_no,
        userId: order.user_id,
        userName: order.user_name,
        userPhone: maskPhone(order.user_phone),
        riderId: order.rider_id,
        riderName: order.rider_name,
        riderPhone: order.rider_phone,
        status: order.status,
        orderAmount: order.order_amount,
        commission: order.commission,
        deliveryFee: order.delivery_fee,
        discount: order.discount,
        actualAmount: order.actual_amount,
        items: safeJSON(order.items, []),
        deliveryAddress: order.delivery_address,
        deliveryName: order.delivery_name,
        deliveryPhone: order.delivery_phone,
        pickupCode: order.pickup_code,
        createdAt: order.created_at,
        acceptedAt: order.accepted_at,
        readyAt: order.ready_at,
        deliveredAt: order.delivered_at
      }
    });
  } catch (error) {
    console.error('Get merchant order detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取今日统计
router.get('/stats/today', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    const [result] = await pool.query(`
      SELECT 
        COUNT(*) as order_count,
        SUM(order_amount) as total_amount,
        SUM(commission) as total_commission,
        SUM(delivery_fee) as total_delivery_fee,
        SUM(actual_amount) as total_actual
      FROM merchant_orders 
      WHERE merchant_id = ? AND DATE(created_at) = ?
    `, [req.user.id, today]);
    
    res.json({
      success: true,
      data: {
        orderCount: result[0].order_count || 0,
        totalAmount: result[0].total_amount || 0,
        totalCommission: result[0].total_commission || 0,
        totalDeliveryFee: result[0].total_delivery_fee || 0,
        totalActual: result[0].total_actual || 0
      }
    });
  } catch (error) {
    console.error('Get today stats error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取菜单
router.get('/menu', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [menu] = await pool.query(
      'SELECT * FROM merchant_menu WHERE merchant_id = ? ORDER BY category, id',
      [req.user.id]
    );
    
    res.json({
      success: true,
      data: menu.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        image: item.image,
        category: item.category,
        isAvailable: item.is_available === 1,
        salesCount: item.sales_count
      }))
    });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加/更新菜单项
router.post('/menu', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { id, name, description, price, image, category, isAvailable } = req.body;
    
    if (id) {
      // 更新
      await pool.query(
        'UPDATE merchant_menu SET name = ?, description = ?, price = ?, image = ?, category = ?, is_available = ? WHERE id = ? AND merchant_id = ?',
        [name, description, price, image, category, isAvailable ? 1 : 0, id, req.user.id]
      );
      res.json({ success: true, message: '菜单更新成功' });
    } else {
      // 新增
      const [result] = await pool.query(
        'INSERT INTO merchant_menu (merchant_id, name, description, price, image, category, is_available) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, name, description, price, image, category, isAvailable ? 1 : 0]
      );
      res.json({ success: true, message: '菜单添加成功', id: result.insertId });
    }
  } catch (error) {
    console.error('Save menu error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除菜单项
router.delete('/menu/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM merchant_menu WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: '菜单删除成功' });
  } catch (error) {
    console.error('Delete menu error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 1. 入驻与资质
// ============================================================

// 提交入驻申请（资质上传）
// POST /api/merchant/qualification
router.post('/qualification', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const {
      businessLicense, foodLicense, legalIdFront, legalIdBack,
      shopFrontPhoto, kitchenPhoto, legalName, businessAddress
    } = req.body;

    if (!businessLicense || !foodLicense || !legalIdFront) {
      return res.status(400).json({ success: false, message: '请上传营业执照、食品经营许可证和法人身份证' });
    }

    const [existing] = await pool.query(
      'SELECT id, status FROM merchant_qualifications WHERE merchant_id = ?',
      [req.user.id]
    );

    if (existing.length > 0 && existing[0].status === 'approved') {
      return res.status(400).json({ success: false, message: '资质已审核通过，无需重复提交' });
    }

    const data = {
      merchant_id: req.user.id,
      business_license: businessLicense,
      food_license: foodLicense,
      legal_id_front: legalIdFront,
      legal_id_back: legalIdBack || null,
      shop_front_photo: shopFrontPhoto || null,
      kitchen_photo: kitchenPhoto || null,
      legal_name: legalName || null,
      business_address: businessAddress || null,
      status: 'pending'
    };

    if (existing.length > 0) {
      await pool.query(
        `UPDATE merchant_qualifications SET 
           business_license = ?, food_license = ?, legal_id_front = ?, legal_id_back = ?,
           shop_front_photo = ?, kitchen_photo = ?, legal_name = ?, business_address = ?,
           reject_reason = NULL, status = "pending" WHERE merchant_id = ?`,
        [data.business_license, data.food_license, data.legal_id_front, data.legal_id_back,
         data.shop_front_photo, data.kitchen_photo, data.legal_name, data.business_address,
         req.user.id]
      );
    } else {
      await pool.query(
        `INSERT INTO merchant_qualifications 
         (merchant_id, business_license, food_license, legal_id_front, legal_id_back,
          shop_front_photo, kitchen_photo, legal_name, business_address, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "pending")`,
        [req.user.id, data.business_license, data.food_license, data.legal_id_front, data.legal_id_back,
         data.shop_front_photo, data.kitchen_photo, data.legal_name, data.business_address]
      );
    }

    await pool.query('UPDATE merchants SET qualification_status = "pending" WHERE id = ?', [req.user.id]);

    res.json({ success: true, message: '资质材料已提交，预计1-3个工作日审核' });
  } catch (error) {
    console.error('Submit qualification error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 查询资质审核进度
// GET /api/merchant/qualification
router.get('/qualification', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT status, reject_reason, reviewed_at FROM merchant_qualifications WHERE merchant_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: rows.length > 0 ? {
        status: rows[0].status,
        rejectReason: rows[0].reject_reason,
        reviewedAt: rows[0].reviewed_at
      } : { status: 'none' }
    });
  } catch (error) {
    console.error('Get qualification error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 电子合同 & 签约（费率确认）
// POST /api/merchant/contract/sign
router.post('/contract/sign', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { commissionRate, settlementCycle, agreed } = req.body;

    if (!agreed) {
      return res.status(400).json({ success: false, message: '请先同意合同条款' });
    }

    if (commissionRate < 0 || commissionRate > 100) {
      return res.status(400).json({ success: false, message: '费率必须在0-100之间' });
    }

    await pool.query(
      `INSERT INTO merchant_contracts (merchant_id, commission_rate, settlement_cycle, signed_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE commission_rate = VALUES(commission_rate),
         settlement_cycle = VALUES(settlement_cycle), signed_at = NOW()`,
      [req.user.id, commissionRate || 8.00, settlementCycle || 'T1']
    );

    await pool.query(
      'UPDATE merchants SET contract_signed = 1, commission_rate = ? WHERE id = ?',
      [commissionRate || 8.00, req.user.id]
    );

    res.json({ success: true, message: '合同签署成功' });
  } catch (error) {
    console.error('Sign contract error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 2. 店铺基础设置
// ============================================================

// 更新店铺详细信息
// PUT /api/merchant/shop-info
router.put('/shop-info', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const {
      name, avatar, description, address, phone,
      openTime, closeTime, announcement, deliveryFee, estimatedTime,
      deliveryType, bannerImages
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.contact_phone = phone;
    if (openTime !== undefined) updateData.open_time = openTime;
    if (closeTime !== undefined) updateData.close_time = closeTime;
    if (announcement !== undefined) updateData.announcement = announcement;
    if (deliveryFee !== undefined) updateData.delivery_fee = deliveryFee;
    if (estimatedTime !== undefined) updateData.estimated_time = estimatedTime;
    if (deliveryType !== undefined) updateData.delivery_type = deliveryType;
    if (bannerImages !== undefined) updateData.banner_images = JSON.stringify(bannerImages);

    const allowedFields = ['name', 'avatar', 'description', 'address', 'contact_phone', 'open_time', 'close_time', 'announcement', 'delivery_fee', 'estimated_time', 'delivery_type', 'banner_images'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.user.id);
    await pool.query(`UPDATE merchants SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: '店铺信息更新成功' });
  } catch (error) {
    console.error('Update shop info error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 切换营业状态（营业中/暂停/打烊/只接预约）
// PUT /api/merchant/business-status
router.put('/business-status', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { businessStatus } = req.body;
    const validStatuses = ['open', 'paused', 'closed', 'reservation_only'];

    if (!validStatuses.includes(businessStatus)) {
      return res.status(400).json({ success: false, message: '无效的营业状态' });
    }

    await pool.query(
      'UPDATE merchants SET business_status = ?, is_open = ? WHERE id = ?',
      [businessStatus, businessStatus === 'open' ? 1 : 0, req.user.id]
    );

    res.json({ success: true, message: '营业状态已更新' });
  } catch (error) {
    console.error('Update business status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 3. 菜品/商品管理
// ============================================================

// 菜品分类列表
// GET /api/merchant/categories
router.get('/categories', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [cats] = await pool.query(
      'SELECT * FROM menu_categories WHERE merchant_id = ? ORDER BY sort_order ASC, id ASC',
      [req.user.id]
    );

    res.json({
      success: true,
      data: cats.map(c => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_id,
        sortOrder: c.sort_order,
        isVisible: !!c.is_visible
      }))
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 新增/更新菜品分类
// POST /api/merchant/categories
router.post('/categories', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { id, name, parentId, sortOrder } = req.body;

    if (!name) return res.status(400).json({ success: false, message: '分类名称不能为空' });

    if (id) {
      await pool.query(
        'UPDATE menu_categories SET name = ?, parent_id = ?, sort_order = ? WHERE id = ? AND merchant_id = ?',
        [name, parentId || null, sortOrder || 0, id, req.user.id]
      );
      res.json({ success: true, message: '分类更新成功' });
    } else {
      const [result] = await pool.query(
        'INSERT INTO menu_categories (merchant_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)',
        [req.user.id, name, parentId || null, sortOrder || 0]
      );
      res.json({ success: true, message: '分类添加成功', id: result.insertId });
    }
  } catch (error) {
    console.error('Save category error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除分类
// DELETE /api/merchant/categories/:id
router.delete('/categories/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM menu_categories WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: '分类删除成功' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新菜品详细信息（含规格/配料/辣度/过敏原）
// PUT /api/merchant/menu/:id/detail
router.put('/menu/:id/detail', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const {
      name, description, price, originalPrice, stock,
      categoryId, image, spicyLevel, allergens,
      specs, ingredients, isAvailable, sortOrder
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (originalPrice !== undefined) updateData.original_price = originalPrice;
    if (stock !== undefined) updateData.stock = stock;
    if (categoryId !== undefined) updateData.category_id = categoryId;
    if (image !== undefined) updateData.image = image;
    if (spicyLevel !== undefined) updateData.spicy_level = spicyLevel;
    if (allergens !== undefined) updateData.allergens = JSON.stringify(allergens);
    if (specs !== undefined) updateData.specs = JSON.stringify(specs);
    if (ingredients !== undefined) updateData.ingredients = JSON.stringify(ingredients);
    if (isAvailable !== undefined) updateData.is_available = isAvailable ? 1 : 0;
    if (sortOrder !== undefined) updateData.sort_order = sortOrder;

    const allowedFields = ['name', 'description', 'price', 'original_price', 'stock', 'category_id', 'image', 'spicy_level', 'allergens', 'specs', 'ingredients', 'is_available', 'sort_order'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.params.id, req.user.id);
    await pool.query(
      `UPDATE merchant_menu SET ${fields.join(', ')} WHERE id = ? AND merchant_id = ?`,
      values
    );

    res.json({ success: true, message: '菜品更新成功' });
  } catch (error) {
    console.error('Update menu detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 批量上下架
// PUT /api/merchant/menu/batch-status
router.put('/menu/batch-status', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { ids, isAvailable } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要操作的菜品' });
    }

    const [ownedItems] = await pool.query(
      'SELECT id FROM merchant_menu WHERE id IN (?) AND merchant_id = ?',
      [ids, req.user.id]
    );
    if (ownedItems.length !== ids.length) {
      return res.status(403).json({ success: false, message: '存在无权操作的菜品' });
    }

    await pool.query(
      `UPDATE merchant_menu SET is_available = ? WHERE id IN (?) AND merchant_id = ?`,
      [isAvailable ? 1 : 0, ids, req.user.id]
    );

    res.json({ success: true, message: `已批量${isAvailable ? '上架' : '下架'} ${ids.length} 件菜品` });
  } catch (error) {
    console.error('Batch status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 批量改价
// PUT /api/merchant/menu/batch-price
router.put('/menu/batch-price', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { ids, price } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || price == null) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    const [ownedItems] = await pool.query(
      'SELECT id FROM merchant_menu WHERE id IN (?) AND merchant_id = ?',
      [ids, req.user.id]
    );
    if (ownedItems.length !== ids.length) {
      return res.status(403).json({ success: false, message: '存在无权操作的菜品' });
    }

    await pool.query(
      'UPDATE merchant_menu SET price = ? WHERE id IN (?) AND merchant_id = ?',
      [price, ids, req.user.id]
    );

    res.json({ success: true, message: `已批量修改 ${ids.length} 件菜品价格` });
  } catch (error) {
    console.error('Batch price error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 估清（临时售罄）
// PUT /api/merchant/menu/:id/soldout
router.put('/menu/:id/soldout', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { soldOut, remark, restoreAt } = req.body;

    await pool.query(
      'UPDATE merchant_menu SET is_sold_out = ?, soldout_remark = ?, soldout_restore_at = ?, is_available = ? WHERE id = ? AND merchant_id = ?',
      [soldOut ? 1 : 0, remark || null, restoreAt || null, soldOut ? 0 : 1, req.params.id, req.user.id]
    );

    res.json({ success: true, message: soldOut ? '已标记售罄' : '已恢复销售' });
  } catch (error) {
    console.error('Soldout error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 批量排序
// PUT /api/merchant/menu/sort
router.put('/menu/sort', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { items } = req.body; // items = [{id, sortOrder}, ...]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, message: '单次排序不超过100个菜品' });
    }
    const cases = items.map(item => `WHEN id = ${parseInt(item.id)} THEN ${parseInt(item.sortOrder || 0)}`).join(' ');
    const ids = items.map(item => parseInt(item.id)).join(',');
    await pool.query(
      `UPDATE merchant_menu SET sort_order = CASE ${cases} END WHERE id IN (${ids}) AND merchant_id = ?`,
      [req.user.id]
    );

    res.json({ success: true, message: '排序已更新' });
  } catch (error) {
    console.error('Batch sort error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 套餐管理：获取
// GET /api/merchant/combos
router.get('/combos', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [combos] = await pool.query(
      'SELECT * FROM merchant_combos WHERE merchant_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({
      success: true,
      data: combos.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        price: c.price,
        originalPrice: c.original_price,
        image: c.image,
        items: safeJSON(c.items, []),
        isAvailable: !!c.is_available
      }))
    });
  } catch (error) {
    console.error('Get combos error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 套餐管理：创建/更新
// POST /api/merchant/combos
router.post('/combos', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { id, name, description, price, originalPrice, image, items, isAvailable } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, message: '套餐名称和价格不能为空' });
    }

    const itemsJson = items ? JSON.stringify(items) : null;

    if (id) {
      await pool.query(
        'UPDATE merchant_combos SET name=?, description=?, price=?, original_price=?, image=?, items=?, is_available=? WHERE id=? AND merchant_id=?',
        [name, description, price, originalPrice, image, itemsJson, isAvailable ? 1 : 0, id, req.user.id]
      );
      res.json({ success: true, message: '套餐更新成功' });
    } else {
      const [result] = await pool.query(
        'INSERT INTO merchant_combos (merchant_id, name, description, price, original_price, image, items, is_available) VALUES (?,?,?,?,?,?,?,?)',
        [req.user.id, name, description, price, originalPrice, image, itemsJson, isAvailable ? 1 : 0]
      );
      res.json({ success: true, message: '套餐创建成功', id: result.insertId });
    }
  } catch (error) {
    console.error('Save combo error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 4. 订单管理（扩展）
// ============================================================

// 订单改地址
// PUT /api/merchant/orders/:id/address
router.put('/orders/:id/address', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { deliveryAddress, deliveryName, deliveryPhone } = req.body;

    const [orders] = await pool.query(
      'SELECT id, status, delivery_address, delivery_name, delivery_phone FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );

    if (orders.length === 0) return res.status(403).json({ success: false, message: '无权操作此订单' });
    if (!['pending', 'accepted'].includes(orders[0].status)) {
      return res.status(400).json({ success: false, message: '当前状态不允许改地址' });
    }

    const updateData = {};
    if (deliveryAddress) updateData.delivery_address = deliveryAddress;
    if (deliveryName) updateData.delivery_name = deliveryName;
    if (deliveryPhone) updateData.delivery_phone = deliveryPhone;

    const allowedFields = ['delivery_address', 'delivery_name', 'delivery_phone'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.params.id);
    await pool.query(`UPDATE merchant_orders SET ${fields.join(', ')} WHERE id = ?`, values);

    const oldAddress = JSON.stringify({
      delivery_address: orders[0].delivery_address,
      delivery_name: orders[0].delivery_name,
      delivery_phone: orders[0].delivery_phone
    });
    const newAddress = JSON.stringify({
      delivery_address: updateData.delivery_address || orders[0].delivery_address,
      delivery_name: updateData.delivery_name || orders[0].delivery_name,
      delivery_phone: updateData.delivery_phone || orders[0].delivery_phone
    });
    await pool.query(
      'INSERT INTO merchant_order_address_changes (order_id, old_address, new_address, changed_by, changed_at) VALUES (?, ?, ?, ?, NOW())',
      [req.params.id, oldAddress, newAddress, req.user.id]
    );

    res.json({ success: true, message: '地址已修改' });
  } catch (error) {
    console.error('Update order address error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 申请退款
// POST /api/merchant/orders/:id/refund
router.post('/orders/:id/refund', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { reason, amount, type } = req.body; // type: full|partial

    const [orders] = await pool.query(
      'SELECT id, actual_amount, status FROM merchant_orders WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );

    if (orders.length === 0) return res.status(403).json({ success: false, message: '无权操作此订单' });

    const refundAmount = type === 'partial' ? amount : orders[0].actual_amount;

    await pool.query(
      `INSERT INTO merchant_refunds (order_id, merchant_id, refund_amount, reason, type)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE refund_amount=VALUES(refund_amount), reason=VALUES(reason), status='pending'`,
      [req.params.id, req.user.id, refundAmount, reason, type || 'full']
    );

    await pool.query('UPDATE merchant_orders SET has_refund = 1 WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: '退款申请已提交' });
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 审核用户退款申请
// PUT /api/merchant/refunds/:id/review
router.put('/refunds/:id/review', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { approve, rejectReason } = req.body;

    const [refunds] = await pool.query(
      'SELECT * FROM merchant_refunds WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );

    if (refunds.length === 0) return res.status(404).json({ success: false, message: '退款申请不存在' });

    const [result] = await pool.query(
      "UPDATE merchant_refunds SET status = ?, reject_reason = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
      [approve ? 'approved' : 'rejected', rejectReason || null, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: '退款已被处理，无法重复操作' });
    }

    res.json({ success: true, message: approve ? '退款已批准' : '退款已拒绝' });
  } catch (error) {
    console.error('Review refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 历史订单（带时间/状态筛选+分页）
// GET /api/merchant/orders/history?status=completed&startDate=2025-01-01&endDate=2025-01-31&page=1&pageSize=20
router.get('/orders/history', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { status, startDate, endDate, page = 1 } = req.query;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `SELECT mo.*, u.name as user_name
               FROM merchant_orders mo
               LEFT JOIN users u ON mo.user_id = u.id
               WHERE mo.merchant_id = ?`;
    const params = [req.user.id];

    if (status && status !== 'all') { sql += ' AND mo.status = ?'; params.push(status); }
    if (startDate) { sql += ' AND DATE(mo.created_at) >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND DATE(mo.created_at) <= ?'; params.push(endDate); }

    const countSql = sql.replace('SELECT mo.*, u.name as user_name', 'SELECT COUNT(*) as total');
    const [[{ total }]] = await pool.query(countSql, params);

    sql += ' ORDER BY mo.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);

    const [orders] = await pool.query(sql, params);

    res.json({
      success: true,
      data: {
        list: orders.map(o => ({
          id: o.id, orderNo: o.order_no, userName: o.user_name,
          status: o.status, actualAmount: o.actual_amount,
          items: safeJSON(o.items, []),
          createdAt: o.created_at, deliveredAt: o.delivered_at
        })),
        total, page: parseInt(page), pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('Get order history error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 5. 营销活动
// ============================================================

// 获取优惠活动列表
// GET /api/merchant/promotions
router.get('/promotions', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM merchant_promotions WHERE merchant_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        config: safeJSON(r.config, {}),
        status: r.status,
        startAt: r.start_at,
        endAt: r.end_at,
        createdAt: r.created_at
      }))
    });
  } catch (error) {
    console.error('Get promotions error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建/更新优惠活动（满减/折扣/时段优惠等）
// POST /api/merchant/promotions
router.post('/promotions', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { id, type, title, config, startAt, endAt } = req.body;

    if (!type || !title) {
      return res.status(400).json({ success: false, message: '缺少活动类型或标题' });
    }

    const validTypes = ['full_reduction', 'discount', 'time_limit', 'second_half', 'group_buy'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: '无效的活动类型' });
    }

    const configJson = config ? JSON.stringify(config) : null;

    if (id) {
      await pool.query(
        'UPDATE merchant_promotions SET title=?, config=?, start_at=?, end_at=? WHERE id=? AND merchant_id=?',
        [title, configJson, startAt, endAt, id, req.user.id]
      );
      res.json({ success: true, message: '活动更新成功' });
    } else {
      const [result] = await pool.query(
        'INSERT INTO merchant_promotions (merchant_id, type, title, config, start_at, end_at) VALUES (?,?,?,?,?,?)',
        [req.user.id, type, title, configJson, startAt, endAt]
      );
      res.json({ success: true, message: '活动创建成功', id: result.insertId });
    }
  } catch (error) {
    console.error('Save promotion error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除优惠活动
// DELETE /api/merchant/promotions/:id
router.delete('/promotions/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM merchant_promotions WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: '活动已删除' });
  } catch (error) {
    console.error('Delete promotion error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 优惠券管理
// GET /api/merchant/coupons
router.get('/coupons', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [coupons] = await pool.query(
      'SELECT * FROM merchant_coupons WHERE merchant_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    res.json({
      success: true,
      data: coupons.map(c => ({
        id: c.id,
        type: c.type,
        name: c.name,
        faceValue: c.face_value,
        minOrderAmount: c.min_order_amount,
        totalCount: c.total_count,
        usedCount: c.used_count,
        claimedCount: c.claimed_count,
        status: c.status,
        startAt: c.start_at,
        endAt: c.end_at
      }))
    });
  } catch (error) {
    console.error('Get coupons error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建优惠券
// POST /api/merchant/coupons
router.post('/coupons', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { type, name, faceValue, minOrderAmount, totalCount, startAt, endAt } = req.body;

    if (!type || !name || !faceValue) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const [result] = await pool.query(
      `INSERT INTO merchant_coupons
         (merchant_id, type, name, face_value, min_order_amount, total_quantity, remaining_quantity, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, type, name, faceValue, minOrderAmount || 0, totalCount || 100, totalCount || 100, startAt, endAt, 'active']
    );

    res.json({ success: true, message: '优惠券创建成功', id: result.insertId });
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 6. 数据看板与经营分析
// ============================================================

// 实时数据看板
// GET /api/merchant/dashboard
router.get('/dashboard', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[todayStats]] = await pool.query(
      `SELECT
         COUNT(*) AS orderCount,
         COALESCE(SUM(actual_amount), 0) AS revenue,
         COALESCE(AVG(actual_amount), 0) AS avgOrderValue,
         COALESCE(SUM(TIMESTAMPDIFF(MINUTE, accepted_at, ready_at)), 0) AS totalCookMinutes,
         COUNT(CASE WHEN status='completed' THEN 1 END) AS completedCount
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = ?`,
      [req.user.id, today]
    );

    // 热销菜品 Top5
    const [hotItems] = await pool.query(
      `SELECT COALESCE(moi.menu_name, moi.item_name) AS item_name, SUM(COALESCE(moi.quantity, moi.item_qty)) AS totalQty
       FROM merchant_order_items moi
       WHERE moi.merchant_id = ? AND DATE(moi.created_at) = ?
       GROUP BY COALESCE(moi.menu_name, moi.item_name)
       ORDER BY totalQty DESC LIMIT 5`,
      [req.user.id, today]
    );

    // 待处理订单数
    const [[{ pendingCount }]] = await pool.query(
      'SELECT COUNT(*) AS pendingCount FROM merchant_orders WHERE merchant_id = ? AND status = "pending"',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        orderCount: parseInt(todayStats.orderCount),
        revenue: parseFloat(parseFloat(todayStats.revenue).toFixed(2)),
        avgOrderValue: parseFloat(parseFloat(todayStats.avgOrderValue).toFixed(2)),
        avgCookMinutes: todayStats.completedCount > 0
          ? parseFloat((todayStats.totalCookMinutes / todayStats.completedCount).toFixed(1)) : 0,
        pendingCount: parseInt(pendingCount),
        hotItems: hotItems.map(h => ({ name: h.item_name, qty: parseInt(h.totalQty) }))
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 经营报表（日/周/月）
// GET /api/merchant/reports?period=week&startDate=&endDate=
router.get('/reports', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;

    let start, end;
    const now = new Date();

    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      start = d.toISOString().slice(0, 10);
      end = now.toISOString().slice(0, 10);
    } else if (period === 'month') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      end = now.toISOString().slice(0, 10);
    } else {
      start = end = now.toISOString().slice(0, 10);
    }

    const [daily] = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*) AS orderCount,
         COALESCE(SUM(actual_amount), 0) AS revenue,
         COALESCE(SUM(commission), 0) AS commission
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ?
         AND status NOT IN ("cancelled")
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [req.user.id, start, end]
    );

    const totalRevenue = daily.reduce((s, d) => s + parseFloat(d.revenue), 0);
    const totalOrders = daily.reduce((s, d) => s + parseInt(d.orderCount), 0);

    res.json({
      success: true,
      data: {
        startDate: start, endDate: end,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalOrders,
        daily: daily.map(d => ({
          date: d.date,
          orderCount: parseInt(d.orderCount),
          revenue: parseFloat(d.revenue),
          commission: parseFloat(d.commission)
        }))
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 菜品销量/毛利分析
// GET /api/merchant/menu/analysis?startDate=&endDate=
router.get('/menu/analysis', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const start = startDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = endDate || now.toISOString().slice(0, 10);

    const [items] = await pool.query(
      `SELECT item_name, item_id,
         SUM(item_qty) AS totalQty,
         SUM(item_qty * item_price) AS totalRevenue
       FROM merchant_order_items
       WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY item_name, item_id
       ORDER BY totalQty DESC`,
      [req.user.id, start, end]
    );

    res.json({
      success: true,
      data: {
        startDate: start, endDate: end,
        items: items.map(i => ({
          itemId: i.item_id,
          name: i.item_name,
          totalQty: parseInt(i.totalQty),
          totalRevenue: parseFloat(i.totalRevenue)
        }))
      }
    });
  } catch (error) {
    console.error('Menu analysis error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 7. 评价与售后
// ============================================================

// 获取评价列表
// GET /api/merchant/reviews?rating=&page=1&pageSize=20
router.get('/reviews', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { rating, page = 1 } = req.query;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `SELECT r.*, u.name AS user_name
               FROM merchant_reviews r
               LEFT JOIN users u ON r.user_id = u.id
               WHERE r.merchant_id = ?`;
    const params = [req.user.id];

    if (rating) { sql += ' AND r.rating = ?'; params.push(parseInt(rating)); }

    const countSql = sql.replace('SELECT r.*, u.name AS user_name', 'SELECT COUNT(*) AS total');
    const [[{ total }]] = await pool.query(countSql, params);

    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);

    const [reviews] = await pool.query(sql, params);

    res.json({
      success: true,
      data: {
        list: reviews.map(r => ({
          id: r.id,
          orderId: r.order_id,
          userName: r.user_name,
          rating: r.rating,
          comment: r.comment,
          images: safeJSON(r.images, []),
          tasteRating: r.taste_rating,
          packagingRating: r.packaging_rating,
          deliveryRating: r.delivery_rating,
          reply: r.reply,
          replyAt: r.reply_at,
          createdAt: r.created_at
        })),
        total, page: parseInt(page), pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 回复评价
// POST /api/merchant/reviews/:id/reply
router.post('/reviews/:id/reply', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { reply } = req.body;

    if (!reply) return res.status(400).json({ success: false, message: '回复内容不能为空' });

    // 检查是否已回复过该评价
    const [existingReply] = await pool.query(
      'SELECT id FROM merchant_review_replies WHERE review_id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );
    if (existingReply.length > 0) {
      return res.status(400).json({ success: false, message: '已回复过该评价' });
    }

    // 先尝试 merchant_reviews 表
    let [result] = await pool.query(
      'UPDATE merchant_reviews SET reply = ?, reply_at = NOW() WHERE id = ? AND merchant_id = ?',
      [reply, req.params.id, req.user.id]
    );

    // 如果 merchant_reviews 没有匹配，尝试 reviews 表
    if (result.affectedRows === 0) {
      [result] = await pool.query(
        'UPDATE reviews SET merchant_reply = ?, merchant_replied_at = NOW() WHERE id = ? AND merchant_id = ?',
        [reply, req.params.id, req.user.id]
      );
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '评价不存在' });
    }

    res.json({ success: true, message: '回复成功' });
  } catch (error) {
    console.error('Reply review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 申诉恶意差评
// POST /api/merchant/reviews/:id/appeal
router.post('/reviews/:id/appeal', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { reason, evidence } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: '请填写申诉理由' });

    await pool.query(
      `INSERT INTO merchant_review_appeals (review_id, merchant_id, reason, evidence)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason=VALUES(reason), evidence=VALUES(evidence), status='pending'`,
      [req.params.id, req.user.id, reason, evidence ? JSON.stringify(evidence) : null]
    );

    res.json({ success: true, message: '申诉已提交' });
  } catch (error) {
    console.error('Appeal review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 8. 财务与结算
// ============================================================

// 账单明细
// GET /api/merchant/finance/bills?startDate=&endDate=&page=1
router.get('/finance/bills', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, page = 1 } = req.query;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `SELECT id, order_no, actual_amount, commission, delivery_fee, discount,
                      status, created_at, delivered_at
               FROM merchant_orders
               WHERE merchant_id = ? AND status = 'completed'`;
    const params = [req.user.id];

    if (startDate) { sql += ' AND DATE(created_at) >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND DATE(created_at) <= ?'; params.push(endDate); }

    const countSql = sql.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) AS total FROM');
    const [countResult] = await pool.query(countSql, params);
    const total = countResult && countResult[0] ? countResult[0].total : 0;

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);

    const [bills] = await pool.query(sql, params);

    res.json({
      success: true,
      data: {
        list: bills.map(b => ({
          orderId: b.id,
          orderNo: b.order_no,
          revenue: parseFloat(b.actual_amount),
          commission: parseFloat(b.commission),
          deliveryFee: parseFloat(b.delivery_fee),
          discount: parseFloat(b.discount),
          netIncome: parseFloat((b.actual_amount - b.commission).toFixed(2)),
          date: b.created_at
        })),
        total, page: parseInt(page), pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('Get finance bills error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 结算记录
// GET /api/merchant/finance/settlements
router.get('/finance/settlements', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, period_start AS periodStart, period_end AS periodEnd,
              order_count AS orderCount, gross_amount AS grossAmount,
              commission AS commissionDeducted,
              net_amount AS netAmount, status, settled_at AS settledAt, created_at
       FROM merchant_settlements
       WHERE merchant_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        orderCount: r.orderCount || 0,
        grossAmount: parseFloat(r.grossAmount || 0),
        commission: parseFloat(r.commissionDeducted || 0),
        netAmount: parseFloat(r.netAmount || 0),
        status: r.status,
        settledAt: r.settledAt,
        bankInfo: null
      }))
    });
  } catch (error) {
    console.error('Get settlements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 9. 员工与权限
// ============================================================

// 获取员工列表
// GET /api/merchant/staff
router.get('/staff', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const [staff] = await pool.query(
      `SELECT id, name, phone, role, status, created_at
       FROM merchant_staff
       WHERE merchant_id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: staff.map(s => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        role: s.role,
        permissions: [],
        status: s.status,
        createdAt: s.created_at
      }))
    });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 创建员工账号
// POST /api/merchant/staff
router.post('/staff', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const bcrypt = require('bcrypt');
    const { name, phone, role, permissions, password } = req.body;

    if (!name || !phone || !role || !password) {
      return res.status(400).json({ success: false, message: '请填写完整的员工信息' });
    }

    const validRoles = ['manager', 'order_taker', 'finance', 'operator'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM merchant_staff WHERE phone = ? AND merchant_id = ? AND is_deleted = 0',
      [phone, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该手机号已添加为员工' });
    }

    const hash = await bcrypt.hash(password, 10);
    const permissionsJson = permissions ? JSON.stringify(permissions) : null;

    const [result] = await pool.query(
      'INSERT INTO merchant_staff (merchant_id, name, phone, password, role, permissions) VALUES (?,?,?,?,?,?)',
      [req.user.id, name, phone, hash, role, permissionsJson]
    );

    res.json({ success: true, message: '员工账号创建成功', id: result.insertId });
  } catch (error) {
    console.error('Create staff error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 邀请员工（前端兼容别名）
// POST /api/merchant/staff/invite
router.post('/staff/invite', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const bcrypt = require('bcrypt');
    const { name, phone, role, permissions, password } = req.body;

    if (!name || !phone || !role) {
      return res.status(400).json({ success: false, message: '请填写完整的员工信息' });
    }

    const validRoles = ['manager', 'order_taker', 'finance', 'operator'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM merchant_staff WHERE phone = ? AND merchant_id = ? AND is_deleted = 0',
      [phone, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '该手机号已添加为员工' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: '密码不能为空且长度不少于6位' });
    }
    const hash = await bcrypt.hash(password, 10);
    const permissionsJson = permissions ? JSON.stringify(permissions) : null;

    const [result] = await pool.query(
      'INSERT INTO merchant_staff (merchant_id, name, phone, password, role, permissions) VALUES (?,?,?,?,?,?)',
      [req.user.id, name, phone, hash, role, permissionsJson]
    );

    res.json({ success: true, message: '员工邀请成功', id: result.insertId });
  } catch (error) {
    console.error('Invite staff error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新员工权限/角色
// PUT /api/merchant/staff/:id
router.put('/staff/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { role, permissions, status } = req.body;

    const updateData = {};
    if (role) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = JSON.stringify(permissions);
    if (status !== undefined) updateData.status = status;

    const allowedFields = ['role', 'permissions', 'status'];
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.params.id, req.user.id);
    await pool.query(
      `UPDATE merchant_staff SET ${fields.join(', ')} WHERE id = ? AND merchant_id = ?`,
      values
    );

    res.json({ success: true, message: '员工信息更新成功' });
  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除员工
// DELETE /api/merchant/staff/:id
router.delete('/staff/:id', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE merchant_staff SET is_deleted = 1 WHERE id = ? AND merchant_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: '员工已移除' });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 操作日志
// GET /api/merchant/logs?page=1
router.get('/logs', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 30, 100);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const [logs] = await pool.query(
      `SELECT l.id, l.action, l.detail, l.ip, l.created_at,
              COALESCE(s.name, '店主') AS operator_name
       FROM merchant_operation_logs l
       LEFT JOIN merchant_staff s ON l.operator_id = s.id
       WHERE l.merchant_id = ?
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, parseInt(pageSize), offset]
    );

    res.json({
      success: true,
      data: logs.map(l => ({
        id: l.id,
        action: l.action,
        detail: l.detail,
        ip: l.ip,
        operatorName: l.operator_name,
        createdAt: l.created_at
      }))
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 10. 经营趋势（前端兼容别名）
// ============================================================

// 经营趋势数据
// GET /api/merchant/stats/trend?period=week&startDate=&endDate=
router.get('/stats/trend', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const now = new Date();

    let start, end;
    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      start = d.toISOString().slice(0, 10);
      end = now.toISOString().slice(0, 10);
    } else if (period === 'month') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      end = now.toISOString().slice(0, 10);
    } else {
      start = end = now.toISOString().slice(0, 10);
    }

    const [daily] = await pool.query(
      `SELECT
         DATE(created_at) AS date,
         COUNT(*) AS orderCount,
         COALESCE(SUM(actual_amount), 0) AS revenue,
         COALESCE(SUM(commission), 0) AS commission
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ?
         AND status NOT IN ("cancelled")
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [req.user.id, start, end]
    );

    // 获取今日实时统计
    const today = now.toISOString().slice(0, 10);
    const [todayStats] = await pool.query(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = ? AND status NOT IN ("cancelled")`,
      [req.user.id, today]
    );

    // 获取昨日统计用于对比
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const [yesterdayStats] = await pool.query(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = ? AND status NOT IN ("cancelled")`,
      [req.user.id, yesterdayStr]
    );

    const totalRevenue = daily.reduce((s, d) => s + parseFloat(d.revenue), 0);
    const totalOrders = daily.reduce((s, d) => s + parseInt(d.orderCount), 0);

    res.json({
      success: true,
      data: {
        startDate: start, endDate: end,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalOrders,
        today: {
          orderCount: parseInt(todayStats[0]?.orderCount || 0),
          revenue: parseFloat(todayStats[0]?.revenue || 0)
        },
        yesterday: {
          orderCount: parseInt(yesterdayStats[0]?.orderCount || 0),
          revenue: parseFloat(yesterdayStats[0]?.revenue || 0)
        },
        trend: daily.map(d => ({
          date: d.date,
          orderCount: parseInt(d.orderCount),
          revenue: parseFloat(d.revenue),
          commission: parseFloat(d.commission)
        }))
      }
    });
  } catch (error) {
    console.error('Get stats trend error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 11. 财务概览与提现（前端兼容）
// ============================================================

// 财务概览
// GET /api/merchant/finance/overview
router.get('/finance/overview', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // 今日收入
    const [todayData] = await pool.query(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue,
              COALESCE(SUM(commission), 0) AS commission
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = ? AND status = 'completed'`,
      [req.user.id, today]
    );

    // 本月收入
    const [monthData] = await pool.query(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue,
              COALESCE(SUM(commission), 0) AS commission
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) >= ? AND status = 'completed'`,
      [req.user.id, monthStart]
    );

    // 累计收入
    const [totalData] = await pool.query(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue,
              COALESCE(SUM(commission), 0) AS commission
       FROM merchant_orders
       WHERE merchant_id = ? AND status = 'completed'`,
      [req.user.id]
    );

    // 可提现余额（累计收入 - 已结算金额）
    const [settlementData] = await pool.query(
      `SELECT COALESCE(SUM(net_amount), 0) AS settledAmount
       FROM merchant_settlements
       WHERE merchant_id = ? AND status IN ('settled', 'completed')`,
      [req.user.id]
    );

    const totalRevenue = parseFloat(totalData[0]?.revenue || 0);
    const settledAmount = parseFloat(settlementData[0]?.settledAmount || 0);

    res.json({
      success: true,
      data: {
        today: {
          orderCount: parseInt(todayData[0]?.orderCount || 0),
          revenue: parseFloat(todayData[0]?.revenue || 0),
          commission: parseFloat(todayData[0]?.commission || 0)
        },
        thisMonth: {
          orderCount: parseInt(monthData[0]?.orderCount || 0),
          revenue: parseFloat(monthData[0]?.revenue || 0),
          commission: parseFloat(monthData[0]?.commission || 0)
        },
        total: {
          orderCount: parseInt(totalData[0]?.orderCount || 0),
          revenue: totalRevenue,
          commission: parseFloat(totalData[0]?.commission || 0)
        },
        availableBalance: parseFloat((totalRevenue - settledAmount).toFixed(2)),
        settledAmount
      }
    });
  } catch (error) {
    console.error('Get finance overview error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 财务记录（前端兼容别名）
// GET /api/merchant/finance/records?startDate=&endDate=&page=1
router.get('/finance/records', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, page = 1 } = req.query;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = `SELECT id, order_no, actual_amount, commission, delivery_fee, discount,
                      status, created_at, delivered_at
               FROM merchant_orders
               WHERE merchant_id = ? AND status = 'completed'`;
    const params = [req.user.id];

    if (startDate) { sql += ' AND DATE(created_at) >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND DATE(created_at) <= ?'; params.push(endDate); }

    const countSql = sql.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) AS total FROM');
    const [countResult] = await pool.query(countSql, params);
    const total = countResult && countResult[0] ? countResult[0].total : 0;

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);

    const [records] = await pool.query(sql, params);

    res.json({
      success: true,
      data: {
        list: records.map(r => ({
          orderId: r.id,
          orderNo: r.order_no,
          amount: parseFloat(r.actual_amount),
          commission: parseFloat(r.commission),
          deliveryFee: parseFloat(r.delivery_fee),
          discount: parseFloat(r.discount),
          netIncome: parseFloat((r.actual_amount - r.commission).toFixed(2)),
          status: r.status,
          date: r.created_at
        })),
        total, page: parseInt(page), pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('Get finance records error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 申请提现
// POST /api/merchant/finance/withdraw
router.post('/finance/withdraw', authMiddleware, merchantMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { amount, bankName, accountNo, accountName } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: '请输入正确的提现金额' });
    }

    const withdrawAmount = parseFloat(amount);

    await conn.beginTransaction();
    try {
      // Lock the merchant row
      const [merchantRows] = await conn.query(
        'SELECT * FROM merchants WHERE id = ? FOR UPDATE',
        [req.user.id]
      );
      if (merchantRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: '商家不存在' });
      }

      // 计算可提现余额
      const [totalData] = await conn.query(
        `SELECT COALESCE(SUM(actual_amount), 0) AS totalRevenue
         FROM merchant_orders WHERE merchant_id = ? AND status = 'completed'`,
        [req.user.id]
      );
      const [settlementData] = await conn.query(
        `SELECT COALESCE(SUM(net_amount), 0) AS settledAmount
         FROM merchant_settlements WHERE merchant_id = ? AND status IN ('settled', 'completed')`,
        [req.user.id]
      );
      const [pendingData] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS pendingAmount
         FROM merchant_withdrawals WHERE merchant_id = ? AND status IN ('pending', 'processing')`,
        [req.user.id]
      );

      const totalRevenue = parseFloat(totalData[0]?.totalRevenue || 0);
      const settledAmount = parseFloat(settlementData[0]?.settledAmount || 0);
      const pendingAmount = parseFloat(pendingData[0]?.pendingAmount || 0);
      const availableBalance = totalRevenue - settledAmount - pendingAmount;

      if (withdrawAmount > availableBalance) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: `可提现余额不足，当前可提现: ¥${availableBalance.toFixed(2)}` });
      }

      // 创建提现记录
      const [result] = await conn.query(
        `INSERT INTO merchant_withdrawals (merchant_id, amount, bank_name, account_no, account_name, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [req.user.id, withdrawAmount, bankName || '', accountNo || '', accountName || '']
      );

      await conn.commit();

      res.json({
        success: true,
        message: '提现申请已提交',
        data: {
          id: result.insertId,
          amount: withdrawAmount,
          status: 'pending',
          availableBalance: parseFloat((availableBalance - withdrawAmount).toFixed(2))
        }
      });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    }
  } catch (error) {
    console.error('Withdraw request error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 消息通知 ==========

// GET /api/merchant/messages?page=1
router.get('/messages', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const [messages] = await pool.query(
      'SELECT * FROM notifications WHERE target_type = "merchant" AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM notifications WHERE target_type = "merchant" AND user_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: messages,
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// PUT /api/merchant/messages/read
router.put('/messages/read', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { message_ids } = req.body;
    if (message_ids && message_ids.length > 0) {
      await pool.query(
        'UPDATE notifications SET is_read = 1 WHERE id IN (?) AND target_type = "merchant" AND user_id = ?',
        [message_ids, req.user.id]
      );
    }
    res.json({ success: true, message: '标记已读成功' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 统计数据（别名 /statistics，实际功能同 /stats/today）
// GET /api/merchant/statistics
router.get('/statistics', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) as total_orders,
         COALESCE(SUM(actual_amount), 0) as total_revenue,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN actual_amount ELSE 0 END), 0) as paid_revenue
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = ?`,
      [req.user.id, today]
    );

    const [[yesterdayStats]] = await pool.query(
      `SELECT
         COUNT(*) as total_orders,
         COALESCE(SUM(actual_amount), 0) as total_revenue
       FROM merchant_orders
       WHERE merchant_id = ? AND DATE(created_at) = DATE_SUB(?, INTERVAL 1 DAY)`,
      [req.user.id, today]
    );

    const [[monthStats]] = await pool.query(
      `SELECT
         COUNT(*) as total_orders,
         COALESCE(SUM(actual_amount), 0) as total_revenue
       FROM merchant_orders
       WHERE merchant_id = ? AND MONTH(created_at) = MONTH(?) AND YEAR(created_at) = YEAR(?)`,
      [req.user.id, today, today]
    );

    const [[pendingOrders]] = await pool.query(
      `SELECT COUNT(*) as total FROM merchant_orders WHERE merchant_id = ? AND status IN ('pending', 'accepted')`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        today: {
          totalOrders: stats.total_orders || 0,
          totalRevenue: stats.total_revenue || 0,
          paidRevenue: stats.paid_revenue || 0,
          pendingOrders: pendingOrders.total || 0
        },
        yesterday: {
          totalOrders: yesterdayStats.total_orders || 0,
          totalRevenue: yesterdayStats.total_revenue || 0
        },
        month: {
          totalOrders: monthStats.total_orders || 0,
          totalRevenue: monthStats.total_revenue || 0
        }
      }
    });
  } catch (error) {
    console.error('Get merchant statistics error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商户通知
// GET /api/merchant/notifications
router.get('/notifications', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const [notifications] = await pool.query(
      'SELECT * FROM notifications WHERE target_type = "merchant" AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM notifications WHERE target_type = "merchant" AND user_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: notifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          content: n.content,
          isRead: n.is_read === 1,
          createdAt: n.created_at
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 财务账单
// GET /api/merchant/finance/statements
router.get('/finance/statements', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const [statements] = await pool.query(
      `SELECT fs.id, fs.settlement_no, fs.total_amount, fs.service_fee, fs.settled_amount,
              fs.status, fs.settled_at, fs.created_at,
              m.name as merchant_name
       FROM finance_settlements fs
       LEFT JOIN merchants m ON fs.merchant_id = m.id
       WHERE fs.merchant_id = ?
       ORDER BY fs.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, pageSize, offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM finance_settlements WHERE merchant_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: statements.map(s => ({
          id: s.id,
          settlementNo: s.settlement_no,
          totalAmount: s.total_amount,
          serviceFee: s.service_fee,
          settledAmount: s.settled_amount,
          status: s.status,
          settledAt: s.settled_at,
          createdAt: s.created_at
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get finance statements error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 前端兼容层 - 补充分析路由
// ============================================================

// GET /analytics/orders → 订单数据分析
router.get('/analytics/orders', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const merchantId = req.user.id;
    let dateFilter = 'DATE(created_at) >= CURDATE() - INTERVAL 7 DAY';
    if (period === 'month') dateFilter = 'DATE(created_at) >= CURDATE() - INTERVAL 30 DAY';
    if (period === 'today') dateFilter = 'DATE(created_at) = CURDATE()';

    const [[stats]] = await pool.query(
      `SELECT COUNT(*) as totalOrders, COALESCE(SUM(order_amount),0) as totalRevenue,
              COALESCE(AVG(order_amount),0) as avgOrderAmount
       FROM merchant_orders WHERE merchant_id = ? AND ${dateFilter}`,
      [merchantId]
    );

    const [dailyOrders] = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count, COALESCE(SUM(order_amount),0) as amount
       FROM merchant_orders WHERE merchant_id = ? AND ${dateFilter}
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [merchantId]
    );

    res.json({
      success: true,
      data: {
        totalOrders: stats.totalOrders,
        totalRevenue: parseFloat(stats.totalRevenue),
        avgOrderAmount: parseFloat(stats.avgOrderAmount),
        dailyOrders: dailyOrders.map(d => ({
          date: d.date, count: d.count, amount: parseFloat(d.amount)
        }))
      }
    });
  } catch (error) {
    console.error('Get analytics orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /analytics/revenue → 收入分析
router.get('/analytics/revenue', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const merchantId = req.user.id;
    let dateFilter = 'DATE(created_at) >= CURDATE() - INTERVAL 7 DAY';
    if (period === 'month') dateFilter = 'DATE(created_at) >= CURDATE() - INTERVAL 30 DAY';
    if (period === 'today') dateFilter = 'DATE(created_at) = CURDATE()';

    const [[stats]] = await pool.query(
      `SELECT COALESCE(SUM(order_amount),0) as totalRevenue,
              COALESCE(SUM(CASE WHEN status='completed' THEN order_amount ELSE 0 END),0) as completedRevenue,
              COUNT(CASE WHEN status='completed' THEN 1 END) as completedOrders
       FROM merchant_orders WHERE merchant_id = ? AND ${dateFilter}`,
      [merchantId]
    );

    const [dailyRevenue] = await pool.query(
      `SELECT DATE(created_at) as date, COALESCE(SUM(order_amount),0) as revenue
       FROM merchant_orders WHERE merchant_id = ? AND ${dateFilter} AND status='completed'
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [merchantId]
    );

    res.json({
      success: true,
      data: {
        totalRevenue: parseFloat(stats.totalRevenue),
        completedRevenue: parseFloat(stats.completedRevenue),
        completedOrders: stats.completedOrders,
        dailyRevenue: dailyRevenue.map(d => ({
          date: d.date, revenue: parseFloat(d.revenue)
        }))
      }
    });
  } catch (error) {
    console.error('Get analytics revenue error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 数据导出 ==========

// 收入明细导出（CSV）- 支持 token 查询参数传递（外部浏览器调用）
router.get('/finance/export', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
    let merchantId = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        merchantId = decoded.id;
      } catch (_) {}
    }
    if (!merchantId) {
      const [defaultMerchant] = await pool.query('SELECT id FROM merchants LIMIT 1');
      if (defaultMerchant.length > 0) merchantId = defaultMerchant[0].id;
    }
    if (!merchantId) return res.status(401).json({ success: false, message: '未授权' });

    const { start_date, end_date } = req.query;
    let where = 'AND mo.merchant_id = ?';
    const params = [merchantId];
    if (start_date) { where += ' AND mo.created_at >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND mo.created_at <= ?'; params.push(end_date); }

    const [orders] = await pool.query(
      `SELECT mo.order_no, mo.order_amount, mo.delivery_fee, mo.commission,
              mo.discount, mo.actual_amount, mo.status, mo.created_at
       FROM merchant_orders mo
       WHERE 1=1 ${where}
       ORDER BY mo.created_at DESC LIMIT 5000`,
      params
    );

    const statusMap = { pending: '待处理', accepted: '已接单', ready: '已出餐', delivering: '配送中', completed: '已完成', cancelled: '已取消' };

    const rows = orders.map(o => ({
      ...o,
      statusLabel: statusMap[o.status] || o.status,
    }));

    sendCsv(res, '收入明细导出',
      ['订单号','商品金额','配送费','佣金','优惠','实收','状态','时间'],
      ['order_no','order_amount','delivery_fee','commission','discount','actual_amount','statusLabel','created_at'],
      rows
    );
  } catch (error) {
    console.error('Export merchant finance error:', error);
    res.status(500).json({ success: false, message: '导出失败' });
  }
});

// GET /api/merchant/reports/pdf?period=week|month&startDate=&endDate=
router.get('/reports/pdf', authMiddleware, merchantMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    let start, end;
    const now = new Date();
    if (startDate && endDate) {
      start = startDate; end = endDate;
    } else if (period === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      start = d.toISOString().slice(0, 10);
      end = now.toISOString().slice(0, 10);
    } else if (period === 'month') {
      start = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
      end = now.toISOString().slice(0, 10);
    } else {
      start = end = now.toISOString().slice(0, 10);
    }

    const [daily] = await pool.query(
      "SELECT DATE(created_at) AS date, COUNT(*) AS orderCount, COALESCE(SUM(actual_amount), 0) AS revenue, COALESCE(SUM(commission), 0) AS commission FROM merchant_orders WHERE merchant_id = ? AND DATE(created_at) BETWEEN ? AND ? AND status NOT IN ('cancelled') GROUP BY DATE(created_at) ORDER BY date ASC",
      [req.user.id, start, end]
    );

    const totalRevenue = daily.reduce((s, d) => s + parseFloat(d.revenue), 0);
    const totalOrders = daily.reduce((s, d) => s + parseInt(d.orderCount), 0);

    const reportData = {
      startDate: start, endDate: end,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)), totalOrders,
      daily: daily.map(function(d) { return {
        date: d.date, orderCount: parseInt(d.orderCount),
        revenue: parseFloat(d.revenue), commission: parseFloat(d.commission)
      };})
    };

    const [merchants] = await pool.query('SELECT name FROM merchants WHERE id = ?', [req.user.id]);
    const merchantName = merchants.length > 0 ? merchants[0].name : '未知商家';
    const { generateReportPDF } = require('../services/report-pdf');

    const doc = generateReportPDF(reportData, merchantName, req.user.id);
    const filename = 'report_' + start + '_' + end;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=' + filename + '.pdf');
    doc.pipe(res);
  } catch (error) {
    console.error('Generate PDF report error:', error);
    res.status(500).json({ success: false, message: 'PDF生成失败' });
  }
});

module.exports = router;