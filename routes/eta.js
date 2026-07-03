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

/**
 * 盐阜配送 - 智能ETA系统路由
 * 配送时间预估、实时刷新、多阶段ETA
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

/**
 * POST /api/eta/calculate
 * 计算ETA（支持多阶段）
 */
router.post('/calculate', authMiddleware, async (req, res) => {
  try {
    const {
      order_no,
      merchant_order_id,
      rider_order_id,
      merchant_id,
      rider_id,
      distance_km,
      area_code,
      stage = 'create'
    } = req.body;

    // 1. 获取基础参数
    const params = await getETAParams({
      order_no,
      merchant_id,
      rider_id,
      distance_km,
      area_code
    });

    // 2. 计算各阶段时间
    const etaResult = await calculateETA(params, stage);

    // 3. 保存或更新ETA记录
    await saveETARecord({
      order_no,
      merchant_order_id,
      rider_order_id,
      ...etaResult,
      stage
    });

    res.json({
      success: true,
      data: {
        order_no,
        merchant_order_id,
        rider_order_id,
        eta_minutes: etaResult.total_minutes,
        eta_timestamp: etaResult.eta_timestamp,
        eta_display: formatETADisplay(etaResult.total_minutes),
        breakdown: etaResult.breakdown,
        params: etaResult.params,
        refresh_stage: stage,
        is_locked: etaResult.is_locked
      }
    });

  } catch (error) {
    console.error('ETA计算失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/eta/order/:orderNo
 * 获取订单ETA详情
 */
router.get('/order/:orderNo', authMiddleware, async (req, res) => {
  try {
    const { orderNo } = req.params;

    const [etas] = await pool.query(
      `SELECT * FROM eta_records 
       WHERE order_no = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [orderNo]
    );

    if (etas.length === 0) {
      return res.status(404).json({ success: false, message: 'ETA记录不存在' });
    }

    const eta = etas[0];

    res.json({
      success: true,
      data: {
        order_no: eta.order_no,
        eta_minutes: eta.eta_minutes,
        eta_timestamp: eta.eta_timestamp,
        confidence: eta.confidence,
        breakdown: JSON.parse(eta.breakdown || '{}'),
        refresh_stage: eta.refresh_stage,
        is_locked: eta.is_locked,
        created_at: eta.created_at,
        updated_at: eta.updated_at
      }
    });

  } catch (error) {
    console.error('获取ETA详情失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/eta/refresh
 * 刷新ETA（根据当前阶段）
 */
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const { order_no, current_stage } = req.body;

    // 1. 获取当前ETA记录
    const [etas] = await pool.query(
      'SELECT * FROM eta_records WHERE order_no = ? ORDER BY created_at DESC LIMIT 1',
      [order_no]
    );

    if (etas.length === 0) {
      return res.status(404).json({ success: false, message: 'ETA记录不存在' });
    }

    const currentETA = etas[0];

    // 2. 检查是否已锁定
    if (currentETA.is_locked) {
      return res.json({
        success: true,
        message: 'ETA已锁定，不再刷新',
        data: {
          order_no: order_no,
          eta_minutes: currentETA.eta_minutes,
          is_locked: true
        }
      });
    }

    // 3. 根据当前阶段重新计算
    const newETA = await calculateETA(
      JSON.parse(currentETA.params || '{}'),
      current_stage
    );

    // 4. 更新ETA记录
    await pool.query(
      `UPDATE eta_records 
       SET eta_minutes = ?, eta_timestamp = ?, 
           breakdown = ?, refresh_stage = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        newETA.total_minutes,
        newETA.eta_timestamp,
        JSON.stringify(newETA.breakdown),
        current_stage,
        currentETA.id
      ]
    );

    res.json({
      success: true,
      message: 'ETA已刷新',
      data: {
        order_no: order_no,
        previous_eta: currentETA.eta_minutes,
        new_eta: newETA.total_minutes,
        eta_timestamp: newETA.eta_timestamp,
        refresh_stage: current_stage
      }
    });

  } catch (error) {
    console.error('刷新ETA失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/eta/lock
 * 锁定ETA（配送中不再刷新）
 */
router.post('/lock', authMiddleware, async (req, res) => {
  try {
    const { order_no } = req.body;

    await pool.query(
      'UPDATE eta_records SET is_locked = 1, updated_at = NOW() WHERE order_no = ?',
      [order_no]
    );

    res.json({
      success: true,
      message: 'ETA已锁定'
    });

  } catch (error) {
    console.error('锁定ETA失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/eta/config
 * 获取ETA配置参数
 */
router.get('/config', authMiddleware, async (req, res) => {
  try {
    const [configs] = await pool.query('SELECT * FROM eta_config WHERE is_enabled = 1');

    const configMap = {};
    configs.forEach(c => {
      try {
        configMap[c.config_key] = JSON.parse(c.config_value);
      } catch {
        configMap[c.config_key] = c.config_value;
      }
    });

    res.json({
      success: true,
      data: configMap
    });

  } catch (error) {
    console.error('获取ETA配置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/eta/config/:key
 * 更新ETA配置
 */
router.put('/config/:key', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body;
    const { key } = req.params;

    await pool.query(
      'UPDATE eta_config SET config_value = ?, updated_at = NOW() WHERE config_key = ?',
      [JSON.stringify(value), key]
    );

    res.json({ success: true, message: '配置已更新' });

  } catch (error) {
    console.error('更新ETA配置失败:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取ETA计算参数
 */
async function getETAParams({ order_no, merchant_id, rider_id, distance_km, area_code }) {
  const params = {
    distance_km: distance_km || 0,
    order_time_hour: new Date().getHours() + new Date().getMinutes() / 60,
    weather: await getCurrentWeather(area_code),
    traffic: await getCurrentTraffic(area_code),
    rider_active_orders: 0,
    merchant_avg_prep_time: 15, // 默认15分钟
    route_overlap_rate: 0
  };

  // 获取骑手当前负载
  if (rider_id) {
    const [riderOrders] = await pool.query(
      `SELECT COUNT(*) as count FROM orders 
       WHERE rider_id = ? AND status IN ('assigned', 'picking', 'delivering')`,
      [rider_id]
    );
    params.rider_active_orders = riderOrders[0].count;
  }

  // 获取商家平均出餐时间
  if (merchant_id) {
    const [merchantStats] = await pool.query(
      `SELECT AVG(prep_time_actual) as avg_prep 
       FROM orders WHERE merchant_id = ? AND prep_time_actual IS NOT NULL`,
      [merchant_id]
    );
    if (merchantStats[0].avg_prep) {
      params.merchant_avg_prep_time = Math.round(merchantStats[0].avg_prep);
    }
  }

  return params;
}

/**
 * 计算ETA
 */
async function calculateETA(params, stage) {
  // 1. 基础时间（系统固定）
  const baseTime = 7;

  // 2. 距离时间（每公里3分钟）
  const distanceTime = params.distance_km * 3;

  // 3. 交通路况因子
  const trafficFactors = { smooth: 1.0, moderate: 1.2, congested: 1.5 };
  const trafficFactor = trafficFactors[params.traffic] || 1.0;

  // 4. 天气因子
  const weatherFactors = { sunny: 1.0, cloudy: 1.0, rain: 1.3, snow: 1.8 };
  const weatherFactor = weatherFactors[params.weather] || 1.0;

  // 5. 骑手负载时间（每单+2分钟）
  const riderLoadTime = params.rider_active_orders * 2;

  // 6. 商家出餐时间
  const merchantPrepTime = params.merchant_avg_prep_time;

  // 7. 顺路抵扣（路线重叠率）
  const overlapDiscount = Math.floor(params.route_overlap_rate * 5);

  // 计算总时间
  let totalMinutes = Math.round(
    (baseTime + distanceTime) * trafficFactor * weatherFactor +
    riderLoadTime + merchantPrepTime - overlapDiscount
  );

  // 确保最少15分钟
  totalMinutes = Math.max(15, totalMinutes);

  // 计算送达时间戳
  const etaTimestamp = new Date(Date.now() + totalMinutes * 60000).toISOString();

  // 根据阶段锁定某些时间
  const isLocked = ['delivering', 'completed'].includes(stage);

  return {
    total_minutes: totalMinutes,
    eta_timestamp: etaTimestamp,
    is_locked: isLocked,
    confidence: calculateConfidence(params),
    breakdown: {
      base_time: baseTime,
      distance_time: Math.round(distanceTime),
      traffic_factor: trafficFactor,
      weather_factor: weatherFactor,
      rider_load_time: riderLoadTime,
      merchant_prep_time: merchantPrepTime,
      overlap_time: overlapDiscount
    },
    params: params
  };
}

/**
 * 保存ETA记录
 */
async function saveETARecord({ order_no, merchant_order_id, rider_order_id, total_minutes, eta_timestamp, breakdown, params, stage, is_locked }) {
  // 检查是否已存在记录
  const [existing] = await pool.query(
    'SELECT id FROM eta_records WHERE order_no = ?',
    [order_no]
  );

  if (existing.length > 0) {
    // 更新
    await pool.query(
      `UPDATE eta_records 
       SET eta_minutes = ?, eta_timestamp = ?, breakdown = ?, params = ?, 
           refresh_stage = ?, is_locked = ?, updated_at = NOW()
       WHERE order_no = ?`,
      [total_minutes, eta_timestamp, JSON.stringify(breakdown), JSON.stringify(params), stage, is_locked, order_no]
    );
  } else {
    // 插入
    await pool.query(
      `INSERT INTO eta_records 
       (order_no, merchant_order_id, rider_order_id, eta_minutes, eta_timestamp, 
        breakdown, params, refresh_stage, is_locked, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [order_no, merchant_order_id, rider_order_id, total_minutes, eta_timestamp,
       JSON.stringify(breakdown), JSON.stringify(params), stage, is_locked, 0.85]
    );
  }
}

/**
 * 获取当前天气
 */
async function getCurrentWeather(areaCode) {
  // 这里可以接入天气API
  // 暂时返回默认值
  return 'sunny';
}

/**
 * 获取当前交通状况
 */
async function getCurrentTraffic(areaCode) {
  // 这里可以接入地图API
  // 暂时根据时间段判断
  const hour = new Date().getHours();
  if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
    return 'congested';
  } else if ((hour >= 11 && hour <= 13) || (hour >= 14 && hour <= 16)) {
    return 'moderate';
  }
  return 'smooth';
}

/**
 * 格式化ETA显示
 */
function formatETADisplay(minutes) {
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
}

/**
 * 计算置信度
 */
function calculateConfidence(params) {
  let confidence = 0.85;

  // 距离越远，置信度越低
  if (params.distance_km > 10) confidence -= 0.1;
  if (params.distance_km > 20) confidence -= 0.1;

  // 恶劣天气降低置信度
  if (params.weather === 'rain') confidence -= 0.05;
  if (params.weather === 'snow') confidence -= 0.1;

  // 拥堵降低置信度
  if (params.traffic === 'congested') confidence -= 0.05;

  return Math.max(0.5, confidence);
}

module.exports = router;
