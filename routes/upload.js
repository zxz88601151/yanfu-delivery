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

// 文件上传路由
const express = require('express');
const router = express.Router();
const path = require('path');
const { upload, handleUpload, UPLOAD_DIR } = require('../services/upload');
const { authMiddleware } = require('../middleware/auth');

// 静态文件服务 - 需要鉴权才能访问上传文件
router.get('/files/*', authMiddleware, (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.path.replace('/files/', ''));
  // 防止路径遍历攻击
  const safePath = path.resolve(UPLOAD_DIR);
  if (!path.resolve(filePath).startsWith(safePath)) {
    return res.status(403).json({ success: false, message: '禁止访问' });
  }
  res.sendFile(filePath, (err) => {
    if (err) return res.status(404).json({ success: false, message: '文件不存在' });
  });
});

// ========== 通用图片上传 ==========
// 单张上传
router.post('/image', authMiddleware, (req, res) => {
  const singleUpload = upload.single('image');
  singleUpload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '文件大小不能超过5MB' });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }
    
    const category = req.body.category || 'general';
    const results = await handleUpload(req.file, category);
    
    if (results[0] && results[0].url) {
      res.json({ success: true, data: results[0] });
    } else {
      res.status(500).json({ success: false, message: '上传失败' });
    }
  });
});

// 多张上传（最多9张）
router.post('/images', authMiddleware, (req, res) => {
  const multiUpload = upload.array('images', 9);
  multiUpload(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: '单张图片不能超过5MB' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ success: false, message: '最多上传9张图片' });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }
    
    const category = req.body.category || 'general';
    const results = await handleUpload(req.files, category);
    
    const successResults = results.filter(r => r.url);
    const failedResults = results.filter(r => !r.url);
    
    res.json({
      success: true,
      data: {
        images: successResults,
        failed: failedResults,
        total: successResults.length,
      }
    });
  });
});

// ========== 头像上传 ==========
router.post('/avatar', authMiddleware, (req, res) => {
  const avatarUpload = upload.single('avatar');
  avatarUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择头像图片' });
    }
    
    const results = await handleUpload(req.file, 'avatars');
    if (results[0] && results[0].url) {
      res.json({ success: true, data: results[0] });
    } else {
      res.status(500).json({ success: false, message: '上传失败' });
    }
  });
});

// ========== 菜品图片上传 ==========
router.post('/menu-image', authMiddleware, (req, res) => {
  const menuUpload = upload.single('menuImage');
  menuUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择菜品图片' });
    }
    
    const results = await handleUpload(req.file, 'menu');
    if (results[0] && results[0].url) {
      res.json({ success: true, data: results[0] });
    } else {
      res.status(500).json({ success: false, message: '上传失败' });
    }
  });
});

module.exports = router;
