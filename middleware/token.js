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
 * 盐阜配送 - Token刷新和验证中间件
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// [P0修复] 强制使用环境变量，禁止硬编码默认值
const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRY) || 3600; // 1小时
const REFRESH_TOKEN_EXPIRY = parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRY) || 604800; // 7天

// [P0修复] 启动时验证JWT密钥
if (!JWT_SECRET) {
  console.error('[P0安全] FATAL: JWT_SECRET 环境变量未设置');
  console.error('[P0安全] 请在 .env 文件中配置强密钥，例如:');
  console.error('[P0安全] JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'));
  process.exit(1);
}

// [P0修复] 验证密钥强度
if (JWT_SECRET.length < 32) {
  console.error('[P0安全] FATAL: JWT_SECRET 长度不足32位，当前长度:', JWT_SECRET.length);
  console.error('[P0安全] 请使用至少32位的强密钥');
  process.exit(1);
}

// [P0修复] 检查是否使用默认密钥（防止只是修改了默认值）
const weakPatterns = ['kuailv', 'secret', '123456', 'password', 'admin', 'default'];
const lowerSecret = JWT_SECRET.toLowerCase();
for (const pattern of weakPatterns) {
  if (lowerSecret.includes(pattern)) {
    console.warn('[P0安全] WARNING: JWT_SECRET 包含弱密钥模式:', pattern);
    console.warn('[P0安全] 建议生成随机密钥: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    break;
  }
}

/**
 * 生成Access Token
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * 生成Refresh Token
 */
async function generateRefreshToken(userId, userType) {
  const token = jwt.sign(
    { userId, userType, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  // 保存到数据库
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, user_type, token, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, userType, token, expires_at]
  );

  return token;
}

/**
 * 验证Access Token
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error('INVALID_TOKEN');
  }
}

/**
 * 验证Refresh Token
 */
async function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type !== 'refresh') {
      throw new Error('INVALID_TOKEN_TYPE');
    }

    // 检查数据库中是否存在且未过期
    const [tokens] = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );

    if (tokens.length === 0) {
      throw new Error('TOKEN_REVOKED');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }
    throw error;
  }
}

/**
 * 撤销Refresh Token（登出时使用）
 */
async function revokeRefreshToken(token) {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE token = ?',
    [token]
  );
}

/**
 * 撤销用户的所有Refresh Token
 */
async function revokeAllUserTokens(userId, userType) {
  await pool.query(
    'DELETE FROM refresh_tokens WHERE user_id = ? AND user_type = ?',
    [userId, userType]
  );
}

/**
 * Token刷新中间件
 */
async function refreshTokenMiddleware(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: '缺少刷新令牌'
      });
    }

    // 验证Refresh Token
    const decoded = await verifyRefreshToken(refreshToken);

    // 获取用户信息
    let user;
    switch (decoded.userType) {
      case 'user':
        [user] = await pool.query('SELECT id, phone, nickname FROM users WHERE id = ?', [decoded.userId]);
        break;
      case 'rider':
        [user] = await pool.query('SELECT id, phone, name FROM riders WHERE id = ?', [decoded.userId]);
        break;
      case 'merchant':
        [user] = await pool.query('SELECT id, phone, name FROM merchants WHERE id = ?', [decoded.userId]);
        break;
      case 'admin':
        [user] = await pool.query('SELECT id, username FROM admins WHERE id = ?', [decoded.userId]);
        break;
    }

    if (!user || user.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 生成新的Token对
    const accessToken = generateAccessToken({
      id: decoded.userId,
      type: decoded.userType,
      ...user[0]
    });

    const newRefreshToken = await generateRefreshToken(decoded.userId, decoded.userType);

    // 删除旧的Refresh Token
    await revokeRefreshToken(refreshToken);

    res.json({
      success: true,
      message: 'Token刷新成功',
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: ACCESS_TOKEN_EXPIRY
      }
    });

  } catch (error) {
    console.error('Token刷新失败:', error);
    res.status(401).json({
      success: false,
      message: '刷新令牌无效或已过期',
      error: error.message
    });
  }
}

/**
 * 增强的认证中间件（支持Token自动刷新提示）
 */
function enhancedAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: '未提供认证令牌'
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.message === 'TOKEN_EXPIRED') {
      // Token过期，提示客户端使用Refresh Token
      return res.status(401).json({
        success: false,
        message: '访问令牌已过期',
        code: 'TOKEN_EXPIRED',
        shouldRefresh: true
      });
    }

    return res.status(401).json({
      success: false,
      message: '无效的认证令牌'
    });
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  refreshTokenMiddleware,
  enhancedAuthMiddleware,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY
};
