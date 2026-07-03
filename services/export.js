// 数据导出服务 - 生成 CSV 文件流
const { Readable } = require('stream');

/**
 * 将二维数组/对象数组转为 CSV 字符串
 * @param {string[]} headers - CSV 表头
 * @param {string[]} keys - 对应对象的字段名（与 headers 一一对应）
 * @param {object[]} rows - 数据行
 * @returns {string} CSV 字符串
 */
function toCsv(headers, keys, rows) {
  const lines = [];
  // BOM + 表头
  lines.push('\uFEFF' + headers.map(cell => escapeCsv(cell)).join(','));
  // 数据行
  for (const row of rows) {
    const vals = keys.map(k => {
      const v = typeof row === 'object' && row !== null ? resolveValue(row, k) : row;
      return v !== null && v !== undefined ? escapeCsv(String(v)) : '';
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

function escapeCsv(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function resolveValue(obj, key) {
  const parts = key.split('.');
  let val = obj;
  for (const p of parts) {
    if (val === null || val === undefined) return val;
    val = val[p];
  }
  return val;
}

/**
 * 发送 CSV 文件下载响应
 * @param {object} res - Express Response
 * @param {string} filename - 文件名（不含扩展名）
 * @param {string[]} headers - CSV 表头
 * @param {string[]} keys - 字段名
 * @param {object[]} rows - 数据行
 */
function sendCsv(res, filename, headers, keys, rows) {
  const csv = toCsv(headers, keys, rows);
  // RFC 5987 编码支持中文文件名
  const encodedName = encodeURIComponent(filename + '_' + formatDate());
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodedName}.csv"; filename*=UTF-8''${encodedName}.csv`);
  res.send(csv);
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

module.exports = { toCsv, sendCsv };
