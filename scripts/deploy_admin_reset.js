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
 * 管理员密码重置 - 完整解决方案
 * 
 * 用法:
 *   服务器上运行: node scripts/deploy_admin_reset.js
 *   或单命令: node -e "require('bcryptjs').hash('UFiDp&IyrDhzWg62',10).then(h=>{const fs=require('fs'),p=require('path');let e=fs.readFileSync(p.join(__dirname,'.env'),'utf8').replace(/^ADMIN_PASSWORD=.*$/m,'ADMIN_PASSWORD='+h);fs.writeFileSync(p.join(__dirname,'.env'),e);console.log('✅ 管理员密码已更新');console.log('用户: admin / 密码: UFiDp&IyrDhzWg62')})"
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const NEW_PASSWORD = 'UFiDp&IyrDhzWg62';
const ENV_FILE = path.join(__dirname, '..', '.env');

async function reset() {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  let env = fs.readFileSync(ENV_FILE, 'utf8');
  env = env.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${hash}`);
  env = env.replace(/^# 旧密码: .*$/m, `# 旧密码已废弃 (更新日期: 2026-06-04)`);
  fs.writeFileSync(ENV_FILE, env, 'utf8');
  console.log('✅ .env 管理员密码已更新');
  console.log('━━━━━━━━━━━━━━━━━━━━━');
  console.log('  用户名: admin');
  console.log(`  密  码: ${NEW_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━');
  console.log('请执行 pm2 restart app 重启后端');
}

reset().catch(console.error);
