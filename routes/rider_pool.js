/**
 * 盐阜配送 - 三池派单系统路由 + 共享派单函数
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, riderMiddleware } = require('../middleware/auth');

/**
 * POST /api/rider-pool/dispatch
 * 三池智能派单 - 根据骑手等级自动分配订单
 */
router.post('/dispatch', authMiddleware, async (req, res) => {
  try {
    const { order_id, order_no, distance_km, merchant_id, delivery_address } = req.body;

    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND status IN (?, ?)',
      [order_id, 'pending', 'accepted']
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在或已分配' });
    }

    const order = orders[0];
    let assignedRider = null;
    let poolType = '';

    const advancedRider = await findRiderFromPool('advanced', order);
    if (advancedRider) {
      assignedRider = advancedRider;
      poolType = 'advanced';
    } else {
      const intermediateRider = await findRiderFromPool('intermediate', order);
      if (intermediateRider) {
        assignedRider = intermediateRider;
        poolType = 'intermediate';
      } else {
        const newbieRider = await findRiderFromPool('newbie', order);
        if (newbieRider) {
          assignedRider = newbieRider;
          poolType = 'newbie';
        }
      }
    }

    if (!assignedRider) {
      return res.status(404).json({
        success: false,
        message: '暂无可用骑手，订单进入待分配队列'
      });
    }

    await pool.query(
      'UPDATE merchant_orders SET rider_id = ?, status = ? WHERE id = ?',
      [assignedRider.id, 'assigned', order_id]
    );

    await pool.query(
      `INSERT INTO dispatch_logs (order_id, rider_id, pool_type, dispatch_time, status, created_at)
       VALUES (?, ?, ?, NOW(), 'success', NOW())`,
      [order_id, assignedRider.id, poolType]
    );

    await notifyRider(assignedRider.id, {
      type: 'new_order',
      order_id: order_id,
      order_no: order_no,
      message: '您有新的配送订单'
    });

    res.json({
      success: true,
      message: '派单成功',
      data: {
        order_id: order_id,
        rider_id: assignedRider.id,
        rider_name: assignedRider.name,
        rider_phone: assignedRider.phone,
        pool_type: poolType,
        dispatch_time: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('三池派单失败:', error);
    res.status(500).json({ success: false, message: '派单失败: ' + error.message });
  }
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const [newbieCount] = await pool.query(
      `SELECT COUNT(*) as count FROM riders 
       WHERE status = 'online' AND pool_type = 'newbie' 
       AND real_name_status = 'approved'`
    );
    const [intermediateCount] = await pool.query(
      `SELECT COUNT(*) as count FROM riders 
       WHERE status = 'online' AND pool_type = 'intermediate' 
       AND real_name_status = 'approved'`
    );
    const [advancedCount] = await pool.query(
      `SELECT COUNT(*) as count FROM riders 
       WHERE status = 'online' AND pool_type = 'advanced' 
       AND real_name_status = 'approved'`
    );
    const [pendingOrders] = await pool.query(
      `SELECT COUNT(*) as count FROM orders WHERE status = 'pending'`
    );

    res.json({
      success: true,
      data: {
        pools: {
          newbie: { available: newbieCount[0].count, label: '新手池' },
          intermediate: { available: intermediateCount[0].count, label: '进阶池' },
          advanced: { available: advancedCount[0].count, label: '高阶池' }
        },
        pending_orders: pendingOrders[0].count,
        total_available: newbieCount[0].count + intermediateCount[0].count + advancedCount[0].count
      }
    });
  } catch (error) {
    console.error('获取三池状态失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reassign', authMiddleware, async (req, res) => {
  try {
    const { order_id, reason } = req.body;

    const [orders] = await pool.query(
      'SELECT * FROM orders WHERE id = ?',
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];

    await pool.query(
      `INSERT INTO dispatch_logs (order_id, rider_id, pool_type, dispatch_time, status, reason, created_at)
       VALUES (?, ?, ?, NOW(), 'reassigned', ?, NOW())`,
      [order_id, order.rider_id, order.pool_type, reason]
    );

    await pool.query(
      'UPDATE orders SET rider_id = NULL, status = ?, assigned_at = NULL WHERE id = ?',
      ['pending', order_id]
    );

    res.json({
      success: true,
      message: '订单已重置，等待重新派单',
      data: { order_id: order_id, reason: reason }
    });
  } catch (error) {
    console.error('重新派单失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/riders/:poolType', authMiddleware, async (req, res) => {
  try {
    const { poolType } = req.params;
    const validPools = ['newbie', 'intermediate', 'advanced'];

    if (!validPools.includes(poolType)) {
      return res.status(400).json({ success: false, message: '无效的池类型' });
    }

    const [riders] = await pool.query(
      `SELECT r.id, r.name, r.phone, r.status, r.pool_type,
              r.last_latitude, r.last_longitude, r.last_location_at
       FROM riders r
       WHERE r.pool_type = ? AND r.status IN ('online', 'busy')
       ORDER BY r.created_at DESC`,
      [poolType]
    );

    res.json({
      success: true,
      data: {
        pool_type: poolType,
        riders: riders
      }
    });
  } catch (error) {
    console.error('获取骑手列表失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// 共享函数（导出以便 merchant.js 等模块复用）
// ============================================================

async function findRiderFromPool(poolType, order) {
  let sql = `
    SELECT r.id, r.name, r.phone, r.last_latitude, r.last_longitude, r.pool_type
    FROM riders r
    WHERE r.status = 'online'
      AND r.pool_type = ?
  `;

  sql += `
    AND r.id NOT IN (
      SELECT rider_id FROM rider_orders
      WHERE status IN ('assigned', 'picking', 'delivering')
      GROUP BY rider_id HAVING COUNT(*) >= 4
    )
    ORDER BY r.created_at ASC
    LIMIT 1
  `;

  const [riders] = await pool.query(sql, [poolType]);
  return riders.length > 0 ? riders[0] : null;
}

/**
 * 三池智能派单（从高到低优先级）
 */
async function dispatchRider(order) {
  const advanced = await findRiderFromPool('advanced', order);
  if (advanced) return { rider: advanced, poolType: 'advanced' };

  const intermediate = await findRiderFromPool('intermediate', order);
  if (intermediate) return { rider: intermediate, poolType: 'intermediate' };

  const newbie = await findRiderFromPool('newbie', order);
  if (newbie) return { rider: newbie, poolType: 'newbie' };

  return null;
}

/**
 * 通知骑手（数据库记录 + WebSocket 推送）
 */
async function notifyRider(riderId, notification) {
  await pool.query(
    `INSERT INTO rider_notifications (rider_id, type, title, content, is_read, created_at)
     VALUES (?, ?, ?, ?, 0, NOW())`,
    [riderId, notification.type, notification.message, JSON.stringify(notification)]
  );

  try {
    const { emitToRider } = require('../services/websocket');
    emitToRider(riderId, 'order:dispatch', notification);
  } catch (wsErr) {
    console.log('WebSocket 通知骑手失败:', wsErr.message);
  }
}

module.exports = { router, findRiderFromPool, dispatchRider, notifyRider };
