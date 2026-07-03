'use strict';

/**
 * 盐阜配送平台 - 入口文件（合并版：传统API + AI模块 + 定时任务）
 *
 * @module app
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const { initDatabase } = require('./config/database');
const { initWebSocket } = require('./services/websocket');
const { globalErrorHandler, setupUnhandledRejectionHandler } = require('./middleware/errorHandler');

// ========== 传统API路由 ==========
const authRoutes = require('./routes/auth');
const riderRoutes = require('./routes/rider');
const riderPoolRoutes = require('./routes/rider_pool');
const etaRoutes = require('./routes/eta');
const prepTimeRoutes = require('./routes/prep_time');
const merchantRoutes = require('./routes/merchant');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const reviewRoutes = require('./routes/review');
const refundRoutes = require('./routes/refund');
const paymentRoutes = require('./routes/payment');
const analyticsRoutes = require('./routes/analytics');
const ticketRoutes = require('./routes/ticket');
const versionRoutes = require('./routes/version');
const publicRoutes = require('./routes/public');
const riderMapRoutes = require('./routes/rider-map');
const aiDispatchRoutes = require('./routes/ai_dispatch_api');
const walletRoutes = require('./routes/wallet');
const { runDailySettlement } = require('./services/settlement');

// ========== AI模块路由 ==========
const blindBoxRouter = require('./ai_modules/blind_box/router');
const creditPassportRouter = require('./ai_modules/credit_passport/router');
const carbonCreditRouter = require('./ai_modules/carbon_credit/router');
const riderDispatchRouter = require('./ai_modules/rider_dispatch/router');
const dynamicPricingRouter = require('./ai_modules/dynamic_pricing/router');
const liveMapRouter = require('./ai_modules/live_map/router');
const prePositionRouter = require('./ai_modules/pre_position/router');
const relayDeliveryRouter = require('./ai_modules/relay_delivery/router');

// ========== 进程级错误保护 ==========
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] 未捕获的 Promise 拒绝:', reason?.message || reason);
  console.error(reason?.stack || '');
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获的异常:', err.message);
  console.error(err.stack);
});

const app = express();
const PORT = process.env.PORT || 3001;

// [P0修复] 信任Nginx代理头
app.set('trust proxy', 1);

// ========== 启动检查 ==========
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET 未设置或长度不足32位，请在 .env 文件中配置');
  process.exit(1);
}

// ========== 安全响应头 (Helmet) ==========
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
}));

// ========== CORS 配置 ==========
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const isDevOrWildcard = !allowedOrigins.length || (allowedOrigins.length === 1 && allowedOrigins[0] === '*');

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (isDevOrWildcard) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] 拒绝来源: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Token', 'Cache-Control', 'Pragma'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  optionsSuccessStatus: 200,
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ========== 请求频率限制 ==========
const _limiterOptions = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
};
const authLimiter = rateLimit({ ..._limiterOptions, max: parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS) || 100, message: { success: false, message: '认证请求过于频繁，请稍后再试' } });
const apiLimiter = rateLimit({ ..._limiterOptions, max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200, message: { success: false, message: '请求过于频繁，请稍后再试' } });
const paymentLimiter = rateLimit({ ..._limiterOptions, max: parseInt(process.env.RATE_LIMIT_PAYMENT_MAX_REQUESTS) || 60, message: { success: false, message: '支付请求过于频繁，请稍后再试' } });
const adminLimiter = rateLimit({ ..._limiterOptions, max: parseInt(process.env.RATE_LIMIT_ADMIN_MAX_REQUESTS) || 100, message: { success: false, message: '管理请求过于频繁，请稍后再试' } });
const uploadLimiter = rateLimit({ ..._limiterOptions, max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX_REQUESTS) || 30, message: { success: false, message: '上传请求过于频繁，请稍后再试' } });

// ========== 中间件 ==========
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
const { COPYRIGHT } = require("./config/constants");app.use((req, res, next) => {  res.setHeader("X-Copyright", "(C) Xu Yaping All Rights Reserved");  res.setHeader("X-Copyright-Contact", "QQ: 273442662");  next();});

// ========== 健康检查 ==========
app.get('/health', async (req, res) => {
  const { pool } = require('./config/database');
  try {
    const [r] = await pool.query('SELECT 1 AS ok');
    res.json({ status: "ok", database: "connected", copyright: COPYRIGHT.TEXT, contact: "QQ: " + COPYRIGHT.CONTACT_QQ, uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: e.message, timestamp: new Date().toISOString() });
  }
});

app.get('/ready', async (req, res) => {
  const checks = {};
  let allOk = true;
  try {
    const { pool } = require('./config/database');
    await pool.query('SELECT 1 AS ok');
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'fail';
    allOk = false;
  }
  try {
    const { pool } = require('./config/database');
    const [tables] = await pool.query("SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'kuailv'");
    checks.tables = String(tables[0].cnt) + ' tables';
  } catch (e) {
    checks.tables = 'fail';
    allOk = false;
  }
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ready' : 'not_ready', checks: checks, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ========== 传统API路由挂载 ==========
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rider', apiLimiter, riderRoutes);
app.use('/api/rider', apiLimiter, riderPoolRoutes.router);
app.use('/api/eta', apiLimiter, etaRoutes);
app.use('/api/prep', apiLimiter, prepTimeRoutes);
app.use('/api/merchant', apiLimiter, merchantRoutes);
app.use('/api/user', apiLimiter, userRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/reviews', apiLimiter, reviewRoutes);
app.use('/api/refunds', apiLimiter, refundRoutes);
app.use('/api/payment', paymentLimiter, paymentRoutes);
app.use('/api/admin/analytics', adminLimiter, analyticsRoutes);
app.use('/api/admin/tickets', adminLimiter, ticketRoutes);
app.use('/api/version', apiLimiter, versionRoutes.router);
app.use('/api/rider-map', apiLimiter, riderMapRoutes);
app.use('/api', apiLimiter, publicRoutes);

// AI智能派单系统（使用认证限流器）
app.use('/api/ai', authLimiter, aiDispatchRoutes);
app.use('/api/wallet', authLimiter, walletRoutes.router);

// ========== AI模块路由挂载 ==========
app.use('/api/v2/ai', blindBoxRouter);
app.use('/api/v2/ai', creditPassportRouter);
app.use('/api/v2/ai', carbonCreditRouter);
app.use('/api/v2/ai', riderDispatchRouter);
app.use('/api/v2/ai', dynamicPricingRouter);
app.use('/api/v2/ai/live_map', liveMapRouter);
app.use('/api/v2/ai', prePositionRouter);
app.use('/api/v2/ai/relay_delivery', relayDeliveryRouter);

// ========== 定时任务 ==========

// 动态定价 - 每5分钟全区域定价系数重算
const dynamicPricingService = require('./ai_modules/dynamic_pricing/service');
cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await dynamicPricingService.recalcAllZoneFactors();
    console.log(`[Cron] 动态定价重算完成: 更新${result.updated}个区域, ${result.changed}个显著变化`);
  } catch (err) {
    console.error(`[Cron] 动态定价重算失败: ${err.message}`);
  }
});

// 动态定价 - 每日凌晨3:00生成定价报表快照
cron.schedule('0 3 * * *', async () => {
  try {
    const { reportBuilder } = require('./ai_modules/dynamic_pricing/report-builder');
    const snapshot = await reportBuilder.generateDailySnapshot();
    console.log(`[Cron] 定价报表快照生成完成: ${snapshot.date}`);
  } catch (err) {
    console.error(`[Cron] 定价报表快照失败: ${err.message}`);
  }
});

// 活地图 - 验证扫描（每15秒）
const liveMapService = require('./ai_modules/live_map/service');
cron.schedule('*/15 * * * * *', async () => {
  try {
    await liveMapService.scanPendingReports();
  } catch (err) {
    console.error(`[Cron] 活地图验证扫描失败: ${err.message}`);
  }
});

