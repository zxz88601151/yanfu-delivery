'use strict';

/**
 * 日期工具
 *
 * @module ai_modules/common/date-utils
 */

/**
 * 获取当前 UTC 时间
 *
 * @returns {Date}
 */
function getNow() {
  return new Date();
}

/**
 * 获取从当前时间起指定秒数后的过期时间
 *
 * @param {number} seconds - 过期秒数
 * @returns {Date}
 */
function getExpireTime(seconds) {
  const now = new Date();
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * 获取时间对应的时段
 * 早餐 06:00-09:00 | 午餐 11:00-14:00 | 下午茶 14:00-17:00 | 晚餐 17:00-21:00 | 夜宵 21:00-24:00
 *
 * @param {Date} [date] - 日期对象，默认当前时间
 * @returns {string} 时段标识
 */
function getTimeSlot(date) {
  const d = date || new Date();
  const hour = d.getHours();

  if (hour >= 6 && hour < 9) {
    return 'breakfast';
  }
  if (hour >= 11 && hour < 14) {
    return 'lunch';
  }
  if (hour >= 14 && hour < 17) {
    return 'tea_time';
  }
  if (hour >= 17 && hour < 21) {
    return 'dinner';
  }
  if (hour >= 21 || hour < 6) {
    return 'night_snack';
  }

  return 'other';
}

/**
 * 判断指定日期是否为节假日
 * 简单的周末判断，如需精确节假日请接入第三方 API
 *
 * @param {Date} [date] - 日期对象，默认当前时间
 * @returns {boolean}
 */
function isHoliday(date) {
  const d = date || new Date();
  const day = d.getDay();
  // 周六(6) 或 周日(0)
  return day === 0 || day === 6;
}

/**
 * 格式化日期为 YYYY-MM-DD
 *
 * @param {Date} [date] - 日期对象
 * @returns {string}
 */
function formatDate(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss
 *
 * @param {Date} [date] - 日期对象
 * @returns {string}
 */
function formatDateTime(date) {
  const d = date || new Date();
  const dateStr = formatDate(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${dateStr} ${hours}:${minutes}:${seconds}`;
}

module.exports = {
  getNow,
  getExpireTime,
  getTimeSlot,
  isHoliday,
  formatDate,
  formatDateTime,
};
