/**
 * 管理员密码重置脚本
 * 用法: node scripts/reset_admin.js
 * 功能: 自动更新 .env 中的管理员密码哈希，需在服务器上运行
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ENV_PATH = path.join(__dirname, '..', '.env');
const NEW_PASSWORD = '[管理员密码-请查看.env]';
const SALT_ROUNDS = 10;

async function main() {
  // 1. 生成哈希
  const hash = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);
  console.log(`新密码: ${NEW_PASSWORD}`);
  console.log(`新哈希: ${hash}`);

  // 2. 读取 .env
  let envContent = fs.readFileSync(ENV_PATH, 'utf8');

  // 3. 替换 ADMIN_PASSWORD 行
  envContent = envContent.replace(
    /^ADMIN_PASSWORD=.*$/m,
    `ADMIN_PASSWORD=${hash}`
  );

  // 4. 更新旧密码注释
  const now = new Date().toISOString().split('T')[0];
  envContent = envContent.replace(
    /^# 旧密码: .*$/m,
    `# 旧密码已废弃 (更新日期: ${now})`
  );

  // 5. 写入
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  console.log('\n✅ .env 已更新');
  console.log(`📝 管理员用户名: admin`);
  console.log(`🔑 新密码: ${NEW_PASSWORD}`);
}

main().catch(console.error);
