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
 * 盐阜配送 - AI智能调度系统初始化
 * 在 app.js 启动时调用，加载配置并初始化数据库表
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

let initialized = false;

async function initAIModules() {
  if (initialized) return;

  try {
    // 1. 执行AI相关数据库迁移
    await runAIMigrations();

    // 2. 预加载配置(验证配置文件完整性)
    const config = require('../config/ai_dispatch');
    if (!config.RISK_CONFIG || !config.ROUTE_CONFIG || !config.PREDICT_CONFIG) {
      throw new Error('AI配置文件缺少必要配置项');
    }

    console.log('[AI] 风控系统 配置加载完成, 阈值:', {
      block: config.RISK_CONFIG.THRESHOLD_BLOCK,
      review: config.RISK_CONFIG.THRESHOLD_REVIEW,
      autoBlacklist: config.RISK_CONFIG.AUTO_BLACKLIST_COUNT + '次/' + config.RISK_CONFIG.AUTO_BLACKLIST_HOURS + 'h',
      failOpen: config.RISK_CONFIG.FAIL_OPEN,
    });
    console.log('[AI] 路径优化 配置加载完成, 最大配送点数:', config.ROUTE_CONFIG.MAX_DELIVERIES, '监测间隔:', config.ROUTE_CONFIG.MONITOR_INTERVAL_SECONDS + 's');
    console.log('[AI] 需求预测 配置加载完成, 每日预测:', config.PREDICT_CONFIG.DAILY_PREDICT_HOUR + ':00, 历史天数:', config.PREDICT_CONFIG.HISTORY_DAYS);

    initialized = true;
    console.log('[AI] 所有AI模块初始化完成');
  } catch (error) {
    console.error('[AI] 模块初始化失败:', error.message);
    throw error;
  }
}

async function runAIMigrations() {
  const migrationFile = path.join(__dirname, '..', 'migrations', '015_kuailv_ai_tables.sql');

  if (!fs.existsSync(migrationFile)) {
    console.warn('[AI] 迁移文件不存在:', migrationFile);
    return;
  }

  const sql = fs.readFileSync(migrationFile, 'utf8');
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('Duplicate')) {
        console.warn('[AI] 迁移警告:', e.message.substring(0, 100));
      }
    }
  }
  console.log('[AI] 数据库表迁移完成');
}

// 检查模块是否已初始化
function isInitialized() {
  return initialized;
}

module.exports = { initAIModules, isInitialized };
