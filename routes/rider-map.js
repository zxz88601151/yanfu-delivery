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
const jwt = require('jsonwebtoken');

// 认证中间件 - 验证JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: '未提供认证令牌' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: '令牌无效或已过期' });
    }
    req.user = user;
    next();
  });
};

/**
 * POST /api/rider-map/markers
 * 上传标记点
 */
router.post('/markers', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      type,
      description,
      notes,
      latitude,
      longitude,
      address,
      photos,
      rider_id
    } = req.body;

    // 验证必填字段
    if (!name || !type || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段：name, type, latitude, longitude'
      });
    }

    // 插入标记点
    const [result] = await pool.query(`
      INSERT INTO rider_map_markers 
      (rider_id, name, type, description, notes, latitude, longitude, address, photos, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      rider_id || req.user.id,
      name,
      type,
      description || null,
      notes || null,
      latitude,
      longitude,
      address || null,
      photos ? JSON.stringify(photos) : null
    ]);

    res.json({
      success: true,
      message: '标记点上传成功',
      data: {
        id: result.insertId,
        name,
        type,
        latitude,
        longitude
      }
    });

  } catch (error) {
    console.error('上传标记点失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * GET /api/rider-map/markers
 * 获取标记点列表
 * 查询参数:
 *   - type: 标记类型 (gate, parking, entrance, other)
 *   - lat, lng: 中心坐标
 *   - radius: 搜索半径(公里), 默认5km
 *   - limit: 返回数量限制, 默认50
 */
router.get('/markers', authenticateToken, async (req, res) => {
  try {
    const {
      type,
      lat,
      lng,
      radius = 5,
      limit = 50
    } = req.query;

    let sql = `
      SELECT 
        id, rider_id, name, type, description, notes,
        latitude, longitude, address, photos,
        created_at
      FROM rider_map_markers
      WHERE 1=1
    `;
    const params = [];

    // 按类型筛选
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    // 按距离筛选 (如果提供了坐标)
    if (lat && lng) {
      sql += `
        AND (
          6371 * acos(
            cos(radians(?)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(latitude))
          )
        ) <= ?
      `;
      params.push(lat, lng, lat, radius);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const [markers] = await pool.query(sql, params);

    // 解析photos JSON
    const formattedMarkers = markers.map(marker => ({
      ...marker,
      photos: marker.photos ? JSON.parse(marker.photos) : []
    }));

    res.json({
      success: true,
      data: formattedMarkers,
      count: formattedMarkers.length
    });

  } catch (error) {
    console.error('获取标记点失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * POST /api/rider-map/routes
 * 上传学习路线
 */
router.post('/routes', authenticateToken, async (req, res) => {
  try {
    const {
      name,
      description,
      start_time,
      end_time,
      duration_seconds,
      total_distance,
      avg_speed,
      start_address,
      end_address,
      points,
      rider_id
    } = req.body;

    // 验证必填字段
    if (!name || !start_time || !end_time || !points || !Array.isArray(points) || points.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少必填字段：name, start_time, end_time, points[]'
      });
    }

    // 开始事务
    await pool.query('START TRANSACTION');

    try {
      // 插入路线
      const [routeResult] = await pool.query(`
        INSERT INTO rider_map_routes 
        (rider_id, name, description, start_time, end_time, duration_seconds, 
         total_distance, avg_speed, start_address, end_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        rider_id || req.user.id,
        name,
        description || null,
        new Date(start_time),
        new Date(end_time),
        duration_seconds || null,
        total_distance || null,
        avg_speed || null,
        start_address || null,
        end_address || null
      ]);

      const routeId = routeResult.insertId;

      // 插入路线点
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        await pool.query(`
          INSERT INTO rider_map_route_points 
          (route_id, latitude, longitude, timestamp, speed, accuracy, altitude, bearing, sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          routeId,
          point.latitude,
          point.longitude,
          new Date(point.timestamp),
          point.speed || null,
          point.accuracy || null,
          point.altitude || null,
          point.bearing || null,
          i
        ]);
      }

      await pool.query('COMMIT');

      res.json({
        success: true,
        message: '路线上传成功',
        data: {
          id: routeId,
          name,
          points_count: points.length
        }
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('上传路线失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * GET /api/rider-map/routes
 * 获取路线列表
 * 查询参数:
 *   - rider_id: 骑手ID (可选, 不提供则获取所有)
 *   - limit: 返回数量限制, 默认20
 */
router.get('/routes', authenticateToken, async (req, res) => {
  try {
    const {
      rider_id,
      limit = 20
    } = req.query;

    let sql = `
      SELECT 
        id, rider_id, name, description,
        start_time, end_time, duration_seconds,
        total_distance, avg_speed, start_address, end_address,
        created_at
      FROM rider_map_routes
      WHERE 1=1
    `;
    const params = [];

    // 按骑手筛选
    if (rider_id) {
      sql += ' AND rider_id = ?';
      params.push(rider_id);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const [routes] = await pool.query(sql, params);

    res.json({
      success: true,
      data: routes,
      count: routes.length
    });

  } catch (error) {
    console.error('获取路线失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * GET /api/rider-map/routes/:id
 * 获取路线详情(包括所有路线点)
 */
router.get('/routes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 获取路线基本信息
    const [routes] = await pool.query(`
      SELECT * FROM rider_map_routes WHERE id = ?
    `, [id]);

    if (routes.length === 0) {
      return res.status(404).json({
        success: false,
        message: '路线不存在'
      });
    }

    const route = routes[0];

    // 获取路线点
    const [points] = await pool.query(`
      SELECT * FROM rider_map_route_points 
      WHERE route_id = ? 
      ORDER BY sequence ASC
    `, [id]);

    res.json({
      success: true,
      data: {
        ...route,
        points
      }
    });

  } catch (error) {
    console.error('获取路线详情失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * DELETE /api/rider-map/markers/:id
 * 删除标记点
 */
router.delete('/markers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(`
      DELETE FROM rider_map_markers 
      WHERE id = ? AND rider_id = ?
    `, [id, req.user.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: '标记点不存在或无权限删除'
      });
    }

    res.json({
      success: true,
      message: '标记点删除成功'
    });

  } catch (error) {
    console.error('删除标记点失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

/**
 * DELETE /api/rider-map/routes/:id
 * 删除路线
 */
router.delete('/routes/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // 开始事务
    await pool.query('START TRANSACTION');

    try {
      // 删除路线点
      await pool.query(`DELETE FROM rider_map_route_points WHERE route_id = ?`, [id]);

      // 删除路线
      const [result] = await pool.query(`
        DELETE FROM rider_map_routes 
        WHERE id = ? AND rider_id = ?
      `, [id, req.user.id]);

      if (result.affectedRows === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: '路线不存在或无权限删除'
        });
      }

      await pool.query('COMMIT');

      res.json({
        success: true,
        message: '路线删除成功'
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('删除路线失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误',
      error: error.message
    });
  }
});

module.exports = router;
