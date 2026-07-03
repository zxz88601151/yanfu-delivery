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

// ============================================================
// 1. 获取商家列表（公共端点）
// GET /api/merchants
// ============================================================
router.get('/merchants', async (req, res) => {
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

    const [merchants] = await pool.query(sql, params);

    res.json({
      success: true,
      data: {
        list: merchants.map(m => ({
          id: m.id,
          name: m.name,
          avatar: m.avatar,
          address: m.address,
          phone: m.phone,
          category: m.category,
          rating: m.rating,
          totalOrders: m.total_orders,
          deliveryRange: m.delivery_range,
          minOrderAmount: m.min_order_amount,
          isOpen: m.is_open === 1
        })),
        total: merchants.length,
        page: parseInt(page),
        pageSize: safeLimit
      }
    });
  } catch (error) {
    console.error('Get merchants error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 2. 获取商品列表（公共端点）
// GET /api/products
// ============================================================
// 根据数据库 merchant_menu 表结构: id, merchant_id, name, description, image, price, is_available, category, sales_count, created_at
router.get('/products', async (req, res) => {
  try {
    const { merchantId, category, keyword, page = 1, limit = 20 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const offset = (parseInt(page) - 1) * safeLimit;

    let sql = 'SELECT id, merchant_id, name, description, image, price, category, is_available, sales_count FROM merchant_menu WHERE is_available = 1';
    const params = [];

    if (merchantId) {
      sql += ' AND merchant_id = ?';
      params.push(merchantId);
    }

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (keyword) {
      const safeKeyword = keyword.replace(/[%_\\]/g, '\\$&');
      sql += ' AND name LIKE ?';
      params.push(`%${safeKeyword}%`);
    }

    sql += ' ORDER BY sales_count DESC, price ASC LIMIT ? OFFSET ?';
    params.push(safeLimit, offset);

    const [products] = await pool.query(sql, params);

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM merchant_menu WHERE is_available = 1 ' +
      (merchantId ? 'AND merchant_id = ? ' : '') +
      (category ? 'AND category = ? ' : '') +
      (keyword ? 'AND name LIKE ?' : ''),
      [merchantId, category, keyword].filter(Boolean)
    );

    res.json({
      success: true,
      data: {
        list: products.map(p => ({
          id: p.id,
          merchantId: p.merchant_id,
          name: p.name,
          description: p.description,
          image: p.image,
          price: p.price,
          category: p.category,
          isAvailable: p.is_available === 1,
          soldCount: p.sales_count
        })),
        total: total.total,
        page: parseInt(page),
        pageSize: safeLimit
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ============================================================
// 3. 获取城市列表（公共端点）
// GET /api/cities
// ============================================================
// cities 表可能不存在,用硬编码 + 商家城市去退让处理
router.get('/cities', async (req, res) => {
  try {
    let cities = [];
    try {
      const [rows] = await pool.query(
        'SELECT id, name, province, latitude, longitude, is_active FROM cities WHERE is_active = 1 ORDER BY is_hot DESC, name ASC'
      );
      cities = rows.map(c => ({
        id: c.id,
        name: c.name,
        province: c.province,
        latitude: c.latitude,
        longitude: c.longitude,
        isHot: c.is_hot === 1
      }));
    } catch (e) {
      // cities 表不存在,从商家表取城市
      const [merchants] = await pool.query('SELECT DISTINCT city FROM merchants WHERE city IS NOT NULL AND city != ? ORDER BY city LIMIT 50', [null]);
      cities = merchants
        .filter(m => m.city)
        .map((m, i) => ({ id: i + 1, name: m.city, province: '', latitude: null, longitude: null, isHot: false }));
    }

    res.json({
      success: true,
      data: cities
    });
  } catch (error) {
    console.error('Get cities error:', error);
    // 最终兜底: 返回空列表
    res.json({ success: true, data: [] });
  }
});

// ============================================================
// 4. 获取系统公告（公共端点）
// GET /api/system/announcements
// ============================================================
router.get('/system/announcements', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const offset = (page - 1) * pageSize;

    let announcements = [];
    let total = 0;

    try {
      const [rows] = await pool.query(
        'SELECT id, title, content, ann_type, created_at, updated_at FROM system_announcements ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [pageSize, offset]
      );
      announcements = rows;
      [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM system_announcements');
    } catch (e) {
      // system_announcements 表不存在,返回空列表
      announcements = [];
      total = 0;
    }

    res.json({
      success: true,
      data: {
        list: announcements.map(a => ({
          id: a.id,
          title: a.title,
          content: a.content,
          type: a.ann_type,
          createdAt: a.created_at,
          updatedAt: a.updated_at
        })),
        total,
        page,
        pageSize
      }
    });
  } catch (error) {
    console.error('Get system announcements error:', error);
    res.json({
      success: true,
      data: { list: [], total: 0, page: parseInt(req.query.page) || 1, pageSize: Math.min(parseInt(req.query.pageSize) || 20, 100) }
    });
  }
});

// ============================================================
// 5. 获取省市区数据（公共端点）
// GET /api/regions
// ============================================================
const path = require('path');
const fs = require('fs');

let _regionsCache = null;
router.get('/regions', (req, res) => {
  try {
    if (!_regionsCache) {
      const filePath = path.join(__dirname, '..', 'data', 'regions.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      _regionsCache = JSON.parse(raw);
    }
    res.json({ success: true, data: _regionsCache });
  } catch (error) {
    console.error('Get regions error:', error);
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