// 活地图 - 热力图刷新（每2分钟）
cron.schedule('*/2 * * * *', async () => {
  try {
    await liveMapService.refreshHeatmap();
  } catch (err) {
    console.error(`[Cron] 活地图热力图刷新失败: ${err.message}`);
  }
});

// 活地图 - 红区过期扫描（每5分钟）
cron.schedule('*/5 * * * *', async () => {
  try {
    await liveMapService.expireConditions();
  } catch (err) {
    console.error(`[Cron] 活地图红区过期扫描失败: ${err.message}`);
  }
});

// 预置运力 - 预测周期（每10分钟）
const prePositionService = require('./ai_modules/pre_position/service');
cron.schedule('*/10 * * * *', async () => {
  try {
    await prePositionService.runPredictionCycle();
  } catch (err) {
    console.error(`[Cron] 预置运力预测周期失败: ${err.message}`);
  }
});

// 预置运力 - 调度超时扫描（每1分钟）
cron.schedule('* * * * *', async () => {
  try {
    await prePositionService.runTimeoutScan();
  } catch (err) {
    console.error(`[Cron] 预置运力超时扫描失败: ${err.message}`);
  }
});

// 预置运力 - 效果回写（每5分钟）
cron.schedule('*/5 * * * *', async () => {
  try {
    await prePositionService.runWritebackCycle();
  } catch (err) {
    console.error(`[Cron] 预置运力效果回写失败: ${err.message}`);
  }
});

