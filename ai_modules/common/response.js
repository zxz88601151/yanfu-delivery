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
