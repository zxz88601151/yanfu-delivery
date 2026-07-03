/**
 * 盐阜配送 - 增强版认证路由
 * 包含短信验证码、密码重置、登录日志等功能
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { generateAccessToken, generateRefreshToken, revokeRefreshToken } = require('../middleware/token');

const router = express.Router();

// JWT配置验证
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN) || 3600;

// 验证码存储 - 优先使用Redis，降级到内存Map
let redisClient = null;
const verificationCodes = new Map(); // 降级方案

// 尝试连接Redis
try {
  const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  redisClient = require('ioredis')(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    lazyConnect: true,
  });
  redisClient.on('error', (err) => {
    console.warn('[Redis] 连接失败，验证码将使用内存存储:', err.message);
    redisClient = null;
  });
  redisClient.connect().catch(() => { redisClient = null; });
  console.log('[Redis] 验证码存储已连接');
} catch (e) {
  console.warn('[Redis] ioredis未安装，验证码使用内存存储');
}

/**
 * 统一验证码存取接口
 */
async function setCode(key, data, ttl = 300) {
  if (redisClient) {
    await redisClient.set(`vcode:${key}`, JSON.stringify(data), 'EX', ttl);
  } else {
    verificationCodes.set(key, data);
  }
}

async function getCode(key) {
  if (redisClient) {
    const raw = await redisClient.get(`vcode:${key}`);
    return raw ? JSON.parse(raw) : null;
  } else {
    return verificationCodes.get(key) || null;
  }
}

async function deleteCode(key) {
  if (redisClient) {
    await redisClient.del(`vcode:${key}`).catch(() => {});
  } else {
    verificationCodes.delete(key);
  }
}

// ============================================================
// 短信验证码API
// ============================================================

/**
 * POST /api/auth/send-code
 * 发送短信验证码
 */
router.post('/send-code', async (req, res) => {
  try {
    const { phone, type = 'register' } = req.body;

    // 验证手机号格式
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: '请输入正确的手机号'
      });
    }

    // 检查发送频率（60秒内不能重复发送）
    const lastSent = await getCode(`${phone}_last_sent`);
    if (lastSent && Date.now() - lastSent < 60000) {
      return res.status(429).json({
        success: false,
        message: '发送过于频繁，请60秒后重试',
        retry_after: Math.ceil((60000 - (Date.now() - lastSent)) / 1000)
      });
    }

    // 生成6位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 存储验证码（5分钟有效）
    await setCode(phone, {
      code,
      type,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0
    }, 300);
    await setCode(`${phone}_last_sent`, Date.now(), 60);

    // TODO: 调用短信服务发送验证码
    // 开发环境直接返回验证码
    const isDev = process.env.NODE_ENV !== 'production';

    res.json({
      success: true,
      message: '验证码已发送',
      data: isDev ? { code } : null // 仅开发环境返回验证码
    });

  } catch (error) {
    console.error('发送验证码失败:', error);
    res.status(500).json({ success: false, message: '发送失败' });
  }
});

/**
 * POST /api/auth/verify-code
 * 验证短信验证码
 */
