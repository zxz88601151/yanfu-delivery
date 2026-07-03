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

// WebSocket 实时推送服务
// [P0修复] 添加Token认证验证
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

/**
 * 初始化 WebSocket 服务
 * @param {http.Server} server - HTTP服务器实例
 */
function initWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // 连接管理
  const connectedUsers = new Map(); // userId -> Set<socketId>
  const connectedMerchants = new Map(); // merchantId -> Set<socketId>
  const connectedRiders = new Map(); // riderId -> Set<socketId>

  io.on('connection', (socket) => {
    console.log(`[WS] 客户端连接: ${socket.id}`);

    // 用户认证并加入房间
    // [P0修复] 添加Token验证
    socket.on('auth', ({ token, role, id }) => {
      // 验证必要参数
      if (!role || !id) {
        console.log(`[WS] 拒绝连接: 缺少role或id`);
        socket.disconnect();
        return;
      }

      // [P0修复] 验证Token
      if (!token) {
        console.log(`[WS] 拒绝连接: 缺少token`);
        socket.disconnect();
        return;
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 验证token中的用户信息与请求参数匹配
        if (decoded.id != id || decoded.role !== role) {
          console.log(`[WS] 拒绝连接: token信息不匹配`);
          socket.disconnect();
          return;
        }

        socket.join(`${role}:${id}`);
        socket.data = { role, id, userId: decoded.id };

        // 骑手加入全局骑手房间（用于新订单广播）
        if (role === 'rider') {
          socket.join('riders');
        }

        // 记录连接
        const map = role === 'user' ? connectedUsers : role === 'merchant' ? connectedMerchants : connectedRiders;
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(socket.id);

        console.log(`[WS] ${role}#${id} 已认证连接 (当前在线: ${map.size})`);
      } catch (err) {
        console.log(`[WS] 拒绝连接: token验证失败 - ${err.message}`);
        socket.disconnect();
      }
    });

    // 骑手位置更新
    socket.on('rider:location', async (data) => {
      if (socket.data?.role !== 'rider') return;
      let { latitude, longitude, accuracy, speed, heading } = data;

      // [P1修复] 校验经纬度范围
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        console.warn(`[WS] 拒绝非法位置: rider=${socket.data.id}, lat=${latitude}, lng=${longitude}`);
        return;
      }

      // 广播给相关用户（正在追踪该骑手的用户）
      socket.to(`tracking:${socket.data.id}`).emit('rider:location:update', {
        riderId: socket.data.id,
        latitude, longitude, accuracy, speed, heading,
        timestamp: Date.now(),
      });

      // 存储到数据库（异步，不阻塞）
      try {
        const { pool } = require('../config/database');
        await pool.query(
          `INSERT INTO rider_locations (rider_id, latitude, longitude, accuracy, speed, heading, location_time)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [socket.data.id, latitude, longitude, accuracy || null, speed || null, heading || null]
        );
      } catch (err) {
        // 静默失败，不影响推送
      }
    });

    // 用户/商家开始追踪骑手位置
    socket.on('user:track:rider', ({ riderId }) => {
      if (socket.data?.role !== 'user' && socket.data?.role !== 'merchant') return;
      socket.join(`tracking:${riderId}`);
      console.log(`[WS] ${socket.data.role}#${socket.data.id} 开始追踪骑手#${riderId}`);
    });

    // 用户/商家停止追踪骑手位置
    socket.on('user:untrack:rider', ({ riderId }) => {
      socket.leave(`tracking:${riderId}`);
    });

    // 断开连接
    socket.on('disconnect', () => {
      if (socket.data) {
        const { role, id } = socket.data;
        const map = role === 'user' ? connectedUsers : role === 'merchant' ? connectedMerchants : connectedRiders;
        if (map.has(id)) {
          map.get(id).delete(socket.id);
          if (map.get(id).size === 0) map.delete(id);
        }
        console.log(`[WS] ${role}#${id} 断开连接`);
      }
    });
  });

  console.log('[WS] WebSocket 服务已启动');
  return io;
}

