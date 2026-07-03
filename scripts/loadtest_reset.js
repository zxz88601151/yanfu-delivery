/**
 * Reset test data: reset balances, clear old test orders, reset coupons
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: 'localhost', user: 'root',
  password: '[DBCONFIG]', database: 'kuailv'
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('=== Resetting test data ===\n');

  // 1. Get test user IDs
  const [testUsers] = await conn.query("SELECT id FROM users WHERE phone LIKE '1990000%'");
  const userIds = testUsers.map(u => u.id);
  console.log(`[1] Found ${userIds.length} test users`);

  if (userIds.length > 0) {
    const idList = userIds.join(',');

    // 2. Delete old test orders
    const [orderItems] = await conn.query(`DELETE FROM merchant_order_items WHERE order_id IN (SELECT id FROM merchant_orders WHERE user_id IN (${idList}))`);
    console.log(`[2] Deleted ${orderItems.affectedRows} test order items`);

    const [payments] = await conn.query(`DELETE FROM payments WHERE user_id IN (${idList})`);
    console.log(`    Deleted ${payments.affectedRows} test payments`);

    const [riderOrders] = await conn.query(`DELETE FROM rider_orders WHERE order_no IN (SELECT order_no FROM merchant_orders WHERE user_id IN (${idList}))`);
    console.log(`    Deleted ${riderOrders.affectedRows} test rider orders`);

    const [orders] = await conn.query(`DELETE FROM merchant_orders WHERE user_id IN (${idList})`);
    console.log(`    Deleted ${orders.affectedRows} test merchant orders`);

    // 3. Reset user balances
    await conn.query(`UPDATE users SET balance = 500.00 WHERE id IN (${idList})`);
    console.log(`[3] Reset ${userIds.length} user balances to 500.00`);

    // 4. Reset user coupons (mark unused)
    await conn.query(`UPDATE user_coupons SET is_used = 0, used_at = NULL, order_id = NULL WHERE user_id IN (${idList})`);
    console.log(`[4] Reset user coupons to unused`);
  }

  // 5. Reset rider orders status
  const [resetRiders] = await conn.query("UPDATE rider_orders SET status='pending', rider_id=NULL WHERE status != 'completed' AND status != 'delivering'");
  console.log(`[5] Reset ${resetRiders.affectedRows} pending rider orders`);

  // Verify clean state
  const [remainOrders] = await conn.query("SELECT COUNT(*) as cnt FROM merchant_orders WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1990000%')");
  console.log(`\nRemaining test orders: ${remainOrders[0].cnt}`);

  const [balance] = await conn.query("SELECT AVG(balance) as avg_bal FROM users WHERE phone LIKE '1990000%'");
  console.log(`Average test user balance: ${balance[0].avg_bal}`);

  const [coupons] = await conn.query("SELECT COUNT(*) as cnt FROM user_coupons WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '1990000%') AND is_used=0");
  console.log(`Unused test coupons: ${coupons[0].cnt}`);

  await conn.end();
  console.log('\n=== Reset complete ===');
}

main().catch(e => { console.error(e); process.exit(1); });
