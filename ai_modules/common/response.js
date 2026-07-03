'use strict';

/**
 * 统一响应格式工具
 *
 * @module ai_modules/common/response
 */

/**
 * 成功响应
 *
 * @param {*} data - 响应数据
 * @param {string} [message='success'] - 成功消息
 * @returns {{ code: number, data: *, message: string }}
 */
function success(data = null, message = 'success') {
  return {
    code: 0,
    data,
    message,
  };
}

/**
 * 失败响应
 *
 * @param {number} code - 错误码
 * @param {string} message - 错误消息
 * @param {*} [data=null] - 附加数据
 * @returns {{ code: number, data: *, message: string }}
 */
function fail(code, message, data = null) {
  return {
    code,
    data,
    message,
  };
}

/**
 * 分页响应
 *
 * @param {number} total - 总记录数
 * @param {number} page - 当前页码
 * @param {number} size - 每页条数
 * @param {Array} items - 数据列表
 * @returns {{ code: number, data: { total: number, page: number, size: number, items: Array } }}
 */
function paginate(total, page, size, items = []) {
  return {
    code: 0,
    data: {
      total,
      page,
      size,
      items,
    },
  };
}

module.exports = {
  success,
  fail,
  paginate,
};
