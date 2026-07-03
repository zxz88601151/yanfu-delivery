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

const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'app.js');
let content = fs.readFileSync(filePath, 'utf8');
const oldLine = "require('dotenv').config();";
const newLine = "require('dotenv').config({ path: require('path').join(__dirname, '.env') });";
if (content.includes(oldLine)) {
  content = content.replace(oldLine, newLine);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ app.js dotenv path fixed');
} else {
  console.log('⚠️ Target string not found, checking...');
  console.log('First 150 chars:', JSON.stringify(content.substring(0, 150)));
}
