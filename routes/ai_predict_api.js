/**
 * 盐阜配送 - AI需求预测API路由
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const predictService = require('../services/ai_predict_service');
const predictScheduler = require('../services/ai_predict_scheduler');

// 获取订单预测
router.get('/predict/orders', authMiddleware, async (req, res) => {
  try {
    const { region, hours = 24 } = req.query;
    const result = await predictService.predictOrders(region || 'default', Number(hours));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取运力调度建议
router.get('/predict/capacity', authMiddleware, async (req, res) => {
  try {
    const { region, hour } = req.query;
    const h = hour !== undefined ? Number(hour) : new Date().getHours();
    const result = await predictService.calculateCapacityGap(region || 'default', 0, h);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 预测历史回溯
router.get('/predict/history', authMiddleware, async (req, res) => {
  try {
    const { region, start_time, end_time, page = 1, page_size = 24 } = req.query;
    const result = await predictService.getPredictionHistory({
      region, start_time, end_time, page: Number(page), page_size: Number(page_size),
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 准确度评估报表
router.get('/predict/accuracy', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { region, start_date, end_date } = req.query;
    const result = await predictService.getAccuracyReport({ region, start_date, end_date });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 调度器状态（admin）
router.get('/predict/scheduler-status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const status = predictScheduler.getStatus();
    res.json({ success: true, data: status });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 手动触发调度（admin）
router.post('/predict/trigger-daily', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    predictScheduler.runDailyPrediction();
    res.json({ success: true, message: '每日预测已触发' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
