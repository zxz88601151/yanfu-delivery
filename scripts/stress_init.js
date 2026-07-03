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
 * 盐阜配送 - 极限压力测试初始化
 * 渐进式创建测试账号: 100/200/300/500 用户
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'localhost', user: 'root',
  password: 'Yanfu@2026!Secure', database: 'kuailv'
};
const PASSWORD = 'test123456';

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('=== 极限压测数据初始化 ===\n');

  // 1. Increase MySQL max_connections
  const targetMaxConn = 500;
  await conn.query(`SET GLOBAL max_connections = ${targetMaxConn}`);
  const [maxResult] = await conn.query("SHOW VARIABLES LIKE 'max_connections'");
  console.log(`[1] MySQL max_connections -> ${maxResult[0].Value}`);

  // 2. Generate hash
  const hash = await bcrypt.hash(PASSWORD, 10);
  console.log(`[2] Password hash OK (len=${hash.length})`);

  // 3. Create/update test users in batches
  const batches = [100, 200, 300, 500];
  const maxUsers = batches[batches.length - 1];

  console.log(`\n[3] Creating ${maxUsers} test users...`);
  let created = 0;
  for (let i = 1; i <= maxUsers; i++) {
    const phone = `1990000${String(i).padStart(4, '0')}`;
    const name = `压测用户${String(i).padStart(3, '0')}`;
    await conn.query(
      `INSERT INTO users (name, phone, password, balance, created_at)
       VALUES (?, ?, ?, 1000.00, NOW())
       ON DUPLICATE KEY UPDATE password=?, balance=1000.00`,
      [name, phone, hash, hash]
    );
    created++;
    if (created % 100 === 0) console.log(`    ... ${created} users created`);
  }
  console.log(`    OK: ${created} users`);

  // 4. Ensure 200+ riders online with correct passwords
  console.log(`\n[4] Setting up riders...`);
  // Set more riders online
  await conn.query("UPDATE riders SET status='online' WHERE status != 'online' LIMIT 50");
  const [onlineRiders] = await conn.query("SELECT id FROM riders WHERE status='online' ORDER BY id");
  console.log(`    Online riders: ${onlineRiders.length}`);
  
  // Update ALL rider passwords
  for (const r of onlineRiders) {
    await conn.query("UPDATE riders SET password=? WHERE id=?", [hash, r.id]);
  }
  console.log(`    Updated ${onlineRiders.length} rider passwords`);

  // Ensure pool distribution
  await conn.query(`UPDATE riders SET pool_type = CASE
    WHEN id % 3 = 0 THEN 'advanced'
    WHEN id % 3 = 1 THEN 'intermediate'
    ELSE 'newbie'
  END WHERE status = 'online'`);

  // 5. Update ALL merchants with menu items
  console.log(`\n[5] Updating merchant passwords...`);
  const [merchants] = await conn.query(
    `SELECT DISTINCT m.id, m.name, m.phone FROM merchants m
     JOIN merchant_menu mi ON m.id = mi.merchant_id ORDER BY m.id`
  );
  for (const m of merchants) {
    await conn.query("UPDATE merchants SET password=? WHERE id=?", [hash, m.id]);
  }
  console.log(`    Updated ${merchants.length} merchant passwords`);

  // 6. Create coupon templates with high quantity
  console.log(`\n[6] Creating coupon templates...`);
  const couponTemplates = [
    { name: '新人满减券', code: 'STRESS_NEW5', discount_type: 'fixed', discount_value: 5, threshold: 20, qty: 2000 },
    { name: '满30减8券', code: 'STRESS_M30J8', discount_type: 'fixed', discount_value: 8, threshold: 30, qty: 2000 },
    { name: '免配送费券', code: 'STRESS_FREESHIP', discount_type: 'fixed', discount_value: 5, threshold: 15, qty: 2000 },
    { name: '满50减15券', code: 'STRESS_M50J15', discount_type: 'fixed', discount_value: 15, threshold: 50, qty: 2000 },
  ];
  const endDate = new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0,19).replace('T',' ');
  const startDate = new Date().toISOString().slice(0,19).replace('T',' ');
  
  const couponIds = [];
  for (const t of couponTemplates) {
    const [r] = await conn.query(
      `INSERT INTO coupons (code, name, type, merchant_id, discount_type, discount_value, threshold_amount,
       total_quantity, remaining_quantity, per_user_limit, start_time, end_time, status, created_at)
       VALUES (?, ?, 'platform', NULL, ?, ?, ?, ?, ?, 1, ?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE remaining_quantity=VALUES(remaining_quantity), status='active'`,
      [t.code, t.name, t.discount_type, t.discount_value, t.threshold, t.qty, t.qty, startDate, endDate]
    );
    const cid = r.insertId || (await conn.query("SELECT id FROM coupons WHERE code=?", [t.code]))[0][0].id;
    couponIds.push(cid);
    console.log(`    ${t.name} id=${cid}`);
  }

  // 7. Distribute coupons to test users
  console.log(`\n[7] Distributing coupons to ${maxUsers} users...`);
  const [testUsers] = await conn.query("SELECT id FROM users WHERE phone LIKE '1990000%' ORDER BY id");
  
  // Clean old coupon assignments
  const idList = testUsers.map(u => u.id).join(',');
  await conn.query(`DELETE FROM user_coupons WHERE user_id IN (${idList})`);
  
  let totalCoupons = 0;
  for (const user of testUsers) {
    for (const cid of couponIds) {
      await conn.query(
        `INSERT INTO user_coupons (user_id, coupon_id, merchant_id, is_used, expire_at, created_at)
         VALUES (?, ?, NULL, 0, ?, NOW())`,
        [user.id, cid, endDate]
      );
      totalCoupons++;
    }
    if (totalCoupons % 500 === 0) console.log(`    ... ${totalCoupons} coupons`);
  }
  console.log(`    OK: ${totalCoupons} coupons distributed`);

  // 8. Summary
  console.log('\n[8] Summary:');
  const [uc] = await conn.query("SELECT COUNT(*) as cnt FROM users WHERE phone LIKE '1990000%'");
  const [rc] = await conn.query("SELECT COUNT(*) as cnt FROM riders WHERE status='online'");
  const [rp] = await conn.query("SELECT pool_type, COUNT(*) as cnt FROM riders WHERE status='online' GROUP BY pool_type");
  const [mc] = await conn.query("SELECT COUNT(DISTINCT merchant_id) as cnt FROM merchant_menu");
  const [cc] = await conn.query("SELECT COUNT(*) as cnt FROM user_coupons WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1990000%')");
  const [mx] = await conn.query("SHOW VARIABLES LIKE 'max_connections'");
  
  console.log(`    Test users: ${uc[0].cnt}`);
  console.log(`    Online riders: ${rc[0].cnt} (${rp.map(r => `${r.pool_type}=${r.cnt}`).join(', ')})`);
  console.log(`    Merchants with menu: ${mc[0].cnt}`);
  console.log(`    Coupons distributed: ${cc[0].cnt}`);
  console.log(`    MySQL max_connections: ${mx[0].Value}`);

  await conn.end();
  console.log('\n=== Init complete ===');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
