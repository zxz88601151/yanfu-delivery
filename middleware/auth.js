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

const jwt = require('jsonwebtoken');

// JWT验证中间件
const authMiddleware = (req, res, next) => {
  // 支持多种 token header: Authorization (Bearer), x-token, Authorization (plain)
  const token = req.headers['authorization']
    || req.headers['x-token']
    || req.headers['x-Token']
    || req.headers['token'];
  
  if (!token || token.trim() === '') {
    return res.status(401).json({ success: false, message: '未提供认证令牌' });
  }
  
  // 处理 "Bearer <token>" 格式
  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token.trim();
  
  if (!token) {
    return res.status(401).json({ success: false, message: '令牌格式错误' });
  }

  try {
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '令牌已过期，请重新登录' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: '令牌无效' });
    }
    return res.status(401).json({ success: false, message: '令牌验证失败' });
  }
};

// 管理员验证中间件
const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '需要管理员权限' });
  }
  next();
};

// 骑手验证中间件
const riderMiddleware = (req, res, next) => {
  if (req.user.role !== 'rider') {
    return res.status(403).json({ success: false, message: '需要骑手权限' });
  }
  next();
};

// 商家验证中间件
const merchantMiddleware = (req, res, next) => {
  if (req.user.role !== 'merchant') {
    return res.status(403).json({ success: false, message: '需要商家权限' });
  }
  next();
};

// 用户验证中间件
const userMiddleware = (req, res, next) => {
  if (req.user.role !== 'user') {
    return res.status(403).json({ success: false, message: '需要用户权限' });
  }
  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  riderMiddleware,
  merchantMiddleware,
  userMiddleware
};
