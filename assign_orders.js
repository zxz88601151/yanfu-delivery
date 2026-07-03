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

const m = require('mysql2/promise');
async function run() {
  const c = await m.createConnection({host:'localhost',user:'shujuku',password:'jm3d7apzjMaAL5wM',database:'shujuku'});

  const [orders] = await c.query(
    'SELECT ro.id, ro.order_no, ro.rider_id FROM rider_orders ro WHERE ro.status="completed" GROUP BY ro.rider_id ORDER BY RAND() LIMIT 50'
  );

  let updated = 0;
  for (const o of orders) {
    const pickupLat = 33.35 + Math.random() * 0.05;
    const pickupLng = 120.08 + Math.random() * 0.10;
    const deliverLat = 33.35 + Math.random() * 0.05;
    const deliverLng = 120.08 + Math.random() * 0.10;

    await c.query("UPDATE rider_orders SET status='picking', pickup_latitude=?, pickup_longitude=?, delivery_latitude=?, delivery_longitude=? WHERE id=?", 
      [pickupLat, pickupLng, deliverLat, deliverLng, o.id]);
    await c.query("UPDATE orders SET status='delivering' WHERE order_no=?", [o.order_no]);
    await c.query("UPDATE merchant_orders SET status='delivering' WHERE order_no=?", [o.order_no]);
    updated++;
  }

  console.log('已分配 ' + updated + ' 条配送中订单');
  const [s1] = await c.query("SELECT COUNT(DISTINCT rider_id) as active FROM rider_orders WHERE status='picking'");
  console.log('活跃骑手: ' + s1[0].active + ' 人');
  await c.end();
}
run().catch(e=>{console.error(e.message);process.exit(1);});
