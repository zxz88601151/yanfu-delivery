#!/bin/bash
cd /www/wwwroot/yanfu_backend
echo '=== 开始调试启动 ==='
echo '时间:' Thu Jun 11 20:58:33     2026
echo 'NODE_ENV:' 
echo 'DB_USER:' 
echo 'DB_PASSWORD 长度:' 0
echo ''
echo '=== 运行 node app.js ==='
node app.js 2>&1
echo ''
echo '=== 进程退出码:' 0 '==='
