/**
 * 骑手位置模拟脚本 - 持续运行
 * 每3秒更新一次骑手位置
 * 配送中骑手沿路线移动，空闲骑手随机漫步
 */
const m = require('mysql2/promise');
const DB = { host:'localhost', user:'shujuku', password:'jm3d7apzjMaAL5wM', database:'shujuku' };
const YC = { latMin:33.35, latMax:33.40, lngMin:120.08, lngMax:120.18 };

function rand(a,b) { return Math.random()*(b-a)+a; }

const riderProgress = {};

async function simulate() {
  const c = await m.createConnection(DB);
  try {
    // 1. 配送中骑手 - 沿路线移动
    const [activeOrders] = await c.query(
      "SELECT ro.id, ro.rider_id, ro.pickup_latitude, ro.pickup_longitude, ro.delivery_latitude, ro.delivery_longitude FROM rider_orders ro WHERE ro.status='picking'"
    );
    
    for (const order of activeOrders) {
      const rid = order.rider_id;
      if (!riderProgress[rid]) {
        const [r] = await c.query("SELECT last_latitude, last_longitude FROM riders WHERE id=?", [rid]);
        riderProgress[rid] = {
          progress: 0,
          startLat: (r.length && r[0].last_latitude) ? Number(r[0].last_latitude) : Number(order.pickup_latitude),
          startLng: (r.length && r[0].last_longitude) ? Number(r[0].last_longitude) : Number(order.pickup_longitude)
        };
      }
      
      riderProgress[rid].progress += rand(0.03, 0.08);
      
      if (riderProgress[rid].progress >= 1.0) {
        riderProgress[rid].progress = 1.0;
        await c.query("UPDATE riders SET last_latitude=?, last_longitude=?, last_location_at=NOW() WHERE id=?", 
          [Number(order.delivery_latitude), Number(order.delivery_longitude), rid]);
        await c.query("UPDATE rider_orders SET status='completed', delivered_at=NOW() WHERE id=?", [order.id]);
        delete riderProgress[rid];
      } else {
        const p = riderProgress[rid];
        const lat = Number(p.startLat) + (Number(order.delivery_latitude) - Number(p.startLat)) * p.progress;
        const lng = Number(p.startLng) + (Number(order.delivery_longitude) - Number(p.startLng)) * p.progress;
        await c.query("UPDATE riders SET last_latitude=?, last_longitude=?, last_location_at=NOW() WHERE id=?",
          [lat + rand(-0.0002,0.0002), lng + rand(-0.0002,0.0002), rid]);
      }
    }
    
    // 2. 空闲骑手随机漫步 (限200个)
    const [idle] = await c.query(
      "SELECT id, last_latitude, last_longitude FROM riders WHERE status='online' AND id NOT IN (SELECT DISTINCT rider_id FROM rider_orders WHERE status='picking') ORDER BY RAND() LIMIT 200"
    );
    
    for (const r of idle) {
      let lat = Number(r.last_latitude) + rand(-0.0003, 0.0003);
      let lng = Number(r.last_longitude) + rand(-0.0003, 0.0003);
      lat = Math.max(YC.latMin, Math.min(YC.latMax, lat));
      lng = Math.max(YC.lngMin, Math.min(YC.lngMax, lng));
      await c.query("UPDATE riders SET last_latitude=?, last_longitude=?, last_location_at=NOW() WHERE id=?", [lat, lng, r.id]);
    }
    
    process.stdout.write('.'); // 心跳
  } finally {
    await c.end();
  }
}

// 启动
(async () => {
  // 先跑一次
  await simulate();
  process.stdout.write(' [启动成功] ');
  // 每3秒重复
  setInterval(() => {
    simulate().catch(e => process.stderr.write('E:'+e.message.substring(0,50)+' '));
  }, 3000);
})().catch(e => {
  process.stderr.write('FATAL:'+e.message+'\n');
  process.exit(1);
});
