/**
 * 盐阜配送 - AI需求预测服务
 * 加权移动平均 + 天气修正 + 运力缺口计算
 */
const { pool } = require('../config/database');
const { PREDICT_CONFIG } = require('../config/ai_dispatch');
const path = require('path');
const fs = require('fs');

class PredictService {
  constructor() {
    this.config = PREDICT_CONFIG;
  }

  /**
   * 主入口：预测指定区域未来几小时的订单量
   */
  async predictOrders(region, hours = 24, options = {}) {
    const traceId = `PRED-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    try {
      // 1. 聚合历史数据
      const historyDays = options.historyDays || this.config.HISTORY_DAYS;
      const historyData = await this.aggregateHistory(region, hours, historyDays);

      // 2. 冷启动检查
      if (historyData.length === 0) {
        const emptyResult = this.buildEmptyResult(region, hours, traceId);
        return emptyResult;
      }

      // 3. WMA计算
      const weights = this.config.WMA_WEIGHTS;
      const predictions = this.weightedMovingAverage(historyData, weights);

      // 4. 天气修正
      const forecast = options.forecast || {};
      const corrected = this.applyWeatherCorrection(predictions, forecast);

      // 5. 保存预测结果
      for (const pred of corrected) {
        await this.savePrediction(region, pred.hour, pred.predicted_orders, pred.confidence, traceId);
      }

      return {
        region,
        predictions: corrected,
        history_days: historyDays,
        model: 'wma_v1',
        trace_id: traceId,
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`[${traceId}] 预测失败:`, error.message);
      return this.buildEmptyResult(region, hours, traceId, error.message);
    }
  }

  /**
   * 按天+小时聚合历史订单数据
   */
  async aggregateHistory(region, hours, days) {
    const data = [];
    for (let d = 1; d <= days; d++) {
      try {
        const [rows] = await pool.query(
          `SELECT HOUR(created_at) as hour, COUNT(*) as order_count
           FROM merchant_orders
           WHERE DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL ? DAY)
           GROUP BY HOUR(created_at)
           ORDER BY hour`,
          [d]
        );
        const hourMap = {};
        for (const row of rows) {
          hourMap[row.hour] = row.order_count;
        }
        data.push(hourMap);
      } catch (e) {
        // 某天数据不存在时跳过
        data.push({});
      }
    }
    return data;
  }

  /**
   * 加权移动平均
   */
  weightedMovingAverage(historyData, weights) {
    const predictions = [];
    const availableDays = historyData.length;
    const adjustedWeights = weights.slice(0, availableDays);

    // 权重归一化
    const totalWeight = adjustedWeights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = adjustedWeights.map(w => w / totalWeight);

    for (let hour = 0; hour < 24; hour++) {
      let weightedSum = 0;
      let validCount = 0;

      for (let d = 0; d < availableDays; d++) {
        const count = historyData[d][hour];
        if (count !== undefined) {
          weightedSum += count * normalizedWeights[d];
          validCount++;
        }
      }

      const predicted = validCount > 0 ? Math.round(weightedSum) : 0;
      const confidence = Math.min(validCount / availableDays, 1.0);

      predictions.push({
        hour: new Date(new Date().setHours(hour, 0, 0, 0)),
        predicted_orders: Math.max(0, predicted),
        confidence: Math.round(confidence * this.config.MIN_CONFIDENCE * 100) / 100 || this.config.MIN_CONFIDENCE,
      });
    }

    return predictions;
  }

  /**
   * 应用天气修正
   */
  applyWeatherCorrection(predictions, forecast) {
    const factors = this.config.WEATHER_CORRECTION_FACTORS;
    return predictions.map(pred => {
      const hour = new Date(pred.hour).getHours();
      const hourForecast = forecast[hour];
      if (hourForecast && factors[hourForecast.weather]) {
        const factor = factors[hourForecast.weather];
        return {
          ...pred,
          predicted_orders: Math.round(pred.predicted_orders * factor),
          weather: hourForecast.weather,
          weather_factor: factor,
        };
      }
      return { ...pred, weather: '晴', weather_factor: 1.0 };
    });
  }

  /**
   * 运力缺口计算
   */
  async calculateCapacityGap(region, predictedOrders, hour) {
    try {
      const ordersPerRider = this.config.CAPACITY_ORDERS_PER_RIDER;
      const neededRiders = Math.ceil(predictedOrders / ordersPerRider);

      const [riders] = await pool.query(
        "SELECT COUNT(*) as online FROM riders WHERE status = 'online' AND pool_type != 'rest'"
      );
      const onlineRiders = riders[0]?.online || 0;
      const gap = neededRiders - onlineRiders;
      const gapRatio = neededRiders > 0 ? Math.round((gap / neededRiders) * 10000) / 100 : 0;

      return {
        region,
        predict_hour: new Date(new Date().setHours(hour, 0, 0, 0)),
        predicted_orders: predictedOrders,
        online_riders: onlineRiders,
        needed_riders: neededRiders,
        gap_ratio: gapRatio,
        advice: gap > 0
          ? { action: 'recruit', count: gap, message: `需要招募${gap}名骑手` }
          : { action: 'sufficient', message: '运力充足' },
      };
    } catch (e) {
      console.error('[PREDICT] 运力计算失败:', e.message);
      return null;
    }
  }

  /**
   * 保存预测结果
   */
  async savePrediction(region, predictHour, predictedOrders, confidence, traceId) {
    try {
      await pool.query(
        `INSERT INTO ai_predictions (region, predict_hour, predicted_orders, confidence, model_version, features)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE predicted_orders = VALUES(predicted_orders), confidence = VALUES(confidence)`,
        [region, predictHour, predictedOrders, confidence, 'wma_v1', JSON.stringify({ trace_id: traceId })]
      );
    } catch (e) {
      console.error('[PREDICT] 保存失败:', e.message);
    }
  }

  /**
   * 保存运力建议
   */
  async saveCapacityAdvice(advice) {
    if (!advice) return;
    try {
      await pool.query(
        `INSERT INTO capacity_advice (region, predict_hour, predicted_orders, online_riders, needed_riders, gap_ratio, advice)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [advice.region, advice.predict_hour, advice.predicted_orders, advice.online_riders,
         advice.needed_riders, advice.gap_ratio, JSON.stringify(advice.advice)]
      );
    } catch (e) {
      console.error('[PREDICT] 运力建议保存失败:', e.message);
    }
  }

  /**
   * 查询预测历史
   */
  async getPredictionHistory(params = {}) {
    let sql = 'SELECT * FROM ai_predictions WHERE 1=1';
    const values = [];

    if (params.region) { sql += ' AND region = ?'; values.push(params.region); }
    if (params.start_time) { sql += ' AND predict_hour >= ?'; values.push(params.start_time); }
    if (params.end_time) { sql += ' AND predict_hour <= ?'; values.push(params.end_time); }

    sql += ' ORDER BY predict_hour DESC';

    const page = params.page || 1;
    const pageSize = params.page_size || 24;
    const offset = (page - 1) * pageSize;

    const [countResult] = await pool.query(sql.replace('SELECT *', 'SELECT COUNT(*) as total'), values);
    sql += ' LIMIT ? OFFSET ?';
    values.push(pageSize, offset);
    const [rows] = await pool.query(sql, values);

    return { list: rows, total: countResult[0].total, page, page_size: pageSize };
  }

  /**
   * 准确度评估（MAPE）
   */
  async evaluateAccuracy(region, date) {
    try {
      const [rows] = await pool.query(
        `SELECT predict_hour, predicted_orders, actual_orders
         FROM ai_predictions
         WHERE region = ? AND DATE(predict_hour) = ? AND actual_orders IS NOT NULL`,
        [region, date]
      );

      if (rows.length === 0) return null;

      let totalAbsError = 0;
      let validHours = 0;

      for (const row of rows) {
        if (row.actual_orders > 0) {
          totalAbsError += Math.abs(row.predicted_orders - row.actual_orders) / row.actual_orders;
          validHours++;
        }
      }

      const mape = validHours > 0 ? Math.round((totalAbsError / validHours) * 10000) / 100 : null;

      await pool.query(
        `INSERT INTO prediction_accuracy (region, record_date, total_hours, mape, details)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mape = VALUES(mape), details = VALUES(details)`,
        [region, date, validHours, mape, JSON.stringify({ total: rows.length, valid_hours: validHours })]
      );

      return { region, date, total_hours: rows.length, valid_hours: validHours, mape };
    } catch (e) {
      console.error('[PREDICT] 准确度评估失败:', e.message);
      return null;
    }
  }

  /**
   * 获取准确度报告
   */
  async getAccuracyReport(params = {}) {
    let sql = 'SELECT * FROM prediction_accuracy WHERE 1=1';
    const values = [];

    if (params.region) { sql += ' AND region = ?'; values.push(params.region); }
    if (params.start_date) { sql += ' AND record_date >= ?'; values.push(params.start_date); }
    if (params.end_date) { sql += ' AND record_date <= ?'; values.push(params.end_date); }

    sql += ' ORDER BY record_date DESC';
    const [rows] = await pool.query(sql, values);
    return rows;
  }

  /**
   * 获取最近预测
   */
  async getLatestPrediction(region) {
    const [rows] = await pool.query(
      'SELECT * FROM ai_predictions WHERE region = ? ORDER BY predict_hour DESC LIMIT 24',
      [region]
    );
    return rows;
  }

  /**
   * 获取所有区域
   */
  getAllRegions() {
    try {
      const regionsPath = path.join(__dirname, '..', 'data', 'regions.json');
      if (fs.existsSync(regionsPath)) {
        const data = JSON.parse(fs.readFileSync(regionsPath, 'utf8'));
        const districts = [];
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.districts && Array.isArray(item.districts)) {
              districts.push(...item.districts);
            } else if (item.name) {
              districts.push(item.name);
            }
          }
        }
        return districts.length > 0 ? districts : ['default'];
      }
    } catch (e) {
      console.warn('[PREDICT] regions.json读取失败:', e.message);
    }
    return ['default'];
  }

  buildEmptyResult(region, hours, traceId, error = null) {
    const now = new Date();
    const predictions = [];
    for (let h = 0; h < hours; h++) {
      const hour = (now.getHours() + h) % 24;
      predictions.push({
        hour: new Date(now.setHours(hour, 0, 0, 0)),
        predicted_orders: 0,
        confidence: 0,
        weather: '晴',
        weather_factor: 1.0,
      });
    }
    return { region, predictions, model: 'wma_v1', trace_id: traceId, generated_at: now.toISOString(), note: error || '冷启动-无历史数据' };
  }
}

module.exports = new PredictService();
