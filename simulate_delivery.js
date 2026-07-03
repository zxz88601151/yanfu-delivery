/**
 * 盐阜配送 - 骑手配送模拟脚本
 * 
 * 模拟骑手从接单到送达的完整配送流程：
 * 1. 分配订单给骑手
 * 2. 骑手前往取餐点（产生轨迹点）
 * 3. 取餐
 * 4. 骑手前往送达点（产生轨迹点）
 * 5. 送达完成
 * 
 * 用法: node simulate_delivery.js [rider_id] [order_id]
 * 默认: node simulate_delivery.js 300 1
 */

const MySQL = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'shujuku',
  password: 'jm3d7apzjMaAL5wM',
  database: 'shujuku',
};

// 默认参数
const RIDER_ID = parseInt(process.argv[2]) || 300;  // 骑手ID（默认: 王盐城）
const ORDER_ID = parseInt(process.argv[3]) || 1;     // rider_orders 订单ID

// 模拟速度参数（秒/更新）
const UPDATE_INTERVAL = 3;      // 每3秒更新一次位置
const SPEED_KMH = 20;           // 模拟骑行速度 20km/h
const SPEED_MS = SPEED_KMH * 1000 / 3600;  // 转 m/s

// 配送状态时间（秒）
const TIME_TO_PICKUP = 30;     // 到店取餐180秒
const TIME_PICKING = 5;        // 取餐耗时30秒
const TIME_TO_DELIVERY = 60;   // 配送300秒

// ============ 工具函数 ============
/** 计算两点距离（米）- Haversine公式 */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + 
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** 线性插值生成轨迹点 */
function interpolate(fromLat, fromLng, toLat, toLng, totalSteps, step) {
  const ratio = step / totalSteps;
  // 加入随机偏移让轨迹更真实（±0.00005度 ≈ ±5米）
  const jitter = (Math.random() - 0.5) * 0.00005;
  return {
    lat: parseFloat((fromLat + (toLat - fromLat) * ratio + jitter).toFixed(7)),
    lng: parseFloat((fromLng + (toLng - fromLng) * ratio + jitter).toFixed(7)),
  };
}

/** 休眠 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 当前时间戳 */
function ts() {
  return new Date().toISOString().substring(11, 19);
}

