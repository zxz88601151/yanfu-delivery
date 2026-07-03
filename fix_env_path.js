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
