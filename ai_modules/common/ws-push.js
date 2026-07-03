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

'use strict';

/**
 * WebSocket 推送封装
 * 维护用户连接池并进行消息推送
 *
 * @module ai_modules/common/ws-push
 */

const { v4: uuidv4 } = require('uuid');

/**
 * WebSocket 推送管理器
 *
 * @class WsPushManager
 */
class WsPushManager {
  constructor() {
    /** @type {Map<string, Array<{ id: string, ws: import('ws') }>>} */
    this._connections = new Map();
  }

  /**
   * 添加用户 WebSocket 连接
   *
   * @param {string} userId - 用户 ID
   * @param {import('ws')} ws - WebSocket 实例
   * @returns {string} 连接 ID
   */
  addConnection(userId, ws) {
    if (!userId || !ws || typeof ws.on !== 'function') {
      throw new Error('addConnection: 无效的参数 (userId 或 ws 不能为空)');
    }
    const connectionId = uuidv4();
    if (!this._connections.has(userId)) {
      this._connections.set(userId, []);
    }

    const userConnections = this._connections.get(userId);
    userConnections.push({ id: connectionId, ws });

    // 连接关闭时自动移除
    ws.on('close', () => {
      this.removeConnection(userId, ws);
    });

    ws.on('error', () => {
      this.removeConnection(userId, ws);
    });

    return connectionId;
  }

  /**
   * 移除用户 WebSocket 连接
   *
   * @param {string} userId - 用户 ID
   * @param {import('ws')} ws - WebSocket 实例
   */
  removeConnection(userId, ws) {
    if (!this._connections.has(userId)) {
      return;
    }

    const userConnections = this._connections.get(userId);
    const filtered = userConnections.filter((conn) => conn.ws !== ws);
    if (filtered.length === 0) {
      this._connections.delete(userId);
    } else {
      this._connections.set(userId, filtered);
    }
  }

  /**
   * 推送消息给指定用户
   *
   * @param {string} userId - 用户 ID
   * @param {string} event - 事件名称
   * @param {*} data - 推送数据
   */
  pushToUser(userId, event, data) {
    if (!this._connections.has(userId)) {
      return;
    }

    const message = JSON.stringify({ event, data });
    const userConnections = this._connections.get(userId);

    for (const conn of userConnections) {
      if (conn.ws.readyState === 1) { // WebSocket.OPEN
        try {
          conn.ws.send(message);
        } catch (err) {
          // 发送失败，忽略（onerror 会触发清理）
        }
      }
    }
  }

  /**
   * 广播消息给所有在线用户
   *
   * @param {string} event - 事件名称
   * @param {*} data - 推送数据
   */
  broadcast(event, data) {
    const message = JSON.stringify({ event, data });

    for (const [, connections] of this._connections) {
      for (const conn of connections) {
        if (conn.ws.readyState === 1) { // WebSocket.OPEN
          try {
            conn.ws.send(message);
          } catch (err) {
            // 发送失败，忽略
          }
        }
      }
    }
  }

  /**
   * 获取在线用户数
   *
   * @returns {number}
   */
  getOnlineCount() {
    return this._connections.size;
  }

  /**
   * 获取指定用户的连接数
   *
   * @param {string} userId
   * @returns {number}
   */
  getUserConnectionCount(userId) {
    const connections = this._connections.get(userId);
    return connections ? connections.length : 0;
  }

  /**
   * 获取所有在线用户 ID
   *
   * @returns {string[]}
   */
  getOnlineUserIds() {
    return Array.from(this._connections.keys());
  }
}

// 单例导出
const wsPushManager = new WsPushManager();

module.exports = wsPushManager;