router.post('/verify-code', async (req, res) => {
  try {
    const { phone, code } = req.body;

    const record = await getCode(phone);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: '验证码不存在或已过期'
      });
    }

    if (Date.now() > record.expiresAt) {
      await deleteCode(phone);
      return res.status(400).json({
        success: false,
        message: '验证码已过期'
      });
    }

    if (record.attempts >= 3) {
      await deleteCode(phone);
      return res.status(400).json({
        success: false,
        message: '验证次数过多，请重新获取验证码'
      });
    }

    record.attempts++;

    if (record.code !== code) {
      // 更新尝试次数
      await setCode(phone, record, 300);
      return res.status(400).json({
        success: false,
        message: '验证码错误',
        remaining_attempts: 3 - record.attempts
      });
    }

    // 验证成功，标记为已验证
    record.verified = true;
    await setCode(phone, record, 300);

    res.json({
      success: true,
      message: '验证成功'
    });

  } catch (error) {
    console.error('验证验证码失败:', error);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

// ============================================================
// 骑手注册/登录
// ============================================================

/**
 * POST /api/auth/rider/register
 * 骑手注册（带验证码验证）
 */
router.post('/rider/register', async (req, res) => {
  try {
    const { phone, password, name, code } = req.body;

    // 验证必填字段
    if (!phone || !password || !name) {
      return res.status(400).json({
        success: false,
        message: '请填写完整信息'
      });
    }

    // 验证手机号
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: '请输入正确的手机号'
      });
    }

    // 验证密码强度
    const passwordCheck = checkPasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message
      });
    }

    // 验证验证码（生产环境启用）
    if (process.env.NODE_ENV === 'production') {
      const codeRecord = await getCode(phone);
      if (!codeRecord || !codeRecord.verified || codeRecord.code !== code) {
        return res.status(400).json({
          success: false,
          message: '请先完成手机号验证'
        });
      }
    }

    // 检查手机号是否已注册
    const [existing] = await pool.query(
      'SELECT id FROM riders WHERE phone = ?',
      [phone]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: '该手机号已注册'
      });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建骑手账号
    const [result] = await pool.query(
      `INSERT INTO riders (phone, password, name, status, credit_score, created_at)
       VALUES (?, ?, ?, 'offline', 100, NOW())`,
      [phone, hashedPassword, name]
    );

    const riderId = result.insertId;

    // 创建骑手设置
    await pool.query(
      `INSERT INTO rider_settings (rider_id) VALUES (?)`,
      [riderId]
    );

    // 清除验证码
    await deleteCode(phone);

    // 记录注册日志
    await logOperation(riderId, 'rider', 'REGISTER', 'rider', riderId, { phone }, req);

    // 生成Token
    const accessToken = generateAccessToken({
      id: riderId,
      type: 'rider',
      phone,
      name
    });

    const refreshToken = await generateRefreshToken(riderId, 'rider');

    res.json({
      success: true,
      message: '注册成功',
      data: {
        rider: {
          id: riderId,
          phone,
          name,
          status: 'offline'
        },
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });

  } catch (error) {
    console.error('骑手注册失败:', error);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

/**
 * POST /api/auth/rider/login
 * 骑手登录（支持密码和验证码）
 */
router.post('/rider/login', async (req, res) => {
  try {
    const { phone, password, code, loginType = 'password' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: '请输入手机号'
      });
    }

    // 查找骑手
    const [riders] = await pool.query(
      'SELECT * FROM riders WHERE phone = ?',
      [phone]
    );

    if (riders.length === 0) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }

    const rider = riders[0];

    // 检查账号状态
    if (rider.status === 'frozen') {
      return res.status(403).json({
        success: false,
        message: '账号已被冻结',
        freeze_reason: rider.freeze_reason
      });
    }

    // 验证登录方式
    if (loginType === 'password') {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: '请输入密码'
        });
      }

      const isValid = await bcrypt.compare(password, rider.password);
      if (!isValid) {
        await recordFailedLogin(phone, 'rider', req);
        return res.status(401).json({
          success: false,
          message: '密码错误'
        });
      }
    } else if (loginType === 'code') {
      // 验证码登录
      const codeRecord = await getCode(phone);
      if (!codeRecord || codeRecord.code !== code) {
        return res.status(400).json({
          success: false,
          message: '验证码错误'
        });
      }
      await deleteCode(phone);
    }

    // 更新最后登录时间
    await pool.query(
      'UPDATE riders SET last_login_at = NOW() WHERE id = ?',
      [rider.id]
    );

    // 记录登录日志
    await logOperation(rider.id, 'rider', 'LOGIN', 'rider', rider.id, { phone, loginType }, req);

    // 生成Token
    const accessToken = generateAccessToken({
      id: rider.id,
      type: 'rider',
      phone: rider.phone,
      name: rider.name
    });

    const refreshToken = await generateRefreshToken(rider.id, 'rider');

    // 返回骑手信息（不包含敏感字段）
    const { password: _, ...riderInfo } = rider;

    res.json({
      success: true,
      message: '登录成功',
      data: {
        rider: riderInfo,
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });

  } catch (error) {
    console.error('骑手登录失败:', error);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// ============================================================
// 商家注册/登录
// ============================================================

/**
 * POST /api/auth/merchant/register
 * 商家注册（带店铺信息）
 */
router.post('/merchant/register', async (req, res) => {
  try {
    const {
      phone,
      password,
      shopName,
      contactName,
      address,
      category,
      code
    } = req.body;

    // 验证必填字段
    if (!phone || !password || !shopName || !contactName) {
      return res.status(400).json({
        success: false,
        message: '请填写完整信息'
      });
    }

    // 验证手机号
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: '请输入正确的手机号'
      });
    }

    // 验证密码强度
    const passwordCheck = checkPasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message
      });
    }

    // 验证验证码（生产环境）
    if (process.env.NODE_ENV === 'production') {
      const codeRecord = await getCode(phone);
      if (!codeRecord || !codeRecord.verified || codeRecord.code !== code) {
        return res.status(400).json({
          success: false,
          message: '请先完成手机号验证'
        });
      }
    }

    // 检查手机号是否已注册
    const [existing] = await pool.query(
      'SELECT id FROM merchants WHERE phone = ?',
      [phone]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: '该手机号已注册'
      });
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建商家账号
    const [result] = await pool.query(
      `INSERT INTO merchants (phone, password, name, contact_name, address, category, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [phone, hashedPassword, shopName, contactName, address || '', category || '']
    );

    const merchantId = result.insertId;

    // 清除验证码
    await deleteCode(phone);

    // 记录注册日志
    await logOperation(merchantId, 'merchant', 'REGISTER', 'merchant', merchantId, { phone, shopName }, req);

    // 生成Token
    const accessToken = generateAccessToken({
      id: merchantId,
      type: 'merchant',
      phone,
      name: shopName
    });

    const refreshToken = await generateRefreshToken(merchantId, 'merchant');

    res.json({
      success: true,
      message: '注册成功，请等待审核',
      data: {
        merchant: {
          id: merchantId,
          phone,
          name: shopName,
          status: 'pending'
        },
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });

  } catch (error) {
    console.error('商家注册失败:', error);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

/**
 * POST /api/auth/merchant/login
 * 商家登录
 */
router.post('/merchant/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入手机号和密码'
      });
    }

    // 查找商家
    const [merchants] = await pool.query(
      'SELECT * FROM merchants WHERE phone = ?',
      [phone]
    );

    if (merchants.length === 0) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }

    const merchant = merchants[0];

    // 检查账号状态
    if (merchant.status === 'frozen') {
      return res.status(403).json({
        success: false,
        message: '账号已被冻结'
      });
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, merchant.password);
    if (!isValid) {
      await recordFailedLogin(phone, 'merchant', req);
      return res.status(401).json({
        success: false,
        message: '密码错误'
      });
    }

    // 更新最后登录时间
    await pool.query(
      'UPDATE merchants SET last_login_at = NOW() WHERE id = ?',
      [merchant.id]
    );

    // 记录登录日志
    await logOperation(merchant.id, 'merchant', 'LOGIN', 'merchant', merchant.id, { phone }, req);

    // 生成Token
    const accessToken = generateAccessToken({
      id: merchant.id,
      type: 'merchant',
      phone: merchant.phone,
      name: merchant.name
    });

    const refreshToken = await generateRefreshToken(merchant.id, 'merchant');

    // 返回商家信息（不包含敏感字段）
    const { password: _, ...merchantInfo } = merchant;

    res.json({
      success: true,
      message: '登录成功',
      data: {
        merchant: merchantInfo,
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });

  } catch (error) {
    console.error('商家登录失败:', error);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// ============================================================
// 管理员登录
// ============================================================

/**
 * POST /api/auth/admin/login
 * 管理员登录
 */
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入用户名和密码'
      });
    }

    // 查找管理员
    const [admins] = await pool.query(
      'SELECT * FROM admins WHERE username = ?',
      [username]
    );

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        message: '管理员不存在'
      });
    }

    const admin = admins[0];

    // 检查账号状态
    if (admin.status === 'disabled') {
      return res.status(403).json({
        success: false,
        message: '账号已被禁用'
      });
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      await recordFailedLogin(username, 'admin', req);
      return res.status(401).json({
        success: false,
        message: '密码错误'
      });
    }

    // 更新最后登录时间
    await pool.query(
      'UPDATE admins SET last_login_at = NOW() WHERE id = ?',
      [admin.id]
    );

    // 记录登录日志
    await logOperation(admin.id, 'admin', 'LOGIN', 'admin', admin.id, { username }, req);

    // 生成Token
    const accessToken = generateAccessToken({
      id: admin.id,
      type: 'admin',
      username: admin.username,
      role: admin.role
    });

    const refreshToken = await generateRefreshToken(admin.id, 'admin');

    res.json({
      success: true,
      message: '登录成功',
      data: {
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role
        },
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN
      }
    });

  } catch (error) {
    console.error('管理员登录失败:', error);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// ============================================================
// 密码重置
// ============================================================

/**
 * POST /api/auth/forgot-password
 * 忘记密码（发送重置验证码）
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { phone, userType } = req.body;

    if (!phone || !userType) {
      return res.status(400).json({
        success: false,
        message: '请提供手机号和用户类型'
      });
    }

    // 检查账号是否存在
    let table = userType === 'rider' ? 'riders' : 'merchants';
    const [users] = await pool.query(
      `SELECT id FROM ${table} WHERE phone = ?`,
      [phone]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '该手机号未注册'
      });
    }

    // 生成重置验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 存储验证码（10分钟有效）
    await setCode(`reset_${phone}`, {
      code,
      userType,
      userId: users[0].id,
      expiresAt: Date.now() + 10 * 60 * 1000
    }, 600);

    // TODO: 调用短信服务发送验证码
    const isDev = process.env.NODE_ENV !== 'production';

    res.json({
      success: true,
      message: '重置验证码已发送',
      data: isDev ? { code } : null
    });

  } catch (error) {
    console.error('发送重置验证码失败:', error);
    res.status(500).json({ success: false, message: '发送失败' });
  }
});

/**
 * POST /api/auth/reset-password
 * 重置密码
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, code, newPassword, userType } = req.body;

    if (!phone || !code || !newPassword || !userType) {
      return res.status(400).json({
        success: false,
        message: '请填写完整信息'
      });
    }

    // 验证密码强度
    const passwordCheck = checkPasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message
      });
    }

    // 验证验证码
    const record = await getCode(`reset_${phone}`);

    if (!record || record.code !== code || record.userType !== userType) {
      return res.status(400).json({
        success: false,
        message: '验证码错误或已过期'
      });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    let table = userType === 'rider' ? 'riders' : 'merchants';
    await pool.query(
      `UPDATE ${table} SET password = ? WHERE id = ?`,
      [hashedPassword, record.userId]
    );

    // 清除验证码
    await deleteCode(`reset_${phone}`);

    // 撤销所有Token
    await revokeRefreshToken(record.userId, userType);

    res.json({
      success: true,
      message: '密码重置成功，请使用新密码登录'
    });

  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(500).json({ success: false, message: '重置失败' });
  }
});

// ============================================================
// 修改密码
// ============================================================

/**
 * POST /api/auth/change-password
 * 修改密码（需要登录）
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const { id, type } = req.user;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '请填写完整信息'
      });
    }

    // 验证新密码强度
    const passwordCheck = checkPasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message
      });
    }

    // 获取当前密码
    let table = type === 'rider' ? 'riders' : type === 'merchant' ? 'merchants' : 'admins';
    const [users] = await pool.query(
      `SELECT password FROM ${table} WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 验证旧密码
    const isValid = await bcrypt.compare(oldPassword, users[0].password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: '原密码错误'
      });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    await pool.query(
      `UPDATE ${table} SET password = ? WHERE id = ?`,
      [hashedPassword, id]
    );

    // 撤销所有Token（强制重新登录）
    await revokeRefreshToken(id, type);

    res.json({
      success: true,
      message: '密码修改成功，请重新登录'
    });

  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({ success: false, message: '修改失败' });
  }
});

