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
 * 盐阜配送 - 压测数据初始化脚本
 * 在服务器上直接运行：node /tmp/loadtest_init.js
 * 功能：
 *   1. 用 bcryptjs 正确生成密码哈希并更新 50 用户 + 50 骑手 + 商家
 *   2. 确保 50+ 骑手在线
 *   3. 为每个新用户创建优惠券
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: 'Yanfu@2026!Secure',
  database: 'kuailv'
};

const PASSWORD = 'test123456';

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('=== 盐阜压测数据初始化 ===\n');

  // 1. Generate proper bcrypt hash
  const hash = await bcrypt.hash(PASSWORD, 10);
  console.log(`[1] 密码哈希生成: ${hash.substring(0, 30)}... (长度=${hash.length})`);

  // Verify hash works
  const testMatch = await bcrypt.compare(PASSWORD, hash);
  console.log(`    验证: bcrypt.compare("${PASSWORD}", hash) = ${testMatch}`);
  if (!testMatch) {
    console.error('哈希验证失败，中止');
    process.exit(1);
  }

  // 2. Create/update 50 test users
  console.log('\n[2] 创建 50 个测试用户...');
  let userCount = 0;
  for (let i = 1; i <= 50; i++) {
    const phone = `1990000${String(i).padStart(4, '0')}`;
    const name = `压测用户${String(i).padStart(2, '0')}`;
    const [result] = await conn.query(
      `INSERT INTO users (name, phone, password, balance, created_at)
       VALUES (?, ?, ?, 500.00, NOW())
       ON DUPLICATE KEY UPDATE name=?, password=?, balance=500.00`,
      [name, phone, hash, name, hash]
    );
    userCount++;
  }
  console.log(`    ✅ ${userCount} 个用户已创建/更新`);

  // 3. Ensure 50+ riders online
  console.log('\n[3] 确保 50+ 骑手在线...');
  await conn.query("UPDATE riders SET status='online' WHERE status != 'online' LIMIT 10");
  // Distribute pool types
  await conn.query(`
    UPDATE riders SET pool_type = CASE
      WHEN id % 3 = 0 THEN 'advanced'
      WHEN id % 3 = 1 THEN 'intermediate'
      ELSE 'newbie'
    END WHERE status = 'online'
  `);
  // Update rider passwords
  const [onlineRiders] = await conn.query("SELECT id FROM riders WHERE status='online' LIMIT 50");
  for (const rider of onlineRiders) {
    await conn.query("UPDATE riders SET password=? WHERE id=?", [hash, rider.id]);
  }
  console.log(`    ✅ ${onlineRiders.length} 个在线骑手密码已更新`);

  // Update merchant passwords (top 20 with menu items)
  console.log('\n[4] 更新商家密码...');
  const [merchants] = await conn.query(`
    SELECT DISTINCT m.id FROM merchants m
    JOIN merchant_menu mi ON m.id = mi.merchant_id
    LIMIT 20
  `);
  for (const m of merchants) {
    await conn.query("UPDATE merchants SET password=? WHERE id=?", [hash, m.id]);
  }
  console.log(`    ✅ ${merchants.length} 个商家密码已更新`);

  // 5. Create coupons for each test user
  console.log('\n[5] 为测试用户创建优惠券...');

  // Step A: Create 4 platform coupon templates in `coupons` table
  const couponTemplates = [
    { name: '新人满减券', code: 'LOADTEST_NEWUSER5', discount_type: 'fixed', discount_value: 5, threshold: 20, qty: 200, desc: '满20减5 新人专享' },
    { name: '满30减8券', code: 'LOADTEST_MAN30J8', discount_type: 'fixed', discount_value: 8, threshold: 30, qty: 200, desc: '满30减8 限时优惠' },
    { name: '免配送费券', code: 'LOADTEST_FREESHIP', discount_type: 'fixed', discount_value: 5, threshold: 15, qty: 200, desc: '满15免配送费' },
    { name: '满50减15券', code: 'LOADTEST_MAN50J15', discount_type: 'fixed', discount_value: 15, threshold: 50, qty: 200, desc: '满50减15 大额优惠' },
  ];

  const startDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  const couponIds = [];
  for (const tmpl of couponTemplates) {
    const [result] = await conn.query(
      `INSERT INTO coupons (code, name, type, merchant_id, discount_type, discount_value, threshold_amount,
       total_quantity, remaining_quantity, per_user_limit, start_time, end_time, status, created_at)
       VALUES (?, ?, 'platform', NULL, ?, ?, ?, ?, ?, 1, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE remaining_quantity=VALUES(remaining_quantity), status='active'`,
      [tmpl.code, tmpl.name, tmpl.discount_type, tmpl.discount_value, tmpl.threshold,
       tmpl.qty, tmpl.qty, startDate, endDate]
    );
    const cid = result.insertId || null;
    if (cid) {
      couponIds.push(cid);
    } else {
      // Was updated, get existing id
      const [rows] = await conn.query("SELECT id FROM coupons WHERE code=?", [tmpl.code]);
      couponIds.push(rows[0].id);
    }
    console.log(`    创建优惠券模板: ${tmpl.name} (id=${couponIds[couponIds.length-1]})`);
  }

  // Step B: Link coupons to each test user via `user_coupons` table
  const [testUsers] = await conn.query("SELECT id FROM users WHERE phone LIKE '1990000%'");
  let totalCoupons = 0;

  // Clean old entries first
  const testUserIds = testUsers.map(u => u.id);
  if (testUserIds.length > 0) {
    await conn.query(`DELETE FROM user_coupons WHERE user_id IN (${testUserIds.join(',')})`);
  }

  for (const user of testUsers) {
    for (const couponId of couponIds) {
      await conn.query(
        `INSERT INTO user_coupons (user_id, coupon_id, merchant_id, is_used, expire_at, created_at)
         VALUES (?, ?, NULL, 0, ?, NOW())`,
        [user.id, couponId, endDate]
      );
      totalCoupons++;
    }
  }
  console.log(`    ✅ 为 ${testUsers.length} 个用户各发放 ${couponIds.length} 张优惠券 (共 ${totalCoupons} 张)`);

  // 6. Verify everything
  console.log('\n[6] 验证数据...');
  const [uCount] = await conn.query("SELECT COUNT(*) as cnt FROM users WHERE phone LIKE '1990000%'");
  console.log(`    测试用户: ${uCount[0].cnt}`);

  const [rCount] = await conn.query("SELECT COUNT(*) as cnt FROM riders WHERE status='online'");
  console.log(`    在线骑手: ${rCount[0].cnt}`);

  const [rPools] = await conn.query("SELECT pool_type, COUNT(*) as cnt FROM riders WHERE status='online' GROUP BY pool_type");
  console.log(`    骑手池分布: ${rPools.map(r => `${r.pool_type}=${r.cnt}`).join(', ')}`);

  const [cCount] = await conn.query("SELECT COUNT(*) as cnt FROM user_coupons WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1990000%')");
  console.log(`    测试用户优惠券(user_coupons): ${cCount[0].cnt}`);

  // Test login
  const [testUser] = await conn.query("SELECT password FROM users WHERE phone='19900000001'");
  if (testUser.length) {
    const match = await bcrypt.compare(PASSWORD, testUser[0].password);
    console.log(`    用户登录测试: ${match ? '✅ PASS' : '❌ FAIL'}`);
  }

  const [testRider] = await conn.query("SELECT password FROM riders WHERE status='online' LIMIT 1");
  if (testRider.length) {
    const match = await bcrypt.compare(PASSWORD, testRider[0].password);
    console.log(`    骑手登录测试: ${match ? '✅ PASS' : '❌ FAIL'}`);
  }

  const [testMerchant] = await conn.query("SELECT password FROM merchants WHERE id=5");
  if (testMerchant.length && testMerchant[0].password) {
    const match = await bcrypt.compare(PASSWORD, testMerchant[0].password);
    console.log(`    商家登录测试: ${match ? '✅ PASS' : '❌ FAIL'}`);
  }

  await conn.end();
  console.log('\n=== 初始化完成 ===');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