// ============ 主流程 ============
async function simulateDelivery() {
  console.log(`\n🚀 盐阜配送模拟启动`);
  console.log(`📋 骑手ID: ${RIDER_ID}, 订单ID: ${ORDER_ID}`);
  console.log(`📍 模拟速度: ${SPEED_KMH}km/h, 更新间隔: ${UPDATE_INTERVAL}s\n`);

  const db = await MySQL.createConnection(DB_CONFIG);

  try {
    // === 1. 获取订单信息 ===
    const [orders] = await db.execute(
      'SELECT * FROM rider_orders WHERE id = ?', [ORDER_ID]
    );
    if (orders.length === 0) {
      console.error('❌ 订单不存在');
      return;
    }
    const order = orders[0];

    // === 2. 获取骑手信息 ===
    const [riders] = await db.execute(
      'SELECT * FROM riders WHERE id = ?', [RIDER_ID]
    );
    if (riders.length === 0) {
      console.error('❌ 骑手不存在');
      return;
    }
    const rider = riders[0];

    // 起始位置（骑手当前位置或默认）
    let riderLat = parseFloat(rider.last_latitude) || 33.3700;
    let riderLng = parseFloat(rider.last_longitude) || 120.1300;

    // 取餐点坐标
    const pickupLat = parseFloat(order.pickup_latitude) || 33.3750;
    const pickupLng = parseFloat(order.pickup_longitude) || 120.1400;

    // 送达点坐标
    const deliveryLat = parseFloat(order.delivery_latitude) || 33.3850;
    const deliveryLng = parseFloat(order.delivery_longitude) || 120.1500;

    // === 3. 设置订单状态 - 骑手接单 ===
    console.log(`[${ts()}] 📦 骑手 ${rider.name} 已接单`);
    await db.execute(
      'UPDATE rider_orders SET status = ?, rider_id = ? WHERE id = ?',
      ['accepted', RIDER_ID, ORDER_ID]
    );
    await db.execute(
      'UPDATE riders SET status = ? WHERE id = ?',
      ['online', RIDER_ID]
    );

    // === 4. 骑手前往取餐点 ===
    const distToPickup = haversine(riderLat, riderLng, pickupLat, pickupLng);
    const stepsToPickup = Math.ceil(TIME_TO_PICKUP / UPDATE_INTERVAL);
    console.log(`[${ts()}] 🏪 前往取餐点（距离: ${distToPickup.toFixed(0)}m, 约${stepsToPickup}步）\n`);

    const pickupTrajectory = [];
    for (let i = 1; i <= stepsToPickup; i++) {
      const pos = interpolate(riderLat, riderLng, pickupLat, pickupLng, stepsToPickup, i);
      pickupTrajectory.push(pos);
      
      await db.execute(
        'UPDATE riders SET last_latitude = ?, last_longitude = ?, last_location_at = NOW() WHERE id = ?',
        [pos.lat, pos.lng, RIDER_ID]
      );

      if (i % 3 === 0 || i === stepsToPickup) {
        const remaining = haversine(pos.lat, pos.lng, pickupLat, pickupLng);
        console.log(`[${ts()}]   🏍 位置更新 #${i}: (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}) 距取餐点${remaining.toFixed(0)}m`);
      }
      
      await sleep(UPDATE_INTERVAL * 1000);
    }

    // === 5. 到达取餐点 - 取餐中 ===
    console.log(`\n[${ts()}] ✅ 到达取餐点`);
    await db.execute(
      'UPDATE rider_orders SET status = ?, picked_at = NOW() WHERE id = ?',
      ['picking', ORDER_ID]
    );
    console.log(`[${ts()}] 🍳 取餐中...`);
    await sleep(TIME_PICKING * 1000);

    // === 6. 取餐完成，开始配送 ===
    console.log(`[${ts()}] 📦 取餐完成，开始配送`);
    await db.execute(
      'UPDATE rider_orders SET status = ? WHERE id = ?',
      ['delivering', ORDER_ID]
    );

    // === 7. 骑手前往送达点 ===
    const distToDelivery = haversine(pickupLat, pickupLng, deliveryLat, deliveryLng);
    const stepsToDelivery = Math.ceil(TIME_TO_DELIVERY / UPDATE_INTERVAL);
    console.log(`[${ts()}] 🚀 前往送达点（距离: ${distToDelivery.toFixed(0)}m, 约${stepsToDelivery}步）\n`);

    const deliveryTrajectory = [];
    for (let i = 1; i <= stepsToDelivery; i++) {
      const pos = interpolate(pickupLat, pickupLng, deliveryLat, deliveryLng, stepsToDelivery, i);
      deliveryTrajectory.push(pos);

      await db.execute(
        'UPDATE riders SET last_latitude = ?, last_longitude = ?, last_location_at = NOW() WHERE id = ?',
        [pos.lat, pos.lng, RIDER_ID]
      );

      if (i % 5 === 0 || i === stepsToDelivery) {
        const remaining = haversine(pos.lat, pos.lng, deliveryLat, deliveryLng);
        console.log(`[${ts()}]   🏍 配送更新 #${i}: (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}) 距送达点${remaining.toFixed(0)}m`);
      }

      await sleep(UPDATE_INTERVAL * 1000);
    }

    // === 8. 送达完成 ===
    console.log(`\n[${ts()}] ✅ 订单已送达！`);
    await db.execute(
      'UPDATE rider_orders SET status = ?, delivered_at = NOW() WHERE id = ?',
      ['completed', ORDER_ID]
    );
    await db.execute(
      'UPDATE riders SET total_orders = total_orders + 1 WHERE id = ?',
      [RIDER_ID]
    );

    // 输出完整的轨迹JSON（用于前端展示）
    const allTrajectory = [...pickupTrajectory, ...deliveryTrajectory];
    const result = {
      rider: { id: RIDER_ID, name: rider.name },
      order: { id: ORDER_ID, orderNo: order.order_no },
      pickup: { lat: pickupLat, lng: pickupLng },
      delivery: { lat: deliveryLat, lng: deliveryLng },
      trajectory: allTrajectory,
      totalPoints: allTrajectory.length,
      totalDuration: ((TIME_TO_PICKUP + TIME_PICKING + TIME_TO_DELIVERY) / 60).toFixed(1),
    };
    
    const outputPath = `/tmp/delivery_${RIDER_ID}_${ORDER_ID}.json`;
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n📊 轨迹已保存: ${outputPath}`);
    console.log(`⏱  总耗时: ${result.totalDuration} 分钟`);
    console.log(`📍 轨迹点数: ${result.totalPoints}\n`);

  } catch (err) {
    console.error('❌ 模拟失败:', err.message);
  } finally {
    await db.end();
    process.exit(0);
  }
}

simulateDelivery();