// ============================================================
// 辅助函数
// ============================================================

/**
 * 验证手机号格式（中国大陆）
 */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

/**
 * 检查密码强度
 */
function checkPasswordStrength(password) {
  if (password.length < 8) {
    return { valid: false, message: '密码长度至少8位' };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含字母' };
  }

  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含数字' };
  }

  return { valid: true };
}

/**
 * 记录登录失败
 */
async function recordFailedLogin(account, userType, req) {
  // 记录到登录失败日志表
  await pool.query(
    `INSERT INTO login_failures (account, user_type, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [account, userType, req.ip, req.get('user-agent')]
  );

  // 检查是否需要锁定账号
  const [failures] = await pool.query(
    `SELECT COUNT(*) as count FROM login_failures
     WHERE account = ? AND user_type = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
    [account, userType]
  );

  if (failures[0].count >= 5) {
    // 锁定账号30分钟
    let table = userType === 'rider' ? 'riders' : userType === 'merchant' ? 'merchants' : 'admins';
    await pool.query(
      `UPDATE ${table} SET status = 'locked', locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE phone = ? OR username = ?`,
      [account, account]
    );
  }
}

/**
 * 记录操作日志
 */
async function logOperation(userId, userType, action, targetType, targetId, details, req) {
  try {
    await pool.query(
      `INSERT INTO operation_logs (user_id, user_type, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [userId, userType, action, targetType, targetId, JSON.stringify(details), req.ip, req.get('user-agent')]
    );
  } catch (error) {
    console.error('记录操作日志失败:', error);
  }
}

module.exports = router;