// ========== 推送方法 ==========

/**
 * 推送订单状态变更
 * [P0修复] 仅推送给订单关联方，不再全局广播
 */
function emitOrderStatus(orderId, status, data = {}) {
  if (!io) return;
  const { userId, merchantId, riderId } = data;
  const payload = { orderId, status, timestamp: Date.now() };
  // 定向推送给订单关联的用户/商家/骑手
  if (userId) io.to(`user:${userId}`).emit('order:status:change', payload);
  if (merchantId) io.to(`merchant:${merchantId}`).emit('order:status:change', payload);
  if (riderId) io.to(`rider:${riderId}`).emit('order:status:change', payload);
  // 管理员始终接收状态变更
  io.to('admin:*').emit('order:status:change', { ...payload, ...data });
  // 推送看板更新事件（管理员实时刷新）
  io.to('admin:*').emit('admin:stats:update', { type: 'order_status', timestamp: Date.now() });
}

/**
 * 推送给特定用户
 */
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, { ...data, timestamp: Date.now() });
}

/**
 * 推送给特定商家
 */
function emitToMerchant(merchantId, event, data) {
  if (!io) return;
  io.to(`merchant:${merchantId}`).emit(event, { ...data, timestamp: Date.now() });
}

/**
 * 推送给特定骑手
 */
function emitToRider(riderId, event, data) {
  if (!io) return;
  io.to(`rider:${riderId}`).emit(event, { ...data, timestamp: Date.now() });
}

/**
 * 广播给所有骑手（新订单通知）
 */
function broadcastToRiders(event, data) {
  if (!io) return;
  io.to('riders').emit(event, { ...data, timestamp: Date.now() });
}

/**
 * 推送新订单给商家
 */
function emitNewOrder(merchantId, orderData) {
  emitToMerchant(merchantId, 'order:new', orderData);
}

/**
 * 推送公告
 */
function emitAnnouncement(type, announcement) {
  if (!io) return;
  io.to(`${type}:*`).emit('announcement:new', announcement);
}

/**
 * 推送管理员看板更新事件
 */
function emitAdminStatsUpdate(type, data = {}) {
  if (!io) return;
  io.to('admin:*').emit('admin:stats:update', { type, ...data, timestamp: Date.now() });
}

/**
 * 获取在线统计
 */
function getOnlineStats() {
  if (!io) return { users: 0, merchants: 0, riders: 0 };

  // [P2修复] 从连接Map统计在线数，避免房间遍历导致的重复计数
  const _getStatsFromMap = (map) => {
    // connectedUsers/connectedMerchants/connectedRiders 是在 initWebSocket 闭包内的
    // 这里fallback到传统方式
    return 0;
  };

  // [P2修复] 精确统计：遍历sockets自身加入的房间
  const rooms = io.sockets.adapter.rooms;
  let users = 0, merchants = 0, riders = 0;
  const countedUsers = new Set();
  const countedMerchants = new Set();
  const countedRiders = new Set();

  for (const [room, sockets] of rooms) {
    // 跳过socket自身房间（socket.id == room名）
    if (sockets.has(room)) continue;
    if (room.startsWith('user:')) {
      const id = room.slice(5);
      if (!countedUsers.has(id)) { countedUsers.add(id); users++; }
    }
    if (room.startsWith('merchant:')) {
      const id = room.slice(9);
      if (!countedMerchants.has(id)) { countedMerchants.add(id); merchants++; }
    }
    if (room.startsWith('rider:')) {
      const id = room.slice(6);
      if (!countedRiders.has(id)) { countedRiders.add(id); riders++; }
    }
  }
  return { users, merchants, riders };
}

module.exports = {
  initWebSocket,
  emitOrderStatus,
  emitToUser,
  emitToMerchant,
  emitToRider,
  broadcastToRiders,
  emitNewOrder,
  emitAnnouncement,
  emitAdminStatsUpdate,
  getOnlineStats,
};
