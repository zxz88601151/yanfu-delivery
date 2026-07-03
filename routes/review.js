// 评价系统路由
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// ========== 用户评价 ==========

// 提交评价
router.post('/', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { orderId, orderType, merchantId, riderId, rating, content, tags, isAnonymous, imageUrls } = req.body;
    const userId = req.user.id;

    // 参数校验
    if (!orderId || !orderType || !rating) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: '评分必须在1-5之间' });
    }

    await conn.beginTransaction();

    // 检查是否已评价
    const [existing] = await conn.query(
      'SELECT id FROM reviews WHERE user_id = ? AND order_id = ? AND order_type = ?',
      [userId, orderId, orderType]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: '该订单已评价' });
    }

    // 插入评价
    const [result] = await conn.query(
      `INSERT INTO reviews (user_id, merchant_id, rider_id, order_id, order_type, rating, content, tags, is_anonymous)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, merchantId || null, riderId || null, orderId, orderType, rating, content || null, JSON.stringify(tags || []), isAnonymous ? 1 : 0]
    );

    const reviewId = result.insertId;

    // 插入评价图片
    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      const imageValues = imageUrls.map((url, idx) => [reviewId, url, idx]);
      await conn.query(
        'INSERT INTO review_images (review_id, image_url, sort_order) VALUES ?',
        [imageValues]
      );
    }

    // 更新商家评分
    if (merchantId) {
      await conn.query(
        `UPDATE merchants SET rating = (
          SELECT ROUND(AVG(rating), 1) FROM reviews WHERE merchant_id = ? AND status = 'active'
        ) WHERE id = ?`,
        [merchantId, merchantId]
      );
    }

    // 更新骑手评分
    if (riderId) {
      await conn.query(
        `UPDATE riders SET rating = (
          SELECT ROUND(AVG(rating), 1) FROM reviews WHERE rider_id = ? AND status = 'active'
        ) WHERE id = ?`,
        [riderId, riderId]
      );
    }

    await conn.commit();

    // 获取评价详情
    const [review] = await conn.query(
      `SELECT r.*, u.name as user_name, u.avatar as user_avatar
       FROM reviews r LEFT JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`,
      [reviewId]
    );

    const [images] = await conn.query(
      'SELECT image_url FROM review_images WHERE review_id = ? ORDER BY sort_order',
      [reviewId]
    );

    res.json({
      success: true,
      message: '评价成功',
      data: {
        ...(review[0] || {}),
        tags: (() => { try { return JSON.parse((review[0] || {}).tags || '[]'); } catch { return []; } })(),
        images: images.map(i => i.image_url),
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('Submit review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
});

// 获取商家评价列表
router.get('/merchant/:merchantId', async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { page = 1, limit = 10, rating } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = `
      SELECT r.*, u.name as user_name, u.avatar as user_avatar,
        (SELECT GROUP_CONCAT(ri.image_url) FROM review_images ri WHERE ri.review_id = r.id) as image_urls
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.merchant_id = ? AND (r.status = 'active' OR r.status IS NULL)
    `;
    const params = [merchantId];

    if (rating) {
      sql += ' AND r.rating = ?';
      params.push(parseInt(rating));
    }

    sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [reviews] = await pool.query(sql, params);

    // 评分统计
    const [stats] = await pool.query(
      `SELECT
        COUNT(*) as total,
        ROUND(AVG(rating), 1) as avg_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
      FROM reviews WHERE merchant_id = ? AND status = 'active'`,
      [merchantId]
    );

    const processedReviews = reviews.map(r => ({
      ...r,
      tags: JSON.parse(r.tags || '[]'),
      images: r.image_urls ? r.image_urls.split(',') : [],
      image_urls: undefined,
      user_name: r.is_anonymous ? '匿名用户' : r.user_name,
      user_avatar: r.is_anonymous ? null : r.user_avatar,
    }));

    res.json({
      success: true,
      data: {
        reviews: processedReviews,
        stats: stats[0],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: stats[0].total,
        }
      }
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家回复评价
router.post('/:reviewId/reply', authMiddleware, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { reply } = req.body;

    if (!reply || reply.trim().length === 0) {
      return res.status(400).json({ success: false, message: '回复内容不能为空' });
    }

    const [result] = await pool.query(
      'UPDATE reviews SET merchant_reply = ?, merchant_replied_at = NOW() WHERE id = ? AND merchant_id = ?',
      [reply.trim(), reviewId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '评价不存在或无权操作' });
    }

    res.json({ success: true, message: '回复成功' });
  } catch (error) {
    console.error('Reply review error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
