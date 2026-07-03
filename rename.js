"use strict";

/**
 * 盐阜配送 - 项目改名脚本
 * 从 盐阜/kuailv -> 盐阜/yanfu
 * 数据库表和数据保持原样不动
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/www/wwwroot/yanfu_backend';

// 要处理的文件（相对路径）
const FILES = [
  'package.json',
  'app.js',
  'ecosystem.config.js',
  'config/ai_modules.js',
  'config/database.js',
  'docker-compose.yml',
  'README.md',
  'CHANGELOG.md',
  'RELEASE_CHECKLIST.md',
  '.env',
  '.env.example',
  'Dockerfile',
  '.github/workflows/ci.yml',
  'routes/merchant.js',
  'routes/user.js',
  'routes/rider.js',
  'routes/wallet.js',
  'routes/admin.js',
  'services/settlement.js',
  'services/report-pdf.js',
  'services/websocket.js',
  'services/payment.js',
  'services/ai_init.js',
  'tests/setup.js',
  'debug_start.sh',
  'deploy-nginx.sh',
  '部署手册.md',
];

// ============ 替换规则 ============
// 注意：替换顺序很重要，先替换长匹配，再替换短匹配

const REPLACEMENTS = [
  // 中文名称
  { pattern: /盐阜配送/g, replace: '盐阜配送' },
  { pattern: /盐阜后端/g, replace: '盐阜后端' },
  { pattern: /盐阜/g, replace: '盐阜' },

  // 英文名称（关键在数据库配置中保持 DB_NAME=kuailv）
  // 先处理包含路径/文件名的
  { pattern: /yanfu_backend/g, replace: 'yanfu_backend' },

  // JSON 中的值
  { pattern: /"yanfu-backend"/g, replace: '"yanfu-backend"' },
  { pattern: /'yanfu-backend'/g, replace: "'yanfu-backend'" },

  // package.json 中的名称
  { pattern: /"name": "yanfu-backend"/g, replace: '"name": "yanfu-backend"' },
  { pattern: /"description": "盐阜配送/g, replace: '"description": "盐阜配送' },

  // 日志路径中的 kuailv 前缀
  { pattern: /yanfu-backend-error/g, replace: 'yanfu-backend-error' },
  { pattern: /yanfu-backend-out/g, replace: 'yanfu-backend-out' },

  // 产品英文名（驼峰）
  { pattern: /Yanfu(?![A-Za-z])/g, replace: 'Yanfu' },

  // rust 后端
  { pattern: /kuailv-rust-backend/g, replace: 'yanfu-rust-backend' },
  { pattern: /yanfu_rust_backend/g, replace: 'yanfu_rust_backend' },

  // 管理后台 web 目录
  { pattern: /kuailv_admin_web/g, replace: 'yanfu_admin_web' },

  // 环境变量中的 kuailv（保留值，只改 key）
  { pattern: /(KUAILV_)/g, replace: 'YANFU_' },
];

// 数据库相关替换规则 - 这些只改 key 名，不改 value
const DB_KEY_REPLACEMENTS = [
  // .env 和 ai_modules.js 中的数据库配置 key
  // 注意：只替换 key 名部分，不替换值
  { pattern: /KUAILV_DB_HOST/g, replace: 'YANFU_DB_HOST' },
  { pattern: /KUAILV_DB_PORT/g, replace: 'YANFU_DB_PORT' },
  { pattern: /KUAILV_DB_USER/g, replace: 'YANFU_DB_USER' },
  { pattern: /KUAILV_DB_PASSWORD/g, replace: 'YANFU_DB_PASSWORD' },
  { pattern: /KUAILV_DB_NAME/g, replace: 'YANFU_DB_NAME' },
  { pattern: /KUAILV_DB_CONNECTION_LIMIT/g, replace: 'YANFU_DB_CONNECTION_LIMIT' },
  { pattern: /KUAILV_LOG_LEVEL/g, replace: 'YANFU_LOG_LEVEL' },
  { pattern: /KUAILV_LOG_DIR/g, replace: 'YANFU_LOG_DIR' },
];

let changed = 0;

function processFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  SKIP (not found): ${relPath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  let original = content;

  // 应用产品名替换
  for (const r of REPLACEMENTS) {
    content = content.replace(r.pattern, r.replace);
  }

  // 应用数据库 key 替换
  for (const r of DB_KEY_REPLACEMENTS) {
    content = content.replace(r.pattern, r.replace);
  }

  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf-8');
    changed++;
    console.log(`  UPDATED: ${relPath}`);
  } else {
    console.log(`  UNCHANGED: ${relPath}`);
  }
}

console.log('=== 开始改名: 盐阜/kuailv → 盐阜/yanfu ===\n');

for (const f of FILES) {
  processFile(f);
}

// ============ 处理数据库中的商家名 ============
console.log('\n=== 更新商家名称 ===');
try {
  execSync(
    `mysql -uroot -proot123 kuailv -e "UPDATE merchants SET name = REPLACE(name, '测试快餐店', '测试快餐店(亭湖)') WHERE id = 1;" 2>/dev/null`,
    { stdio: 'pipe' }
  );
  console.log('  UPDATED: merchant names');
} catch(e) { /* merchant names are just display names, OK to fail */ }

// ============ 重命名项目目录 ============
console.log('\n=== 重命名目录 ===');
const newRoot = '/www/wwwroot/yanfu_backend';
if (!fs.existsSync(newRoot)) {
  // 使用 cp -a 复制, 然后更新 .env 中的路径
  try {
    execSync(`cp -a ${ROOT} ${newRoot}`, { stdio: 'pipe' });
    console.log(`  COPIED: ${ROOT} -> ${newRoot}`);
  } catch(e) {
    console.log(`  COPY FAILED: ${e.message}`);
  }
} else {
  console.log(`  EXISTS: ${newRoot}`);
}

// ============ 更新 .env 中的路径引用 ============
const envPath = path.join(newRoot, '.env');
if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/yanfu_backend/g, 'yanfu_backend');
  fs.writeFileSync(envPath, envContent, 'utf-8');
  console.log('  UPDATED: .env paths');
}

console.log(`\n=== 完成: ${changed} 个文件已更新 ===`);
console.log('=== 重启服务: cd /www/wwwroot/yanfu_backend && pm2 start ecosystem.config.js ===');
