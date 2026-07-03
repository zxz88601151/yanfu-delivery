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
 * 盐阜配送 - 压力测试数据清理
 * 清理所有测试数据，恢复服务器正常状态
 */
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'localhost', user: 'root',
  password: 'Yanfu@2026!Secure', database: 'kuailv'
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('=== 压力测试数据清理 ===\n');

  // 1. Get test user IDs
  const [testUsers] = await conn.query("SELECT id FROM users WHERE phone LIKE '1990000%'");
  const userIds = testUsers.map(u => u.id);
  console.log(`[1] Found ${userIds.length} test users`);

  if (userIds.length > 0) {
    const idChunks = [];
    for (let i = 0; i < userIds.length; i += 500) {
      idChunks.push(userIds.slice(i, i + 500).join(','));
    }

    // 2. Delete test data in correct order
    console.log('[2] Deleting test data...');
    
    for (const chunk of idChunks) {
      // Rider orders for test orders
      const [ro] = await conn.query(`DELETE FROM rider_orders WHERE order_no IN (SELECT order_no FROM merchant_orders WHERE user_id IN (${chunk}))`);
      console.log(`    rider_orders deleted: ${ro.affectedRows}`);

      // Payments
      const [pm] = await conn.query(`DELETE FROM payments WHERE user_id IN (${chunk})`);
      console.log(`    payments deleted: ${pm.affectedRows}`);

      // Merchant order items
      const [oi] = await conn.query(`DELETE FROM merchant_order_items WHERE order_id IN (SELECT id FROM merchant_orders WHERE user_id IN (${chunk}))`);
      console.log(`    merchant_order_items deleted: ${oi.affectedRows}`);

      // Merchant orders
      const [mo] = await conn.query(`DELETE FROM merchant_orders WHERE user_id IN (${chunk})`);
      console.log(`    merchant_orders deleted: ${mo.affectedRows}`);

      // User coupons
      const [uc] = await conn.query(`DELETE FROM user_coupons WHERE user_id IN (${chunk})`);
      console.log(`    user_coupons deleted: ${uc.affectedRows}`);
    }

    // 3. Delete stress test coupon templates
    const [cc] = await conn.query("DELETE FROM coupons WHERE code LIKE 'STRESS_%'");
    console.log(`    stress coupon templates deleted: ${cc.affectedRows}`);

    // 4. Reset rider orders
    const [rr] = await conn.query("UPDATE rider_orders SET status='pending', rider_id=NULL WHERE status NOT IN ('completed','delivering')");
    console.log(`    rider_orders reset to pending: ${rr.affectedRows}`);

    // 5. Delete test users
    const [du] = await conn.query(`DELETE FROM users WHERE phone LIKE '1990000%'`);
    console.log(`    test users deleted: ${du.affectedRows}`);
  }

  // 6. Reset MySQL max_connections to safe value
  await conn.query("SET GLOBAL max_connections = 200");
  const [mx] = await conn.query("SHOW VARIABLES LIKE 'max_connections'");
  console.log(`\n[3] MySQL max_connections -> ${mx[0].Value}`);

  // 7. Verify clean state
  const [remain] = await conn.query("SELECT COUNT(*) as cnt FROM users WHERE phone LIKE '1990000%'");
  const [orders] = await conn.query("SELECT COUNT(*) as cnt FROM merchant_orders WHERE user_id NOT IN (SELECT id FROM users)");
  const [coupons] = await conn.query("SELECT COUNT(*) as cnt FROM coupons WHERE code LIKE 'STRESS_%'");
  const [threads] = await conn.query("SHOW STATUS LIKE 'Threads_connected'");

  console.log('\n[4] Verification:');
  console.log(`    Remaining test users: ${remain[0].cnt}`);
  console.log(`    Orphan orders: ${orders[0].cnt}`);
  console.log(`    Stress coupons: ${coupons[0].cnt}`);
  console.log(`    Active DB threads: ${threads[0].Value}`);

  await conn.end();
  console.log('\n=== Cleanup complete ===');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