// 协同配送 - 交接超时扫描（每1分钟）
const relayDeliveryService = require('./ai_modules/relay_delivery/service');
cron.schedule('* * * * *', async () => {
  try {
    const result = await relayDeliveryService.scanHandoffTimeouts();
    if (result.escalated > 0) {
      console.log(`[Cron] 接力超时扫描: 检查${result.checked}个, 提醒${result.reminded}个, 升级${result.escalated}个`);
    }
  } catch (err) {
    console.error(`[Cron] 接力超时扫描失败: ${err.message}`);
  }
});

// ========== 自动结算（每日凌晨2:00 T+1） ==========
cron.schedule('0 2 * * *', async () => {
  try {
    const result = await runDailySettlement();
    console.log(`[Cron] 自动结算完成: ${result.settled}个商家, 周期=${result.period}`);
  } catch (err) {
    console.error(`[Cron] 自动结算失败: ${err.message}`);
  }
});

// ========== 全局错误处理 ==========
app.use(globalErrorHandler);

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// ========== 启动服务器 ==========
async function start() {
  let server;
  try {
    // 1) 数据库初始化（生产环境已存在表结构，跳过破坏性 DDL）
    try {
      await initDatabase();
      console.log('Database initialized (migrations applied)');
    } catch (dbErr) {
      console.warn(`[WARN] 数据库初始化跳过（生产环境表已存在）: ${dbErr.message}`);
    }

    setupUnhandledRejectionHandler();

    server = http.createServer(app);
    initWebSocket(server);

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`盐阜后端服务已启动: http://0.0.0.0:${PORT}`);
      console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
      if (isDevOrWildcard) {
        if (process.env.NODE_ENV === 'production') {
          console.error('');
          console.error('╔══════════════════════════════════════════════════════════╗');
          console.error('║  ⚠️  安全警告: 生产环境 CORS 允许所有来源!              ║');
          console.error('║  请在 .env 中配置 ALLOWED_ORIGINS 为具体域名          ║');
          console.error('║  例如: ALLOWED_ORIGINS=https://yourdomain.com        ║');
          console.error('╚══════════════════════════════════════════════════════════╝');
          console.error('');
        } else {
          console.warn('WARNING: CORS 允许所有来源，请在生产环境配置 ALLOWED_ORIGINS');
        }
      }
    });

    // 优雅关闭
    const shutdown = (signal) => {
      console.log(`\n${signal} 收到，正在优雅关闭服务器...`);
      server.close(() => {
        console.log('HTTP 服务器已关闭');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('强制关闭：优雅关闭超时');
        process.exit(1);
      }, 10000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
