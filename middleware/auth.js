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
