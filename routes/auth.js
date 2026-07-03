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
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { 
  validateUserRegister, 
  validateLogin, 
  validateRiderRegister, 
  validateMerchantRegister,
  validateAdminLogin 
} = require('../middleware/validation');

// [P0修复] 管理员登录速率限制（内存方案，15分钟窗口内最多5次失败）
const adminLoginAttempts = new Map(); // { ip: { count, resetAt } }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip);
  if (!record) return true; // 首次尝试
  if (now > record.resetAt) {
    adminLoginAttempts.delete(ip);
    return true;
  }
  return record.count < MAX_ATTEMPTS;
};

const recordFailedAttempt = (ip) => {
  const now = Date.now();
  const record = adminLoginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    adminLoginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MINUTES * 60 * 1000 });
  } else {
    record.count++;
  }
};

const clearRateLimit = (ip) => {
  adminLoginAttempts.delete(ip);
};

// 定时清理过期记录（每10分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of adminLoginAttempts) {
    if (now > record.resetAt) adminLoginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

// 生成JWT
const generateToken = (user, role) => {
  return jwt.sign(
    { id: user.id, phone: user.phone, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

// 手机号格式验证
const isValidPhone = (phone) => /^1[3-9]\d{9}$/.test(phone);

// 密码强度验证（至少6位）
const isValidPassword = (password) => !password || password.length >= 6;

// ========== 骑手接口 ==========

// 骑手注册 - 使用Joi验证
router.post('/rider/register', validateRiderRegister, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    
    // 检查手机号是否已存在
    const [existing] = await pool.query('SELECT id FROM riders WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '手机号已被注册' });
    }

    // 加密密码
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    // 创建骑手（默认进入新手池）
    const [result] = await pool.query(
      'INSERT INTO riders (name, phone, password, pool_type) VALUES (?, ?, ?, ?)',
      [name, phone, hashedPassword, "newbie"]
    );

    const [newRider] = await pool.query('SELECT * FROM riders WHERE id = ?', [result.insertId]);
    
    const token = generateToken(newRider[0], 'rider');
    
    res.json({
      success: true,
      message: '注册成功',
      data: {
        token,
        rider: {
          id: newRider[0].id,
          name: newRider[0].name,
          phone: newRider[0].phone,
          level: newRider[0].level,
          status: newRider[0].status,
          rating: newRider[0].rating,
          todayIncome: newRider[0].today_income,
          monthIncome: newRider[0].month_income,
          balance: newRider[0].balance
        }
      }
    });
  } catch (error) {
    console.error('Rider register error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 骑手登录 - 使用Joi验证
router.post('/rider/login', validateLogin, async (req, res) => {
  try {
    const { phone, password } = req.body;

    const [riders] = await pool.query('SELECT * FROM riders WHERE phone = ?', [phone]);
    
    if (riders.length === 0) {
      return res.status(401).json({ success: false, message: '骑手不存在，请先注册' });
    }

    const rider = riders[0];

    // 强制密码验证
    if (!rider.password) {
      return res.status(401).json({ success: false, message: '账户未设置密码，请使用验证码登录' });
    }
    if (!password) {
      return res.status(401).json({ success: false, message: '请输入密码' });
    }
    const isMatch = await bcrypt.compare(password, rider.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }

    const token = generateToken(rider, 'rider');
    
    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        rider: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          level: rider.level,
          status: rider.status,
          rating: rider.rating,
          todayIncome: rider.today_income,
          monthIncome: rider.month_income,
          balance: rider.balance
        }
      }
    });
  } catch (error) {
    console.error('Rider login error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 商家接口 ==========

// 商家注册 - 使用Joi验证
router.post('/merchant/register', validateMerchantRegister, async (req, res) => {
  try {
    const { name, phone, password, address, category } = req.body;

    const [existing] = await pool.query('SELECT id FROM merchants WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '手机号已被注册' });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const [result] = await pool.query(
      'INSERT INTO merchants (name, phone, password, address, category, is_open) VALUES (?, ?, ?, ?, ?, 1)',
      [name, phone, hashedPassword, address || '', category || '快餐']
    );

    const [newMerchant] = await pool.query('SELECT * FROM merchants WHERE id = ?', [result.insertId]);
    
    const token = generateToken(newMerchant[0], 'merchant');
    
    res.json({
      success: true,
      message: '注册成功',
      data: {
        token,
        merchant: {
          id: newMerchant[0].id,
          name: newMerchant[0].name,
          phone: newMerchant[0].phone,
          address: newMerchant[0].address,
          category: newMerchant[0].category,
          isOpen: newMerchant[0].is_open,
          rating: newMerchant[0].rating,
          todayRevenue: newMerchant[0].today_revenue
        }
      }
    });
  } catch (error) {
    console.error('Merchant register error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 商家登录 - 使用Joi验证
router.post('/merchant/login', validateLogin, async (req, res) => {
  try {
    const { phone, password } = req.body;

    const [merchants] = await pool.query('SELECT * FROM merchants WHERE phone = ?', [phone]);
    
    if (merchants.length === 0) {
      return res.status(401).json({ success: false, message: '商家不存在，请先注册' });
    }

    const merchant = merchants[0];

    // 强制密码验证
    if (!merchant.password) {
      return res.status(401).json({ success: false, message: '账户未设置密码，请使用验证码登录' });
    }
    if (!password) {
      return res.status(401).json({ success: false, message: '请输入密码' });
    }
    const isMatch = await bcrypt.compare(password, merchant.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }

    const token = generateToken(merchant, 'merchant');
    
    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        merchant: {
          id: merchant.id,
          name: merchant.name,
          phone: merchant.phone,
          address: merchant.address,
          category: merchant.category,
          isOpen: merchant.is_open,
          rating: merchant.rating,
          todayRevenue: merchant.today_revenue
        }
      }
    });
  } catch (error) {
    console.error('Merchant login error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 用户接口 ==========

// 用户注册 - 使用Joi验证
router.post('/user/register', validateUserRegister, async (req, res) => {
  try {
    const { name, phone, password, address } = req.body;

    const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '手机号已被注册' });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, default_address) VALUES (?, ?, ?, ?)',
      [name || '', phone, hashedPassword, address || '']
    );

    const [newUser] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    
    const token = generateToken(newUser[0], 'user');
    
    res.json({
      success: true,
      message: '注册成功',
      data: {
        token,
        user: {
          id: newUser[0].id,
          name: newUser[0].name,
          phone: newUser[0].phone,
          avatar: newUser[0].avatar,
          defaultAddress: newUser[0].default_address,
          balance: newUser[0].balance
        }
      }
    });
  } catch (error) {
    console.error('User register error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户登录
router.post('/user/login', validateLogin, async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: '手机号不能为空' });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: '用户不存在，请先注册' });
    }

    const user = users[0];

    // 强制密码验证
    if (!user.password) {
      return res.status(401).json({ success: false, message: '账户未设置密码，请使用验证码登录' });
    }
    if (!password) {
      return res.status(401).json({ success: false, message: '请输入密码' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }

    const token = generateToken(user, 'user');
    
    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          avatar: user.avatar,
          defaultAddress: user.default_address,
          balance: user.balance
        }
      }
    });
  } catch (error) {
    console.error('User login error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 管理员接口 ==========

// 管理员登录
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // [P0修复] 强制使用环境变量，禁止硬编码默认值
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // [P0修复] 验证环境变量是否配置
    if (!adminUsername || !adminPassword) {
      console.error('[P0安全] 管理员账号未配置环境变量');
      return res.status(500).json({ 
        success: false, 
        message: '服务器配置错误' 
      });
    }
    
    // [P0修复] 添加登录失败次数限制（防止暴力破解）
    const clientIp = req.ip || req.connection.remoteAddress;

    // 检查是否被锁定
    if (!checkRateLimit(clientIp)) {
      console.warn(`[P0安全] 管理员登录被锁定: IP=${clientIp}`);
      return res.status(429).json({
        success: false,
        message: `登录尝试过多，请${LOCKOUT_MINUTES}分钟后重试`
      });
    }
    
    if (username !== adminUsername) {
      console.warn(`[P0安全] 管理员登录失败(用户名错误): IP=${clientIp}`);
      recordFailedAttempt(clientIp);
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    // [P0修复] 强制使用bcrypt比较，不再支持明文密码回退
    if (!adminPassword.startsWith('$2b$') && !adminPassword.startsWith('$2a$') && !adminPassword.startsWith('$2y$')) {
      console.error('[P0安全] ADMIN_PASSWORD 环境变量必须为bcrypt哈希，请在 .env 中更新');
      return res.status(500).json({ success: false, message: '服务器配置错误' });
    }
    const passwordValid = await bcrypt.compare(password, adminPassword);
    
    if (!passwordValid) {
      console.warn(`[P0安全] 管理员登录失败(密码错误): IP=${clientIp}`);
      recordFailedAttempt(clientIp);
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    // [P0修复] 登录成功，清除失败计数
    clearRateLimit(clientIp);

    // [P0修复] 记录成功登录日志
    console.info(`[P0安全] 管理员登录成功: IP=${clientIp}, username=${username}`);
    
    const adminUser = { id: 0, phone: 'admin', role: 'admin' };
    const token = generateToken(adminUser, 'admin');
    
    res.json({
      success: true,
      message: '登录成功',
      data: { token }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ========== 修改密码（通用：用户/骑手/商家） ==========
router.post('/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '请先登录' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { id, role } = decoded;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请填写完整信息' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: '新密码至少6位' });
    }

    // 根据角色确定表名
    const table = role === 'rider' ? 'riders' : role === 'merchant' ? 'merchants' : 'users';
    const [rows] = await pool.query(`SELECT password FROM ${table} WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (!rows[0].password) {
      return res.status(400).json({ success: false, message: '账户未设置密码' });
    }

    const isMatch = await bcrypt.compare(oldPassword, rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: '原密码错误' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE ${table} SET password = ? WHERE id = ?`, [newHash, id]);

    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
    }
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

module.exports = router;
