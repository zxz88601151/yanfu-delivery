const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware, userMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const mapService = require('../services/map');  // 高德地图服务（配送费动态计算）

// 生成订单号 - 使用 UUID 确保唯一性
const generateOrderNo = () => {
  return 'UO' + uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
};

// 获取商家列表
router.get('/stores', async (req, res) => {
  try {
    const { category, keyword, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const offset = (parseInt(page) - 1) * safeLimit;
    
    let sql = 'SELECT id, name, avatar, address, phone, category, rating, total_orders, delivery_range, min_order_amount, is_open FROM merchants WHERE is_open = 1';
    const params = [];
    
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    
    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND (name LIKE ? OR address LIKE ?)';
      params.push(`%${safeKeyword}%`, `%${safeKeyword}%`);
    }
    
    sql += ' ORDER BY rating DESC, total_orders DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, offset);
    
    const [stores] = await pool.query(sql, params);
    
    res.json({
      success: true,
      data: stores.map(store => ({
        id: store.id,
        name: store.name,
        address: store.address,
        category: store.category,
        avatar: store.avatar,
        rating: store.rating,
        totalOrders: store.total_orders,
        deliveryRange: store.delivery_range,
        minOrderAmount: store.min_order_amount,
        isOpen: store.is_open === 1
      }))
    });
  } catch (error) {
    console.error('Get stores error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 附近商家（带LBS筛选+排序）- 必须在 /stores/:id 前面
// GET /api/user/stores/nearby?lat=&lng=&category=&sort=distance|rating|sales|speed&minRating=&maxFee=&page=1
router.get('/stores/nearby', async (req, res) => {
  try {
    const {
      lat, lng, category, keyword, sort = 'distance',
      minRating, maxFee, isOpen, page = 1, pageSize = 20
    } = req.query;
    const safePageSize = Math.min(parseInt(pageSize) || 20, 100);
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    let sql = `SELECT m.*`;

    if (lat && lng) {
      sql += `,
        (6371 * ACOS(COS(RADIANS(?)) * COS(RADIANS(m.latitude)) *
          COS(RADIANS(m.longitude) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(m.latitude)))) AS distance_km`;
    }

    sql += ` FROM merchants m WHERE 1=1`;
    const params = lat && lng ? [parseFloat(lat), parseFloat(lng), parseFloat(lat)] : [];

    if (category) { sql += ' AND m.category = ?'; params.push(category); }
    if (keyword) { 
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND m.name LIKE ?'; 
      params.push(`%${safeKeyword}%`); 
    }
    if (minRating) { sql += ' AND m.rating >= ?'; params.push(parseFloat(minRating)); }
    if (maxFee) { sql += ' AND m.delivery_fee <= ?'; params.push(parseFloat(maxFee)); }
    if (isOpen !== undefined) { sql += ' AND m.is_open = ?'; params.push(isOpen === 'true' ? 1 : 0); }

    const ALLOWED_SORT = ['m.rating DESC', 'm.total_orders DESC', 'm.estimated_time ASC', 'distance_km ASC', 'm.id DESC'];
    const sortInput = sort || 'distance';
    const sortMap = {
      distance: lat && lng ? 'distance_km ASC' : 'm.id DESC',
      rating: 'm.rating DESC',
      sales: 'm.total_orders DESC',
      speed: 'm.estimated_time ASC'
    };
    const sortValue = sortMap[sortInput] || 'm.rating DESC';
    if (!ALLOWED_SORT.includes(sortValue)) {
      return res.status(400).json({ success: false, message: '无效的排序参数' });
    }
    sql += ` ORDER BY ${sortValue} LIMIT ? OFFSET ?`;
    params.push(safePageSize, offset);

    const [stores] = await pool.query(sql, params);

    res.json({
      success: true,
      data: stores.map(s => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        category: s.category,
        rating: s.rating,
        totalOrders: s.total_orders,
        minOrderAmount: s.min_order_amount,
        deliveryFee: null,          // 字段尚未迁移
        estimatedTime: null,        // 字段尚未迁移
        isOpen: !!s.is_open,
        announcement: null,         // 字段尚未迁移
        distanceKm: s.distance_km != null ? parseFloat(s.distance_km.toFixed(2)) : null
      }))
    });
  } catch (error) {
    console.error('Get nearby stores error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 搜索商家/菜品 - 必须在 /stores/:id 前面
// GET /api/user/search?keyword=&type=store|menu
router.get('/search', async (req, res) => {
  try {
    const { keyword, type = 'all', page = 1, pageSize = 20 } = req.query;
    if (!keyword) return res.status(400).json({ success: false, message: '请输入搜索关键词' });

    const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
    const safePageSize = Math.min(parseInt(pageSize) || 20, 100);
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;
    const results = { stores: [], menus: [] };

    if (type === 'all' || type === 'store') {
      const [stores] = await pool.query(
        'SELECT id, name, avatar, category, rating FROM merchants WHERE name LIKE ? LIMIT ?',
        [`%${safeKeyword}%`, safePageSize]
      );
      results.stores = stores;
    }

    if (type === 'all' || type === 'menu') {
      const [menus] = await pool.query(
        `SELECT mm.id, mm.name, mm.price, mm.image, m.id as merchant_id, m.name as merchant_name
         FROM merchant_menu mm JOIN merchants m ON mm.merchant_id = m.id
         WHERE mm.name LIKE ? AND mm.is_available = 1 LIMIT ?`,
        [`%${safeKeyword}%`, safePageSize]
      );
      results.menus = menus;
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取热门搜索关键词
// GET /api/user/search/hot
router.get('/search/hot', async (req, res) => {
  try {
    // 返回预设的热门关键词
    const hotKeywords = [
      '黄焖鸡米饭', '麻辣烫', '兰州拉面', '沙县小吃', '火锅',
      '炸鸡', '烧烤', '盖浇饭', '炒饭', '饺子'
    ];
    res.json({ success: true, data: hotKeywords });
  } catch (error) {
    console.error('Get hot searches error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取商家详情
router.get('/stores/:id', async (req, res) => {
  try {
    const fields = ['id', 'name', 'avatar', 'address', 'phone', 'category', 'rating', 'total_orders', 'delivery_range', 'min_order_amount', 'is_open', 'auto_accept', 'voice_reminder', 'created_at'];
    const [stores] = await pool.query(
      `SELECT ${fields.join(', ')} FROM merchants WHERE id = ?`,
      [req.params.id]
    );
    
    if (stores.length === 0) {
      return res.status(404).json({ success: false, message: '商家不存在' });
    }

    const store = stores[0];
    res.json({
      success: true,
      data: {
        id: store.id,
        name: store.name,
        address: store.address,
        category: store.category,
        avatar: store.avatar,
        rating: store.rating,
        totalOrders: store.total_orders,
        deliveryRange: store.delivery_range,
        minOrderAmount: store.min_order_amount,
        isOpen: store.is_open === 1
      }
    });
  } catch (error) {
    console.error('Get store detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取商家菜单
router.get('/stores/:id/menu', async (req, res) => {
  try {
    const [menu] = await pool.query(
      'SELECT * FROM merchant_menu WHERE merchant_id = ? AND is_available = 1 ORDER BY category, id',
      [req.params.id]
    );
    
    res.json({
      success: true,
      data: menu.map(item => ({
        id: item.id,
        merchantId: item.merchant_id,
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
    console.error('Get store menu error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取购物车
router.get('/cart', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [items] = await pool.query(`
      SELECT c.*, m.name as merchant_name 
      FROM carts c 
      JOIN merchants m ON c.merchant_id = m.id 
      WHERE c.user_id = ?
    `, [req.user.id]);
    
    // 按商家分组
    const grouped = {};
    items.forEach(item => {
      if (!grouped[item.merchant_id]) {
        grouped[item.merchant_id] = {
          merchantId: item.merchant_id,
          merchantName: item.merchant_name,
          items: []
        };
      }
      grouped[item.merchant_id].items.push({
        id: item.id,
        menuItemId: item.menu_item_id,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      });
    });
    
    res.json({
      success: true,
      data: Object.values(grouped)
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 添加到购物车
router.post('/cart', authMiddleware, userMiddleware, async (req, res) => {
  try {
    // 兼容 camelCase 和 snake_case 两种字段名
    let merchantId = req.body.merchantId || req.body.merchant_id || req.body.storeId || req.body.store_id;
    const menuItemId = req.body.menuItemId || req.body.menu_item_id || req.body.dishId;
    const name = req.body.name;
    const price = req.body.price;
    const quantity = parseInt(req.body.quantity) || 1;

    // 参数校验
    if (!menuItemId) {
      return res.status(400).json({ success: false, message: '缺少菜品ID' });
    }

    // 如果只传了 dishId 没传 merchantId，从菜单表自动查商家ID
    if (!merchantId && menuItemId) {
      const [menuRows] = await pool.query(
        'SELECT merchant_id FROM merchant_menu WHERE id = ?',
        [menuItemId]
      );
      if (menuRows.length > 0) {
        merchantId = menuRows[0].merchant_id;
      }
    }

    if (!merchantId) {
      return res.status(400).json({ success: false, message: '缺少商家ID' });
    }

    // 如果前端未传 name/price，从菜单表查询补全
    let itemName = name;
    let itemPrice = price;
    if (!itemName || !itemPrice) {
      const [menuRow] = await pool.query(
        'SELECT name, price FROM merchant_menu WHERE id = ? AND merchant_id = ?',
        [menuItemId, merchantId]
      );
      if (menuRow.length > 0) {
        itemName = itemName || menuRow[0].name;
        itemPrice = itemPrice || menuRow[0].price;
      }
    }

    // 检查是否已有相同商品
    const [existing] = await pool.query(
      'SELECT * FROM carts WHERE user_id = ? AND menu_item_id = ?',
      [req.user.id, menuItemId]
    );
    
    if (existing.length > 0) {
      // 更新数量
      await pool.query(
        'UPDATE carts SET quantity = quantity + ? WHERE id = ?',
        [quantity, existing[0].id]
      );
    } else {
      // 新增
      await pool.query(
        'INSERT INTO carts (user_id, merchant_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, merchantId, menuItemId, itemName || '未知商品', itemPrice || 0, quantity]
      );
    }
    
    res.json({ success: true, message: '已添加到购物车' });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新购物车数量
router.put('/cart/:itemId', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { quantity } = req.body;
    
    if (quantity <= 0) {
      await pool.query('DELETE FROM carts WHERE id = ? AND user_id = ?', [req.params.itemId, req.user.id]);
      return res.json({ success: true, message: '已从购物车移除' });
    }
    
    await pool.query(
      'UPDATE carts SET quantity = ? WHERE id = ? AND user_id = ?',
      [quantity, req.params.itemId, req.user.id]
    );
    
    res.json({ success: true, message: '已更新数量' });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 从购物车删除
router.delete('/cart/:itemId', authMiddleware, userMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM carts WHERE id = ? AND user_id = ?',
      [req.params.itemId, req.user.id]
    );
    
    res.json({ success: true, message: '已从购物车移除' });
  } catch (error) {
    console.error('Delete cart item error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 清空商家购物车
router.delete('/cart/merchant/:merchantId', authMiddleware, userMiddleware, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM carts WHERE user_id = ? AND merchant_id = ?',
      [req.user.id, req.params.merchantId]
    );
    
    res.json({ success: true, message: '已清空商家购物车' });
  } catch (error) {
    console.error('Clear merchant cart error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 提交订单
router.post('/orders', authMiddleware, userMiddleware, async (req, res) => {
  try {
    // [修复] 兼容 camelCase 和 snake_case 两种字段名
    const merchantId = req.body.merchantId || req.body.merchant_id || req.body.storeId || req.body.store_id;
    const { deliveryAddress, deliveryName, deliveryPhone, items, remark, couponId } = req.body;
    
    // 参数校验
    if (!merchantId || !deliveryAddress || !deliveryName || !deliveryPhone || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }
    
    // 获取商家信息
    const [merchants] = await pool.query('SELECT * FROM merchants WHERE id = ?', [merchantId]);
    if (merchants.length === 0) {
      return res.status(404).json({ success: false, message: '商家不存在' });
    }
    const merchant = merchants[0];
    
    // 计算订单金额 - 服务端从数据库重新查询价格，不信任客户端
    let orderAmount = 0;
    const orderItems = [];
    for (const item of items) {
      // [修复] 使用 is_available 字段，而非 status = "active"
      const [menuItems] = await pool.query(
        'SELECT price, name FROM merchant_menu WHERE id = ? AND is_available = 1',
        [item.menuItemId || item.id]
      );
      if (menuItems.length === 0) {
        return res.status(400).json({ success: false, message: `菜品 ${item.menuItemId || item.id} 不存在或已下架` });
      }
      const realPrice = menuItems[0].price;
      const itemName = menuItems[0].name;
      orderAmount += realPrice * item.quantity;
      orderItems.push({
        id: item.menuItemId || item.id,
        name: itemName,
        price: realPrice,
        quantity: item.quantity
      });
      // 更新销量
      await pool.query(
        'UPDATE merchant_menu SET sales_count = sales_count + ? WHERE id = ?',
        [item.quantity, item.menuItemId || item.id]
      );
    }
    
    // 计算配送费和佣金
    let deliveryFee = 3.00;
    try {
      if (merchant.latitude && merchant.longitude) {
        // 尝试获取用户地址坐标
        const [userAddresses] = await pool.query(
          'SELECT latitude, longitude FROM user_addresses WHERE user_id = ? AND is_default = 1 LIMIT 1',
          [req.user.id]
        );
        let destLat = merchant.latitude;
        let destLng = merchant.longitude;
        if (userAddresses.length > 0 && userAddresses[0].latitude && userAddresses[0].longitude) {
          destLat = userAddresses[0].latitude;
          destLng = userAddresses[0].longitude;
        }
        const feeResult = await mapService.calcDeliveryFee(
          parseFloat(merchant.longitude), parseFloat(merchant.latitude),
          parseFloat(destLng), parseFloat(destLat)
        );
        if (feeResult && feeResult.fee !== undefined) {
          deliveryFee = feeResult.fee;
        }
      }
    } catch (feeErr) {
      console.warn('[DeliveryFee] 动态计算失败，使用默认值:', feeErr.message);
    }
    const commission = orderAmount * 0.15; // 15%佣金
    
    // 优惠券折扣
    let discount = 0;
    if (couponId) {
      // 检查优惠券是否可用
      const [coupons] = await pool.query(
        'SELECT * FROM user_coupons WHERE id = ? AND user_id = ? AND is_used = 0',
        [couponId, req.user.id]
      );
      if (coupons.length > 0) {
        const coupon = coupons[0];
        // 获取优惠券详情
        const [couponDetails] = await pool.query('SELECT * FROM merchant_coupons WHERE id = ?', [coupon.coupon_id]);
        if (couponDetails.length > 0 && orderAmount >= couponDetails[0].min_order_amount) {
          discount = couponDetails[0].face_value;
          // 标记优惠券已使用
          await pool.query('UPDATE user_coupons SET status = \'used\', used_at = NOW() WHERE id = ?', [couponId]);
        }
      }
    }
    
    const actualAmount = orderAmount + deliveryFee - discount;
    
    // 生成订单号
    const orderNo = generateOrderNo();
    const pickupCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    // 创建订单
    const [result] = await pool.query(
      `INSERT INTO merchant_orders 
       (order_no, user_id, merchant_id, order_amount, commission, delivery_fee, discount, actual_amount, 
        items, delivery_address, delivery_name, delivery_phone, pickup_code, remark) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, req.user.id, merchantId, orderAmount, commission, deliveryFee, discount, actualAmount,
       JSON.stringify(orderItems), deliveryAddress, deliveryName, deliveryPhone, pickupCode, remark || null]
    );
    
    const orderId = result.insertId;
    
    // 清空该商家购物车
    await pool.query('DELETE FROM carts WHERE user_id = ? AND merchant_id = ?', [req.user.id, merchantId]);
    
    // 更新商家订单数和今日收入
    await pool.query(
      'UPDATE merchants SET total_orders = total_orders + 1, today_revenue = today_revenue + ? WHERE id = ?',
      [actualAmount, merchantId]
    );
    
    // WebSocket推送给商家（新订单通知）
    try {
      const { emitToMerchant } = require('../services/websocket');
      emitToMerchant(merchantId, 'order:new', {
        orderId,
        orderNo,
        amount: actualAmount,
        items: orderItems.length,
        createdAt: new Date().toISOString()
      });
    } catch (wsError) {
      console.log('WebSocket推送失败:', wsError.message);
    }

    res.json({
      success: true,
      message: '订单提交成功',
      data: {
        id: orderId,
        orderNo,
        pickupCode,
        actualAmount
      }
    });
  } catch (error) {
    console.error('Submit order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取用户订单列表
router.get('/orders', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    
    let sql = `SELECT mo.*, m.name as merchant_name,
      (SELECT COUNT(*) > 0 FROM payments p WHERE p.merchant_order_id = mo.id AND p.status = 'success') as is_paid
      FROM merchant_orders mo JOIN merchants m ON mo.merchant_id = m.id WHERE mo.user_id = ?`;
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
        merchantId: order.merchant_id,
        merchantName: order.merchant_name,
        status: order.status,
        isPaid: !!order.is_paid,
        orderAmount: order.order_amount,
        deliveryFee: order.delivery_fee,
        actualAmount: order.actual_amount,
        items: typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []),
        deliveryAddress: order.delivery_address,
        pickupCode: order.pickup_code,
        riderName: order.rider_name,
        createdAt: order.created_at
      }))
    });
  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单详情
router.get('/orders/:id', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT mo.*, m.name as merchant_name, m.address as merchant_address,
      (SELECT COUNT(*) > 0 FROM payments p WHERE p.merchant_order_id = mo.id AND p.status = 'success') as is_paid
      FROM merchant_orders mo 
      JOIN merchants m ON mo.merchant_id = m.id 
      WHERE mo.id = ? AND mo.user_id = ?
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
        merchantId: order.merchant_id,
        merchantName: order.merchant_name,
        merchantAddress: order.merchant_address,
        status: order.status,
        isPaid: !!order.is_paid,
        orderAmount: order.order_amount,
        deliveryFee: order.delivery_fee,
        discount: order.discount,
        actualAmount: order.actual_amount,
        items: typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []),
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
      }
    });
  } catch (error) {
    console.error('Get order detail error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 取消订单
router.put('/orders/:id/cancel', authMiddleware, userMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    const [orders] = await conn.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: '订单不存在' });
    }
    
    if (!['pending', 'accepted'].includes(orders[0].status)) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '订单状态不允许取消' });
    }

    const order = orders[0];

    // 检查是否已支付，已支付则自动退款
    const [payments] = await conn.query(
      "SELECT * FROM payments WHERE merchant_order_id = ? AND status = 'success'",
      [order.id]
    );

    if (payments.length > 0) {
      const payment = payments[0];
      const refundAmount = parseFloat(payment.amount);

      // 余额支付直接退回余额
      if (payment.channel === 'balance') {
        await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [refundAmount, req.user.id]);
      }
      // 其他渠道标记为待退款（模拟环境下直接标记为已退款）
      
      // 更新支付记录为已退款
      await conn.query(
        "UPDATE payments SET status = 'refunded' WHERE id = ?",
        [payment.id]
      );

      console.log(`[Refund] Order ${order.id} refunded ${refundAmount} via ${payment.channel}`);
    }

    await conn.query(
      'UPDATE merchant_orders SET status = "cancelled" WHERE id = ?',
      [order.id]
    );
    
    await conn.commit();
    res.json({ success: true, message: payments.length > 0 ? '订单已取消，退款已处理' : '订单已取消' });
  } catch (error) {
    try { await conn.rollback(); } catch (e) {}
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ============================================================
// 1. 个人中心
// ============================================================

// 获取个人信息
// GET /api/user/profile
router.get('/profile', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT id, name, phone, avatar, gender, birthday, balance, points, member_level, member_expire_at, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' });

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : null,
        avatar: user.avatar,
        gender: user.gender,
        birthday: user.birthday,
        balance: user.balance,
        points: user.points,
        memberLevel: user.member_level || 0,
        memberExpireAt: user.member_expire_at,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新个人信息
// PUT /api/user/profile
router.put('/profile', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { name, avatar, gender, birthday } = req.body;
    const allowedFields = ['name', 'avatar', 'gender', 'birthday'];
    const fields = [];
    const values = [];
    const updateData = { name, avatar, gender, birthday };
    for (const [key, value] of Object.entries(updateData)) {
      if (value !== undefined && allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return res.status(400).json({ success: false, message: '无有效更新字段' });
    values.push(req.user.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: '个人信息更新成功' });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 收货地址管理
// ============================================================

// 获取地址列表
// GET /api/user/addresses
router.get('/addresses', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [addrs] = await pool.query(
      `SELECT id, name, phone, address, province, city, district, address_detail, latitude, longitude, tag, is_default, user_id, is_deleted, created_at FROM user_addresses WHERE user_id = ? AND is_deleted = 0 ORDER BY is_default DESC, created_at DESC`,
      [req.user.id]
    );
    res.json({
      success: true,
      data: addrs.map(a => ({
        id: a.id,
        name: a.name,
        phone: a.phone ? a.phone.slice(0, 3) + '****' + a.phone.slice(-4) : null,
        address: a.address,
        province: a.province || '',
        city: a.city || '',
        district: a.district || '',
        addressDetail: a.address_detail,
        latitude: a.latitude,
        longitude: a.longitude,
        tag: a.tag,
        isDefault: !!a.is_default
      }))
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 新增/更新地址
// POST /api/user/addresses
router.post('/addresses', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { name, phone, address, province, city, district, addressDetail, latitude, longitude, tag, isDefault } = req.body;
    if (!name || !phone || !address) {
      return res.status(400).json({ success: false, message: '请填写完整地址信息' });
    }

    if (isDefault) {
      await pool.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    }

    const [result] = await pool.query(
      'INSERT INTO user_addresses (user_id, name, phone, address, province, city, district, address_detail, latitude, longitude, tag, is_default) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, name, phone, address, province || '', city || '', district || '', addressDetail, latitude, longitude, tag || '家', isDefault ? 1 : 0]
    );
    res.json({ success: true, message: '地址添加成功', id: result.insertId });
  } catch (error) {
    console.error('Save address error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除地址
// DELETE /api/user/addresses/:id
router.delete('/addresses/:id', authMiddleware, userMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE user_addresses SET is_deleted = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: '地址删除成功' });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新地址
// PUT /api/user/addresses/:id
router.put('/addresses/:id', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { name, phone, address, province, city, district, addressDetail, latitude, longitude, tag, isDefault } = req.body;
    if (!name || !phone || !address) {
      return res.status(400).json({ success: false, message: '请填写完整地址信息' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM user_addresses WHERE id = ? AND user_id = ? AND is_deleted = 0',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '地址不存在' });
    }

    if (isDefault) {
      await pool.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    }

    await pool.query(
      'UPDATE user_addresses SET name=?, phone=?, address=?, province=?, city=?, district=?, address_detail=?, latitude=?, longitude=?, tag=?, is_default=? WHERE id=? AND user_id=?',
      [name, phone, address, province || '', city || '', district || '', addressDetail, latitude, longitude, tag || '家', isDefault ? 1 : 0, req.params.id, req.user.id]
    );
    res.json({ success: true, message: '地址更新成功' });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 设置默认地址
// PUT /api/user/addresses/:id/default
router.put('/addresses/:id/default', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [existing] = await pool.query(
      'SELECT id FROM user_addresses WHERE id = ? AND user_id = ? AND is_deleted = 0',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: '地址不存在' });
    }

    await pool.query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    await pool.query('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    res.json({ success: true, message: '默认地址设置成功' });
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 3. 商家详情页扩展
// ============================================================

// 商家评价列表
// GET /api/user/stores/:id/reviews?rating=&page=1
router.get('/stores/:id/reviews', async (req, res) => {
  try {
    const { rating, page = 1, pageSize = 20 } = req.query;
    const safePageSize = Math.min(parseInt(pageSize) || 20, 100);
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    let sql = `SELECT r.id, r.rating, r.content, r.tags, r.merchant_reply, r.reply_at, r.created_at,
                      u.name AS user_name, u.avatar AS user_avatar
               FROM merchant_reviews r LEFT JOIN users u ON r.user_id = u.id
               WHERE r.merchant_id = ?`;
    const params = [req.params.id];

    if (rating) { sql += ' AND r.rating = ?'; params.push(parseInt(rating)); }
    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(safePageSize, offset);

    const [reviews] = await pool.query(sql, params);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM merchant_reviews WHERE merchant_id = ?', [req.params.id]);
    const [[stats]] = await pool.query(
      'SELECT AVG(rating) AS avgRating, COUNT(*) AS total, SUM(rating=5) AS star5, SUM(rating=4) AS star4, SUM(rating<=3) AS star3below FROM merchant_reviews WHERE merchant_id = ?',
      [req.params.id]
    );

    // 批量获取评价图片
    const reviewIds = reviews.map(r => r.id);
    let imageMap = {};
    if (reviewIds.length > 0) {
      try {
        const [images] = await pool.query(
          'SELECT review_id, image_url FROM review_images WHERE review_id IN (?) ORDER BY sort_order',
          [reviewIds]
        );
        images.forEach(img => {
          if (!imageMap[img.review_id]) imageMap[img.review_id] = [];
          imageMap[img.review_id].push(img.image_url);
        });
      } catch (e) { /* review_images 表可能不存在 */ }
    }

    res.json({
      success: true,
      data: {
        stats: {
          avgRating: parseFloat(parseFloat(stats.avgRating || 0).toFixed(1)),
          total: parseInt(stats.total || 0),
          star5: parseInt(stats.star5 || 0),
          star4: parseInt(stats.star4 || 0),
          star3below: parseInt(stats.star3below || 0)
        },
        list: reviews.map(r => ({
          id: r.id,
          userName: r.user_name,
          userAvatar: r.user_avatar,
          rating: r.rating,
          comment: r.content,
          images: imageMap[r.id] || (r.tags ? JSON.parse(r.tags) : []),
          tasteRating: null,
          packagingRating: null,
          deliveryRating: null,
          reply: r.merchant_reply,
          replyAt: r.reply_at,
          createdAt: r.created_at
        })),
        total, page: safePage, pageSize: parseInt(pageSize)
      }
    });
  } catch (error) {
    console.error('Get store reviews error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家活动/满减信息
// GET /api/user/stores/:id/promotions
router.get('/stores/:id/promotions', async (req, res) => {
  try {
    const [promos] = await pool.query(
      `SELECT id, type, name, rules, start_time, end_time
       FROM merchant_promotions
       WHERE merchant_id = ? AND status = 'active'
         AND (start_time IS NULL OR start_time <= NOW())
         AND (end_time IS NULL OR end_time >= NOW())`,
      [req.params.id]
    );
    res.json({
      success: true,
      data: promos.map(p => ({
        id: p.id,
        type: p.type,
        title: p.name,
        config: p.rules ? (typeof p.rules === 'string' ? JSON.parse(p.rules) : p.rules) : {},
        startAt: p.start_time,
        endAt: p.end_time
      }))
    });
  } catch (error) {
    console.error('Get store promotions error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 领取商家优惠券 [P0修复] 使用事务保证一致性
router.post('/stores/:id/coupons/:couponId/claim', authMiddleware, userMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { couponId } = req.params;

    await conn.beginTransaction();
    try {
      // [P0修复] 使用 INSERT IGNORE + 事务防止重复领取
      // 需要数据库有 UNIQUE INDEX (user_id, coupon_id)
      const [insertResult] = await conn.query(
        `INSERT IGNORE INTO user_coupons (user_id, coupon_id, expires_at) 
         SELECT ?, ?, end_time FROM merchant_coupons 
         WHERE id = ? AND status = 'active' AND remaining_quantity > 0`,
        [req.user.id, couponId, couponId]
      );
      
      if (insertResult.affectedRows === 0) {
        await conn.rollback();
        // 检查原因
        const [[existingCoupon]] = await conn.query(
          'SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ?',
          [req.user.id, couponId]
        );
        if (existingCoupon) {
          return res.status(400).json({ success: false, message: '已领取过该优惠券' });
        }
        const [[coupon]] = await conn.query(
          'SELECT remaining_quantity FROM merchant_coupons WHERE id = ?',
          [couponId]
        );
        if (!coupon) {
          return res.status(404).json({ success: false, message: '优惠券不存在' });
        }
        if (coupon.remaining_quantity <= 0) {
          return res.status(400).json({ success: false, message: '优惠券已领完' });
        }
        return res.status(400).json({ success: false, message: '领取失败，请重试' });
      }

      // 原子递减剩余数量
      await conn.query(
        'UPDATE merchant_coupons SET remaining_quantity = remaining_quantity - 1 WHERE id = ?',
        [couponId]
      );

      await conn.commit();
      res.json({ success: true, message: '优惠券领取成功' });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    }
  } catch (error) {
    console.error('Claim coupon error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// ============================================================
// 4. 下单扩展
// ============================================================

// 提交带备注/优惠的订单（扩展版）
// POST /api/user/orders/checkout
router.post('/orders/checkout', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const {
      merchantId, addressId, items, remark,
      couponId, deliveryType = 'instant', scheduledAt,
      paymentMethod = 'balance', cutlery = true
    } = req.body;

    if (!merchantId || !addressId || !items || items.length === 0) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }

    // 获取收货地址
    const [[addr]] = await pool.query('SELECT * FROM user_addresses WHERE id = ? AND user_id = ?', [addressId, req.user.id]);
    if (!addr) return res.status(400).json({ success: false, message: '地址不存在' });

    // 获取商家
    const [[merchant]] = await pool.query('SELECT * FROM merchants WHERE id = ? AND is_open = 1', [merchantId]);
    if (!merchant) return res.status(400).json({ success: false, message: '商家不存在或已暂停营业' });

    // 计算金额 - 服务端从数据库重新查询，不信任客户端价格
    let orderAmount = 0;
    const orderItems = [];
    for (const item of items) {
      const [menuItems] = await pool.query(
        'SELECT price, name FROM merchant_menu WHERE id = ? AND is_available = 1',
        [item.id]
      );
      if (menuItems.length === 0) {
        return res.status(400).json({ success: false, message: `菜品 ${item.id} 不存在或已下架` });
      }
      const realPrice = menuItems[0].price;
      const itemName = menuItems[0].name;
      orderAmount += realPrice * parseInt(item.quantity);
      orderItems.push({ id: item.id, name: itemName, price: realPrice, quantity: item.quantity, specs: item.specs });
      await pool.query('UPDATE merchant_menu SET sales_count = sales_count + ? WHERE id = ?', [item.quantity, item.id]);
    }

    if (orderAmount < parseFloat(merchant.min_order_amount || 0)) {
      return res.status(400).json({ success: false, message: `未达到起送金额 ¥${merchant.min_order_amount}` });
    }

    let discount = 0;
    let couponUsed = null;

    // 优惠券抵扣
    if (couponId) {
      const [[uc]] = await pool.query(
        'SELECT uc.*, mc.face_value, mc.min_order_amount FROM user_coupons uc JOIN merchant_coupons mc ON uc.coupon_id = mc.id WHERE uc.id = ? AND uc.user_id = ? AND uc.is_used = 0',
        [couponId, req.user.id]
      );
      if (uc && orderAmount >= parseFloat(uc.min_order_amount || 0)) {
        discount = parseFloat(uc.face_value);
        couponUsed = uc.id;
      }
    }

    let deliveryFee = parseFloat(merchant.delivery_fee || 3.00);
    try {
      if (merchant.latitude && merchant.longitude && addr.latitude && addr.longitude) {
        const feeResult = await mapService.calcDeliveryFee(
          parseFloat(merchant.longitude), parseFloat(merchant.latitude),
          parseFloat(addr.longitude), parseFloat(addr.latitude)
        );
        if (feeResult && feeResult.fee !== undefined) {
          deliveryFee = feeResult.fee;
        }
      }
    } catch (feeErr) {
      console.warn('[DeliveryFee] 动态计算失败（checkout），使用商家默认值:', feeErr.message);
    }
    const actualAmount = Math.max(0, orderAmount + deliveryFee - discount);
    const commission = orderAmount * (parseFloat(merchant.commission_rate || 15) / 100);

    const orderNo = generateOrderNo();
    const pickupCode = Math.random().toString(36).substring(2, 6).toUpperCase();

    const [result] = await pool.query(
      `INSERT INTO merchant_orders
         (order_no, user_id, merchant_id, order_amount, commission, delivery_fee, discount, actual_amount,
          items, delivery_address, delivery_name, delivery_phone, pickup_code, remark,
          delivery_type, scheduled_at, payment_method, cutlery)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderNo, req.user.id, merchantId, orderAmount, commission, deliveryFee, discount, actualAmount,
       JSON.stringify(orderItems), addr.address, addr.name, addr.phone, pickupCode, remark || null,
       deliveryType, scheduledAt || null, paymentMethod, cutlery ? 1 : 0]
    );

    // 标记优惠券已使用
    if (couponUsed) {
      await pool.query('UPDATE user_coupons SET status = \'used\', used_at = NOW(), used_order_id = ? WHERE id = ?', [result.insertId, couponUsed]);
    }

    // 清空购物车
    await pool.query('DELETE FROM carts WHERE user_id = ? AND merchant_id = ?', [req.user.id, merchantId]);

    // 更新商家统计
    await pool.query('UPDATE merchants SET total_orders = total_orders + 1, today_revenue = today_revenue + ? WHERE id = ?', [actualAmount, merchantId]);

    res.json({
      success: true, message: '订单提交成功',
      data: { orderId: result.insertId, orderNo, pickupCode, actualAmount }
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 再次下单
// POST /api/user/orders/:id/reorder
router.post('/orders/:id/reorder', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [[order]] = await pool.query(
      'SELECT merchant_id, items FROM merchant_orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' });

    const items = order.items ? JSON.parse(order.items) : [];

    // 将商品加入购物车
    for (const item of items) {
      const [existing] = await pool.query(
        'SELECT id FROM carts WHERE user_id = ? AND menu_item_id = ?',
        [req.user.id, item.id]
      );
      if (existing.length > 0) {
        await pool.query('UPDATE carts SET quantity = quantity + ? WHERE id = ?', [item.quantity, existing[0].id]);
      } else {
        await pool.query(
          'INSERT INTO carts (user_id, merchant_id, menu_item_id, name, price, quantity) VALUES (?,?,?,?,?,?)',
          [req.user.id, order.merchant_id, item.id, item.name, item.price, item.quantity]
        );
      }
    }

    res.json({ success: true, message: '已加入购物车，可前往结算', merchantId: order.merchant_id });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 5. 订单扩展（评价 + 退款申请）
// ============================================================

// 提交订单评价
// POST /api/user/orders/:id/review
router.post('/orders/:id/review', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const {
      rating, comment, images,
      tasteRating, packagingRating, deliveryRating,
      riderRating, riderComment
    } = req.body;

    const [[order]] = await pool.query(
      'SELECT id, merchant_id, rider_id, status FROM merchant_orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' });
    if (order.status !== 'completed') return res.status(400).json({ success: false, message: '订单未完成，无法评价' });

    // 检查是否已评价
    const [existing] = await pool.query('SELECT id FROM merchant_reviews WHERE order_id = ?', [req.params.id]);
    if (existing.length > 0) return res.status(400).json({ success: false, message: '该订单已评价' });

    // 商家评价
    await pool.query(
      `INSERT INTO merchant_reviews
         (order_id, merchant_id, user_id, rating, content)
       VALUES (?,?,?,?,?)`,
      [req.params.id, order.merchant_id, req.user.id, rating || 5, comment || null]
    );

    // 如果有图片，存入 review_images 表
    if (images && Array.isArray(images) && images.length > 0) {
      try {
        const [[review]] = await pool.query(
          'SELECT id FROM merchant_reviews WHERE order_id = ? ORDER BY id DESC LIMIT 1',
          [req.params.id]
        );
        if (review) {
          for (let i = 0; i < images.length; i++) {
            await pool.query(
              'INSERT INTO review_images (review_id, image_url, sort_order) VALUES (?,?,?)',
              [review.id, images[i], i]
            );
          }
        }
      } catch (e) { /* review_images 表可能不存在 */ }
    }

    // 更新商家评分
    await pool.query(
      'UPDATE merchants SET rating = (SELECT AVG(rating) FROM merchant_reviews WHERE merchant_id = ?) WHERE id = ?',
      [order.merchant_id, order.merchant_id]
    );

    // 骑手评价
    if (order.rider_id && riderRating) {
      await pool.query(
        'INSERT INTO rider_reviews (order_id, rider_id, user_id, rating, content) VALUES (?,?,?,?,?)',
        [req.params.id, order.rider_id, req.user.id, riderRating, riderComment || null]
      );
      await pool.query(
        'UPDATE riders SET rating = (SELECT AVG(rating) FROM rider_reviews WHERE rider_id = ?) WHERE id = ?',
        [order.rider_id, order.rider_id]
      );
    }

    // 积分奖励
    await pool.query('UPDATE users SET points = points + 5 WHERE id = ?', [req.user.id]);

    // 标记订单已评价
    await pool.query('UPDATE merchant_orders SET is_reviewed = 1 WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: '评价提交成功，获得5积分' });
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 申请退款/售后
// POST /api/user/orders/:id/refund
router.post('/orders/:id/refund', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { reason, type = 'full', amount, evidence } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: '请填写退款原因' });

    const [[order]] = await pool.query(
      'SELECT id, actual_amount, merchant_id, status FROM merchant_orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' });

    const [existing] = await pool.query(
      'SELECT id FROM merchant_refunds WHERE order_id = ? AND status = "pending"',
      [req.params.id]
    );
    if (existing.length > 0) return res.status(400).json({ success: false, message: '退款申请处理中，请勿重复提交' });

    const refundAmount = type === 'partial' ? amount : order.actual_amount;

    await pool.query(
      'INSERT INTO merchant_refunds (order_id, merchant_id, refund_amount, reason, type, evidence, requested_by) VALUES (?,?,?,?,?,?,?)',
      [req.params.id, order.merchant_id, refundAmount, reason, type, evidence ? JSON.stringify(evidence) : null, 'user']
    );
    await pool.query('UPDATE merchant_orders SET has_refund = 1 WHERE id = ?', [req.params.id]);

    res.json({ success: true, message: '退款申请已提交，预计1-3个工作日处理' });
  } catch (error) {
    console.error('User refund error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取退款列表
// GET /api/user/refunds
router.get('/refunds', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { status, page = 1, pageSize = 10 } = req.query;
    const safePageSize = Math.min(parseInt(pageSize) || 10, 100);
    const offset = (parseInt(page) - 1) * safePageSize;

    let sql = `SELECT r.*, mo.order_no, m.name as merchant_name
      FROM merchant_refunds r
      JOIN merchant_orders mo ON r.order_id = mo.id
      JOIN merchants m ON r.merchant_id = m.id
      WHERE mo.user_id = ?`;
    const params = [req.user.id];

    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(safePageSize, offset);

    const [refunds] = await pool.query(sql, params);

    res.json({
      success: true,
      data: refunds.map(r => ({
        id: r.id,
        orderId: r.order_id,
        orderNo: r.order_no,
        merchantName: r.merchant_name,
        refundAmount: r.refund_amount,
        reason: r.reason,
        type: r.type,
        status: r.status,
        createdAt: r.created_at,
        processedAt: r.processed_at
      }))
    });
  } catch (error) {
    console.error('Get user refunds error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取订单状态
// GET /api/user/orders/:id/status
router.get('/orders/:id/status', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const [[order]] = await pool.query(
      'SELECT id, status, accepted_at, ready_at, delivered_at, created_at FROM merchant_orders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!order) return res.status(404).json({ success: false, message: '订单不存在' });

    // 计算预计送达时间
    let estimatedDelivery = null;
    if (order.accepted_at && !order.delivered_at) {
      const acceptedTime = new Date(order.accepted_at);
      estimatedDelivery = new Date(acceptedTime.getTime() + 30 * 60000); // 30分钟后
    }

    res.json({
      success: true,
      data: {
        orderId: order.id,
        status: order.status,
        timeline: {
          createdAt: order.created_at,
          acceptedAt: order.accepted_at,
          readyAt: order.ready_at,
          deliveredAt: order.delivered_at
        },
        estimatedDelivery
      }
    });
  } catch (error) {
    console.error('Get order status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户确认收货
// PUT /api/user/orders/:id/status
router.put('/orders/:id/status', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;

    const [orders] = await pool.query(
      'SELECT * FROM merchant_orders WHERE id = ? AND user_id = ?',
      [orderId, req.user.id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[0];

    // 允许的状态转换
    if (status === 'completed') {
      if (order.status === 'completed') {
        return res.json({ success: true, message: '订单已完成' });
      }
      if (!['ready', 'accepted', 'delivering'].includes(order.status)) {
        return res.status(400).json({ success: false, message: `订单状态${order.status}不允许确认收货，支持: ready/accepted/delivering` });
      }
      await pool.query(
        "UPDATE merchant_orders SET status = 'completed', delivered_at = NOW() WHERE id = ?",
        [orderId]
      );
    } else {
      return res.status(400).json({ success: false, message: '不支持的状态更新' });
    }

    res.json({ success: true, message: '订单状态更新成功' });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 6. 会员与积分
// ============================================================

// 获取我的优惠券列表
// GET /api/user/coupons?status=unused|used|expired
router.get('/coupons', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { status = 'unused' } = req.query;

    let condition = '';
    if (status === 'unused') condition = 'uc.is_used = 0 AND (uc.expires_at IS NULL OR uc.expires_at >= NOW())';
    else if (status === 'used') condition = 'uc.is_used = 1';
    else if (status === 'expired') condition = 'uc.is_used = 0 AND uc.expires_at < NOW()';

    const [coupons] = await pool.query(
      `SELECT uc.id, uc.coupon_id, uc.is_used, uc.used_at, uc.expires_at,
              mc.name, mc.face_value, mc.min_order_amount, mc.type
       FROM user_coupons uc
       LEFT JOIN merchant_coupons mc ON uc.coupon_id = mc.id
       WHERE uc.user_id = ? AND ${condition}
       ORDER BY uc.created_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: coupons.map(c => ({
        id: c.id,
        couponId: c.coupon_id,
        name: c.name,
        faceValue: c.face_value,
        minOrderAmount: c.min_order_amount,
        type: c.type,
        merchantId: null,
        merchantName: null,
        isUsed: !!c.is_used,
        usedAt: c.used_at,
        expireAt: c.expires_at
      }))
    });
  } catch (error) {
    console.error('Get user coupons error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取可用优惠券（根据订单金额筛选）
// GET /api/user/coupons/available?amount=50
router.get('/coupons/available', authMiddleware, userMiddleware, async (req, res) => {
  try {
    let { amount = 0 } = req.query;
    
    // 输入验证
    amount = parseFloat(amount);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ success: false, message: '订单金额格式错误' });
    }

    const [coupons] = await pool.query(
      `SELECT uc.id, uc.coupon_id,
              mc.name, mc.face_value, mc.min_order_amount, mc.type,
              uc.expires_at
       FROM user_coupons uc
       LEFT JOIN merchant_coupons mc ON uc.coupon_id = mc.id
       WHERE uc.user_id = ? AND uc.is_used = 0
         AND (uc.expires_at IS NULL OR uc.expires_at >= NOW())
         AND mc.min_order_amount <= ?
       ORDER BY mc.face_value DESC`,
      [req.user.id, parseFloat(amount)]
    );

    res.json({
      success: true,
      data: coupons.map(c => ({
        id: c.id,
        couponId: c.coupon_id,
        name: c.name,
        discountValue: c.face_value,
        thresholdAmount: c.min_order_amount,
        type: c.type,
        merchantName: null,
        expireAt: c.expires_at
      }))
    });
  } catch (error) {
    console.error('Get available coupons error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 积分明细
// GET /api/user/points/records?page=1
router.get('/points/records', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const safePageSize = Math.min(parseInt(pageSize) || 20, 100);
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    const [records] = await pool.query(
      'SELECT id, type, points, description, created_at FROM user_points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, safePageSize, offset]
    );
    const [[user]] = await pool.query('SELECT points FROM users WHERE id = ?', [req.user.id]);

    res.json({
      success: true,
      data: {
        totalPoints: user.points || 0,
        list: records.map(r => ({
          id: r.id,
          type: r.type, // earn|spend
          points: r.points,
          description: r.description,
          createdAt: r.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get points records error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 签到 [P0修复] 使用事务保证积分一致性
router.post('/checkin', authMiddleware, userMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const today = new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();
    try {
      // 使用 INSERT IGNORE 防重复签到（需确保有唯一索引 (user_id, checkin_date)）
      const [result] = await conn.query(
        'INSERT IGNORE INTO user_checkins (user_id, checkin_date, points) VALUES (?, ?, 2)',
        [req.user.id, today]
      );
      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: '今日已签到' });
      }

      // [P0修复] 原子增加积分，防止并发超发
      const [updateResult] = await conn.query(
        'UPDATE users SET points = points + 2 WHERE id = ?',
        [req.user.id]
      );
      
      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: '用户不存在' });
      }

      await conn.query(
        'INSERT INTO user_points_records (user_id, type, points, description) VALUES (?, "earn", 2, "每日签到")',
        [req.user.id]
      );

      await conn.commit();
      res.json({ success: true, message: '签到成功，获得2积分' });
    } catch (innerErr) {
      await conn.rollback();
      throw innerErr;
    }
  } catch (error) {
    console.error('Checkin error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 会员开通信息
// GET /api/user/membership/plans
router.get('/membership/plans', async (req, res) => {
  try {
    res.json({
      success: true,
      data: [
        { id: 1, name: '月卡', durationDays: 30, price: 9.90, originalPrice: 29.90,
          benefits: ['免配送费', '每月专属优惠券x5', '积分双倍', '优先配送'] },
        { id: 2, name: '季卡', durationDays: 90, price: 24.90, originalPrice: 89.70,
          benefits: ['免配送费', '每月专属优惠券x8', '积分双倍', '优先配送', '专属客服'] },
        { id: 3, name: '年卡', durationDays: 365, price: 88.00, originalPrice: 358.80,
          benefits: ['免配送费', '每月专属优惠券x12', '积分三倍', '优先配送', '专属客服', '生日特权'] }
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 开通会员
// POST /api/user/membership/subscribe
router.post('/membership/subscribe', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { planId, paymentMethod } = req.body;

    const plans = { 1: { days: 30, price: 9.90, name: '月卡' }, 2: { days: 90, price: 24.90, name: '季卡' }, 3: { days: 365, price: 88.00, name: '年卡' } };
    const plan = plans[planId];
    if (!plan) return res.status(400).json({ success: false, message: '无效的套餐' });

    const [[user]] = await pool.query('SELECT balance, member_expire_at FROM users WHERE id = ?', [req.user.id]);

    if (paymentMethod === 'balance') {
      // 原子操作：只有余额充足时才扣费
      const [balanceResult] = await pool.query(
        'UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?',
        [plan.price, req.user.id, plan.price]
      );
      if (balanceResult.affectedRows === 0) {
        return res.status(400).json({ success: false, message: '余额不足' });
      }
    }

    const now = new Date();
    const currentExpire = user.member_expire_at && new Date(user.member_expire_at) > now
      ? new Date(user.member_expire_at)
      : now;
    const newExpire = new Date(currentExpire.getTime() + plan.days * 86400000);

    await pool.query(
      'UPDATE users SET member_level = 1, member_expire_at = ? WHERE id = ?',
      [newExpire.toISOString().slice(0, 19).replace('T', ' '), req.user.id]
    );

    await pool.query(
      'INSERT INTO user_membership_records (user_id, plan_name, price, duration_days, expire_at) VALUES (?,?,?,?,?)',
      [req.user.id, plan.name, plan.price, plan.days, newExpire]
    );

    res.json({ success: true, message: `${plan.name}开通成功，有效期至 ${newExpire.toISOString().slice(0, 10)}` });
  } catch (error) {
    console.error('Subscribe membership error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 消息中心
// ============================================================

// 获取消息列表
// GET /api/user/messages?page=1
router.get('/messages', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const safePageSize = Math.min(parseInt(pageSize) || 20, 100);
    const safePage = Math.max(1, parseInt(page) || 1);
    const offset = (safePage - 1) * safePageSize;

    const [messages] = await pool.query(
      'SELECT id, type, title, content, is_read, created_at FROM user_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, safePageSize, offset]
    );
    const [[{ unread }]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM user_messages WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: messages.map(m => ({
          id: m.id,
          type: m.type,
          title: m.title,
          content: m.content,
          isRead: !!m.is_read,
          createdAt: m.created_at
        })),
        unreadCount: parseInt(unread)
      }
    });
  } catch (error) {
    console.error('Get user messages error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 标记消息已读
// PUT /api/user/messages/read
router.put('/messages/read', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { ids } = req.body; // ids 为数组，传 ['all'] 全部已读
    if (ids && ids.includes('all')) {
      await pool.query('UPDATE user_messages SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    } else if (ids && ids.length > 0) {
      await pool.query('UPDATE user_messages SET is_read = 1 WHERE id IN (?) AND user_id = ?', [ids, req.user.id]);
    }
    res.json({ success: true, message: '已标记已读' });
  } catch (error) {
    console.error('Mark messages read error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 积分记录（别名 /points，实际功能同 /points/records）
// GET /api/user/points
router.get('/points', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const [records] = await pool.query(
      'SELECT id, type, points, description, created_at FROM user_points_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, pageSize, offset]
    );
    const [[user]] = await pool.query('SELECT points FROM users WHERE id = ?', [req.user.id]);

    res.json({
      success: true,
      data: {
        totalPoints: user.points || 0,
        list: records.map(r => ({
          id: r.id,
          type: r.type, // earn|spend
          points: r.points,
          description: r.description,
          createdAt: r.created_at
        }))
      }
    });
  } catch (error) {
    console.error('Get points error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 收藏列表（按实际表结构：user_favorites(id, user_id, merchant_id, created_at)，仅支持收藏商家）
// GET /api/user/favorites
router.get('/favorites', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    const [favorites] = await pool.query(
      `SELECT f.id, f.merchant_id, f.created_at,
              m.id as merchant_id_full, m.name as merchant_name, m.avatar as merchant_avatar, m.rating, m.address, m.category
       FROM user_favorites f
       LEFT JOIN merchants m ON f.merchant_id = m.id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, pageSize, offset]
    );

    const [[total]] = await pool.query(
      'SELECT COUNT(*) as total FROM user_favorites WHERE user_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        list: favorites.map(f => ({
          id: f.id,
          type: 'merchant',
          favorite_id: f.merchant_id,
          name: f.merchant_name,
          avatar: f.merchant_avatar,
          rating: f.rating,
          address: f.address,
          category: f.category,
          createdAt: f.created_at
        })),
        total: total.total
      }
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 提交意见反馈
// POST /api/user/feedback
router.post('/feedback', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const { type, content, images, phone } = req.body;
    if (!content) return res.status(400).json({ success: false, message: '反馈内容不能为空' });

    await pool.query(
      'INSERT INTO user_feedback (user_id, type, content, images, contact) VALUES (?,?,?,?,?)',
      [req.user.id, type || 'suggestion', content, images ? JSON.stringify(images) : null, phone || null]
    );
    res.json({ success: true, message: '反馈已提交，感谢您的宝贵意见' });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 前端兼容层 - 补充缺失路由
// ============================================================

// GET /categories → 用户端分类列表
router.get('/categories', async (req, res) => {
  try {
    const [cats] = await pool.query(
      'SELECT id, name, icon, sort_order FROM categories WHERE status = "active" ORDER BY sort_order ASC, id ASC'
    );
    res.json({
      success: true,
      data: cats.map(c => ({
        id: c.id, name: c.name, icon: c.icon, sortOrder: c.sort_order
      }))
    });
  } catch (error) {
    // categories 表可能不存在
    if (error.message.includes('doesn\'t exist')) {
      return res.json({ success: true, data: [] });
    }
    console.error('Get categories error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /notifications → 用户通知列表
router.get('/notifications', authMiddleware, userMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const [notifications] = await pool.query(
      `SELECT id, title, content, type, is_read, created_at FROM user_notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    res.json({
      success: true,
      data: notifications.map(n => ({
        id: n.id, title: n.title, content: n.content, type: n.type,
        isRead: !!n.is_read, createdAt: n.created_at
      })),
      pagination: { page, limit }
    });
  } catch (error) {
    if (error.message.includes('doesn\'t exist')) {
      return res.json({ success: true, data: [], pagination: { page: parseInt(req.query.page) || 1, limit: 20 } });
    }
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;

