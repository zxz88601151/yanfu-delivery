// 支付路由
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { WechatPay, Alipay, BalancePay, UnionPay, BestPay, generateOrderNo, generateKLOrderNo } = require('../services/payment');
const { emitOrderStatus, emitToUser, emitToMerchant, emitToRider } = require('../services/websocket');

const wechatPay = new WechatPay();
const alipay = new Alipay();
const balancePay = new BalancePay(pool);
const unionPay = new UnionPay();
const bestPay = new BestPay();

// ========== 创建支付订单 ==========

router.post('/create', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { orderId, orderType, channel, amount } = req.body;
    const userId = req.user.id;

    // 参数校验
    if (!orderId || !orderType || !channel || !amount) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: '支付金额必须大于0' });
    }
    if (!['wechat', 'alipay', 'balance', 'unionpay', 'bestpay'].includes(channel)) {
      return res.status(400).json({ success: false, message: '不支持的支付方式' });
    }

    await conn.beginTransaction();

    // 检查订单
    let order;
    if (orderType === 'merchant') {
      const [orders] = await conn.query(
        `SELECT id, status, actual_amount as total_amount FROM merchant_orders WHERE id = ? AND user_id = ?`,
        [orderId, userId]
      );
      order = orders[0];
    } else {
      // rider_orders 表没有 user_id 和 actual_amount 字段
      const [orders] = await conn.query(
        `SELECT id, status, total_income as total_amount FROM rider_orders WHERE id = ?`,
        [orderId]
      );
      order = orders[0];
    }
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: '订单不存在' });
    }
    const orderTable = orderType === 'merchant' ? 'merchant_orders' : 'rider_orders';
    if (order.status !== 'pending' && order.status !== 'pending_payment') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '订单状态不支持支付' });
    }

    // 检查是否已有支付记录
    const [existingPayments] = await conn.query(
      `SELECT id, status FROM payments
       WHERE ${orderType === 'merchant' ? 'merchant_order_id' : 'rider_order_id'} = ?
       AND user_id = ? AND status = 'success'`,
      [orderId, userId]
    );
    if (existingPayments.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '订单已支付' });
    }

    const paymentNo = generateKLOrderNo();
    const body = `盐阜配送-${orderType === 'merchant' ? '外卖' : '跑腿'}订单`;

    // 余额支付直接处理
    if (channel === 'balance') {
      await conn.rollback(); // BalancePay有自己的事务
      const result = await balancePay.pay({
        userId, orderNo: paymentNo, amount, orderId, orderType,
      });

      if (result.success) {
        // 更新订单状态（merchant_orders保持pending让商家可见并接单）
        if (orderType === 'merchant') {
          await pool.query(
            `UPDATE merchant_orders SET status = 'pending' WHERE id = ?`,
            [orderId]
          );
        } else {
          // rider_orders 没有 accepted_at 字段，用 picked_at 代替
          await pool.query(
            `UPDATE rider_orders SET status = 'picking', picked_at = NOW() WHERE id = ?`,
            [orderId]
          );
        }

        // 推送通知
        emitOrderStatus(orderId, 'paid', { channel: 'balance', userId });

        res.json({ success: true, data: { paymentNo: result.paymentNo, channel: 'balance', status: 'success' } });
      } else {
        res.status(400).json({ success: false, message: result.message });
      }
      return;
    }

    // 微信支付 / 支付宝 - 创建预支付记录
    await conn.query(
      `INSERT INTO payments (order_no, user_id, ${orderType === 'merchant' ? 'merchant_order_id' : 'rider_order_id'}, amount, channel, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [paymentNo, userId, orderId, amount, channel]
    );

    await conn.commit();

    // 调用第三方支付
    let payResult;
    if (channel === 'wechat') {
      payResult = await wechatPay.createH5Order({
        orderNo: paymentNo,
        amount,
        body,
        ip: req.ip || '127.0.0.1',
      });
    } else if (channel === 'alipay') {
      payResult = await alipay.createWapOrder({
        orderNo: paymentNo,
        amount,
        subject: body,
      });
    } else if (channel === 'unionpay') {
      payResult = await unionPay.createOrder({
        orderNo: paymentNo,
        amount,
        body,
      });
    } else if (channel === 'bestpay') {
      payResult = await bestPay.createOrder({
        orderNo: paymentNo,
        amount,
        body,
      });
    }

    if (payResult && payResult.success) {
      // [P0修复] 生产环境禁止自动完成模拟支付
      if (payResult.mock) {
        if (process.env.NODE_ENV === 'production') {
          await conn.rollback();
          return res.status(500).json({
            success: false,
            message: '支付服务未正确配置，请联系管理员',
          });
        }
        console.log(`[MockPay] 自动完成模拟支付: ${paymentNo}`);
        
        // 更新支付记录为成功
        await pool.query(
          "UPDATE payments SET status = 'success', third_party_no = ?, paid_at = NOW() WHERE order_no = ?",
          [`MOCK_${paymentNo}`, paymentNo]
        );
        
        // 更新订单状态（merchant_orders保持pending让商家可见并接单）
        if (orderType === 'merchant') {
          await pool.query(
            `UPDATE merchant_orders SET status = 'pending' WHERE id = ?`,
            [orderId]
          );
        } else {
          // rider_orders 没有 accepted_at 字段，用 picked_at 代替
          await pool.query(
            `UPDATE rider_orders SET status = 'picking', picked_at = NOW() WHERE id = ?`,
            [orderId]
          );
        }
        
        // 推送通知
        emitOrderStatus(orderId, 'paid', { channel, mock: true, userId });
        
        res.json({
          success: true,
          data: {
            paymentNo,
            channel,
            status: 'success',  // 直接返回成功状态
            mock: true,
            message: '模拟支付已自动完成',
          }
        });
      } else {
        res.json({
          success: true,
          data: {
            paymentNo,
            channel,
            status: 'pending',
            mock: false,
            payUrl: payResult.mwebUrl || payResult.payUrl || null,
            payParams: payResult.payParams || null,
          }
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: payResult?.errMsg || '创建支付订单失败',
      });
    }
  } catch (error) {
    try { await conn.rollback(); } catch (e) {}
    console.error('Create payment error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ========== 微信支付回调 ==========
router.post('/notify/wechat', async (req, res) => {
  try {
    let xmlData = '';
    req.on('data', chunk => xmlData += chunk);
    req.on('end', async () => {
      const result = await wechatPay.handleNotify(xmlData);

      if (result.success) {
        // 更新支付记录（幂等：仅处理未成功的记录）
        await pool.query(
          `UPDATE payments SET status = 'success', third_party_no = ?, paid_at = NOW(), notify_data = ? WHERE order_no = ? AND status != 'success'`,
          [result.transactionId, JSON.stringify(result.rawData), result.paymentNo]
        );

        // 更新订单状态
        const [payments] = await pool.query('SELECT merchant_order_id, rider_order_id, user_id FROM payments WHERE order_no = ?', [result.paymentNo]);
        if (payments.length > 0) {
          const p = payments[0];
          if (p.merchant_order_id) {
            await pool.query("UPDATE merchant_orders SET status = 'pending' WHERE id = ?", [p.merchant_order_id]);
          }
          if (p.rider_order_id) {
            await pool.query("UPDATE rider_orders SET status = 'picking', picked_at = NOW() WHERE id = ?", [p.rider_order_id]);
          }

          // 推送通知
          emitOrderStatus(p.merchant_order_id || p.rider_order_id, 'paid', { channel: 'wechat', userId: p.user_id });
        }

        res.set('Content-Type', 'application/xml');
        res.send(wechatPay.notifyResponse(true));
      } else {
        res.set('Content-Type', 'application/xml');
        res.send(wechatPay.notifyResponse(false));
      }
    });
  } catch (error) {
    console.error('Wechat notify error:', error);
    res.set('Content-Type', 'application/xml');
    res.send(wechatPay.notifyResponse(false));
  }
});

// ========== 支付宝回调 ==========
router.post('/notify/alipay', async (req, res) => {
  try {
    const result = await alipay.handleNotify(req.body);

    if (result.success) {
      await pool.query(
        `UPDATE payments SET status = 'success', third_party_no = ?, paid_at = NOW(), notify_data = ? WHERE order_no = ? AND status != 'success'`,
        [result.transactionId, JSON.stringify(result.rawData), result.paymentNo]
      );

      const [payments] = await pool.query('SELECT merchant_order_id, rider_order_id, user_id FROM payments WHERE order_no = ?', [result.paymentNo]);
      if (payments.length > 0) {
        const p = payments[0];
        if (p.merchant_order_id) {
          await pool.query("UPDATE merchant_orders SET status = 'pending' WHERE id = ?", [p.merchant_order_id]);
        }
        if (p.rider_order_id) {
          await pool.query("UPDATE rider_orders SET status = 'picking', picked_at = NOW() WHERE id = ?", [p.rider_order_id]);
        }
        emitOrderStatus(p.merchant_order_id || p.rider_order_id, 'paid', { channel: 'alipay', userId: p.user_id });
      }

      res.send('success');
    } else {
      res.send('fail');
    }
  } catch (error) {
    console.error('Alipay notify error:', error);
    res.send('fail');
  }
});

// ========== 模拟支付（仅开发/测试环境） ==========
// [P0修复] 生产环境完全禁用mock-pay
router.post('/mock-pay', authMiddleware, async (req, res) => {
  // [P0修复] 生产环境禁止模拟支付
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: '生产环境不支持模拟支付' });
  }
  try {
    const { paymentNo } = req.body;
    if (!paymentNo) {
      return res.status(400).json({ success: false, message: '缺少支付单号' });
    }

    const [payments] = await pool.query('SELECT * FROM payments WHERE order_no = ? AND user_id = ?', [paymentNo, req.user.id]);
    if (payments.length === 0) {
      return res.status(404).json({ success: false, message: '支付记录不存在' });
    }

    const payment = payments[0];
    if (payment.status === 'success') {
      return res.status(400).json({ success: false, message: '已支付' });
    }

    // 更新为已支付
    await pool.query(
      "UPDATE payments SET status = 'success', third_party_no = ?, paid_at = NOW() WHERE order_no = ?",
      [`MOCK_${paymentNo}`, paymentNo]
    );

    // 更新订单状态（merchant_orders保持pending让商家可见并接单）
    if (payment.merchant_order_id) {
        await pool.query("UPDATE merchant_orders SET status = 'pending' WHERE id = ?", [payment.merchant_order_id]);
      }
      if (payment.rider_order_id) {
        await pool.query("UPDATE rider_orders SET status = 'picking', picked_at = NOW() WHERE id = ?", [payment.rider_order_id]);
      }

    emitOrderStatus(payment.merchant_order_id || payment.rider_order_id, 'paid', { channel: payment.channel, userId: payment.user_id });

    res.json({ success: true, message: '模拟支付成功', data: { paymentNo, status: 'success' } });
  } catch (error) {
    console.error('Mock pay error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 查询支付状态 ==========
router.get('/status/:orderNo', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.params;
    const [payments] = await pool.query(
      'SELECT order_no, amount, channel, status, paid_at, created_at FROM payments WHERE order_no = ? AND user_id = ?',
      [orderNo, req.user.id]
    );

    if (payments.length === 0) {
      return res.status(404).json({ success: false, message: '支付记录不存在' });
    }

    res.json({ success: true, data: payments[0] });
  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
