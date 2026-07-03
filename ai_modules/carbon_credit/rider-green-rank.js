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
 * 骑手绿色排行
 *
 * @module ai_modules/carbon_credit/rider-green-rank
 */

const mysql = require('mysql2/promise');
const config = require('../../config/ai_modules');

/**
 * 根据减排量计算绿色等级
 *
 * @param {number} reduction - 总减排量(kg)
 * @returns {string} 绿色等级: A/B/C/D
 * @private
 */
function _getGreenLevel(reduction) {
  if (reduction > 100) {
    return 'A';
  }
  if (reduction > 50) {
    return 'B';
  }
  if (reduction > 10) {
    return 'C';
  }
  return 'D';
}

/**
 * 获取骑手绿色排行（按总减排量降序）
 *
 * @param {number} [page=1] - 页码
 * @param {number} [size=20] - 每页条数
 * @returns {Promise<{ list: Array, total: number, page: number, size: number, totalPages: number }>}
 */
async function getRanking(page, size) {
  const connection = await mysql.createConnection(config.db);
  try {
    const currentPage = Math.max(1, page || 1);
    const pageSize = Math.max(1, Math.min(100, size || 20));
    const offset = (currentPage - 1) * pageSize;

    // 查询总数
    const [countResult] = await connection.query(
      'SELECT COUNT(*) AS total FROM ai_carbon_credit_accounts WHERE total_reduction > 0',
    );
    const total = countResult[0].total;

    // 查询分页数据（按总减排量降序）
    const [rows] = await connection.query(
      `SELECT user_id, total_reduction, total_credits
       FROM ai_carbon_credit_accounts
       WHERE total_reduction > 0
       ORDER BY total_reduction DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset],
    );

    // 构建排行列表（含排名序号和绿色等级）
    const list = rows.map((row, index) => ({
      rank: offset + index + 1,
      rider_id: row.user_id,
      total_reduction: row.total_reduction,
      total_credits: row.total_credits,
      green_level: _getGreenLevel(row.total_reduction),
    }));

    return {
      list,
      total,
      page: currentPage,
      size: pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } finally {
    await connection.end();
  }
}

module.exports = {
  getRanking,
};
