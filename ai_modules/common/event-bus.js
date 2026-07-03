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

const EventEmitter = require('events');
const { createLogger, format, transports } = require('winston');
const path = require('path');

/**
 * 日志记录器
 * @private
 */
const logger = createLogger({
  level: process.env.KUAILV_LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    }),
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(process.env.KUAILV_LOG_DIR || './logs', 'event-bus.log'),
      maxSize: '10m',
      maxFiles: 7,
    }),
  ],
});

/**
 * 事件总线（单例模式）
 * 基于 EventEmitter 的统一事件发布/订阅系统
 *
 * @class EventBus
 * @extends EventEmitter
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this._initialized = true;
    // 防止未捕获的 'error' 事件导致进程崩溃
    this.on('error', (err) => {
      logger.error(`EventBus 未捕获错误: ${err.message}`, { stack: err.stack });
    });
  }

  /**
   * 发布事件（统一包装日志）
   *
   * @param {string} eventName - 事件名称
   * @param {*} payload - 事件数据
   */
  emitEvent(eventName, payload) {
    try {
      logger.info(`事件发布: ${eventName}`, { payload });
      this.emit(eventName, payload);
    } catch (err) {
      logger.error(`事件发布异常: ${eventName}`, { error: err.message, payload });
    }
  }

  /**
   * 注册事件处理器
   *
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 处理函数
   */
  registerHandler(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new Error('事件处理器必须是函数');
    }
    this.on(eventName, (payload) => {
      logger.info(`事件处理: ${eventName}`, { payload });
      try {
        handler(payload);
      } catch (err) {
        logger.error(`事件处理异常: ${eventName}`, {
          error: err.message,
          stack: err.stack,
          payload,
        });
      }
    });
  }

  /**
   * 移除事件处理器
   *
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 处理函数（可选，不传则移除所有）
   */
  removeHandler(eventName, handler) {
    if (handler) {
      this.removeListener(eventName, handler);
    } else {
      this.removeAllListeners(eventName);
    }
  }

  /**
   * 一次性事件监听
   *
   * @param {string} eventName - 事件名称
   * @param {Function} handler - 处理函数
   */
  onceEvent(eventName, handler) {
    this.once(eventName, handler);
  }

  /**
   * 获取事件监听器数量
   *
   * @param {string} eventName - 事件名称
   * @returns {number}
   */
  listenerCount(eventName) {
    return super.listenerCount(eventName);
  }
}

// 单例导出
const eventBus = new EventBus();

module.exports = eventBus;
