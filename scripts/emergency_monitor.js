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

/**
 * 服务器紧急熔断器 - 实时监控并在异常时自动重启后端
 * 在压测期间运行: node scripts/emergency_monitor.js
 */
const { execSync } = require('child_process');

const CHECK_INTERVAL = 5000; // 5s check interval
const MAX_MEMORY_MB = 400;   // Node process memory limit
const MAX_LOAD_AVG = 4.0;     // System load average limit
const MAX_DB_CONNECTIONS = 250; // DB connection limit
const MAX_ERROR_RESTARTS = 3;   // Max auto-restarts before stopping

let restartCount = 0;

function getMetric(cmd) {
  try {
    return execSync(cmd, { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch { return '0'; }
}

function check() {
  const now = new Date().toLocaleTimeString();
  
  // Get metrics
  const loadAvg = parseFloat(getMetric("cat /proc/loadavg | awk '{print $1}'")) || 0;
  const freeMem = parseInt(getMetric("free -m | awk '/^Mem:/{print $7}'")) || 0;
  const dbConns = parseInt(getMetric("mysql -uroot -p'Yanfu@2026!Secure' -N -e 'SHOW STATUS LIKE \"Threads_connected\";' 2>/dev/null | awk '{print $2}'")) || 0;
  const nodeMem = parseInt(getMetric("ps aux | grep 'node.*kuailv' | grep -v grep | awk '{print $6}'")) / 1024 || 0;
  const pm2Status = getMetric("pm2 show 4 2>/dev/null | grep 'status' | head -1 | awk '{print $4}'");

  const alerts = [];
  if (loadAvg > MAX_LOAD_AVG) alerts.push(`LOAD=${loadAvg.toFixed(2)}>${MAX_LOAD_AVG}`);
  if (freeMem < 100) alerts.push(`FREE_MEM=${freeMem}MB<100MB`);
  if (dbConns > MAX_DB_CONNECTIONS) alerts.push(`DB_CONNS=${dbConns}>${MAX_DB_CONNECTIONS}`);
  if (nodeMem > MAX_MEMORY_MB) alerts.push(`NODE_MEM=${nodeMem.toFixed(0)}MB>${MAX_MEMORY_MB}MB`);

  const statusIcon = alerts.length > 0 ? 'ALERT' : 'OK';
  console.log(`[${now}] ${statusIcon} | load=${loadAvg.toFixed(2)} mem=${freeMem}MB db=${dbConns} node=${nodeMem.toFixed(0)}MB pm2=${pm2Status}`);

  if (alerts.length > 0) {
    console.log(`  *** ALERTS: ${alerts.join(', ')} ***`);
    
    if (alerts.some(a => a.includes('FREE_MEM') || a.includes('NODE_MEM') || a.includes('DB_CONNS'))) {
      if (restartCount < MAX_ERROR_RESTARTS) {
        console.log(`  >>> EMERGENCY: Restarting backend (restart #${restartCount + 1}) <<<`);
        try {
          execSync('pm2 restart 4', { timeout: 10000 });
          restartCount++;
          console.log('  Backend restarted successfully');
        } catch (e) {
          console.log('  Restart failed:', e.message);
        }
      } else {
        console.log(`  >>> CRITICAL: Max restarts (${MAX_ERROR_RESTARTS}) reached. Stopping monitor. <<<`);
        process.exit(1);
      }
    }
  }
}

console.log('=== Emergency Monitor Started ===');
console.log(`  Interval: ${CHECK_INTERVAL/1000}s | Load>${MAX_LOAD_AVG} | Mem<100MB | DB>${MAX_DB_CONNECTIONS} | Node>${MAX_MEMORY_MB}MB`);
console.log('');

const interval = setInterval(check, CHECK_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nMonitor stopped.');
  clearInterval(interval);
  process.exit(0);
});

// Initial check
check();
