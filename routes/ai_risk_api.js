/**
 * 盐阜配送 - AI风控管理API路由
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const riskControlService = require('../services/ai_risk_service');

// ==================== 规则管理 ====================

// 获取规则列表
router.get('/risk/rules', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, page_size = 20 } = req.query;
    const result = await riskControlService.getRules(Number(page), Number(page_size));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 创建规则
router.post('/risk/rules', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = await riskControlService.createRule(req.body);
    res.json({ success: true, data: { id }, message: '规则创建成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 更新规则
router.put('/risk/rules/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await riskControlService.updateRule(Number(req.params.id), req.body);
    res.json({ success: true, message: '规则更新成功' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 删除规则
router.delete('/risk/rules/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await riskControlService.deleteRule(Number(req.params.id));
    res.json({ success: true, message: '规则已删除' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 风控检查（手动触发） ====================

router.post('/risk/check', authMiddleware, async (req, res) => {
  try {
    const { target_type, target_id, action, context } = req.body;
    const result = await riskControlService.check(target_type, target_id, action, context || {});
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 风控日志 ====================

router.get('/risk/logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { target_type, target_id, decision, page = 1, page_size = 20 } = req.query;
    const result = await riskControlService.getRiskLogs({
      target_type, target_id: target_id ? Number(target_id) : undefined,
      decision, page: Number(page), page_size: Number(page_size),
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 黑白名单管理 ====================

// 获取黑名单列表
router.get('/risk/blacklist', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, keyword, page = 1, page_size = 20 } = req.query;
    const result = await riskControlService.getBlacklist({
      blocked_type, keyword, page: Number(page), page_size: Number(page_size),
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 获取黑名单配额统计
router.get('/risk/blacklist/quota', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const data = await riskControlService.getBlacklistQuota();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 添加到黑名单
router.post('/risk/blacklist', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, blocked_id, blocked_name, blocked_phone, reason } = req.body;
    const id = await riskControlService.addToBlacklist(
      blocked_type, blocked_id, blocked_name, blocked_phone, reason || 'manual', 'admin'
    );
    res.json({ success: true, data: { id }, message: '已加入黑名单' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 从黑名单移除
router.delete('/risk/blacklist', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, blocked_id } = req.body;
    await riskControlService.removeFromBlacklist(blocked_type, blocked_id);
    res.json({ success: true, message: '已从黑名单移除' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ==================== 白名单管理 ====================

router.post('/risk/whitelist', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, blocked_id, blocked_name } = req.body;
    const id = await riskControlService.addToBlacklist(blocked_type, blocked_id, blocked_name, null, 'whitelist', 'admin');
    res.json({ success: true, data: { id }, message: '已加入白名单' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/risk/whitelist', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { blocked_type, blocked_id } = req.body;
    await riskControlService.removeFromBlacklist(blocked_type, blocked_id);
    res.json({ success: true, message: '已从白名单移除' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
