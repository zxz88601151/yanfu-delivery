#!/bin/bash
# ============================================================
# 盐阜同城配送 - 服务器 Nginx 一键部署脚本
# 
# 使用方式（在服务器上执行）：
#   chmod +x deploy-nginx.sh
#   sudo ./deploy-nginx.sh
# ============================================================

set -e

NGINX_CONF="/www/server/nginx/conf/vhost/daikuan.conf"
BACKEND_DIR="/home/ubuntu/yanfu-backend"

echo "========================================"
echo "  盐阜同城配送 - Nginx 部署 + 后端重启"
echo "========================================"
echo ""

# 1. 部署 Nginx 配置
echo "[1/4] 部署 Nginx 配置..."
if [ -f "nginx-ip.conf" ]; then
    sudo cp nginx-ip.conf "$NGINX_CONF"
    echo "  ✓ nginx-ip.conf → $NGINX_CONF"
else
    echo "  ✗ 找不到 nginx-ip.conf，请先上传该文件到当前目录"
    exit 1
fi

# 2. 测试 Nginx 配置
echo "[2/4] 测试 Nginx 配置..."
if sudo nginx -t 2>&1 | grep -q "successful"; then
    echo "  ✓ 配置测试通过"
else
    echo "  ✗ 配置测试失败，请检查错误信息"
    sudo nginx -t
    exit 1
fi

# 3. 重载 Nginx
echo "[3/4] 重载 Nginx..."
sudo nginx -s reload
echo "  ✓ Nginx 已重载"

# 4. 重启后端（应用新版代码 + 版本检查接口）
echo "[4/4] 重启后端服务..."
cd "$BACKEND_DIR"
pm2 reload yanfu-backend
pm2 status | grep yanfu-backend
echo "  ✓ 后端已重启"

echo ""
echo "========================================"
echo "  部署完成！"
echo "========================================"
echo "  访问测试:"
echo "    http://[服务器IP]/health"
echo "    http://[服务器IP]/api/version?platform=rider"
echo "    http://[服务器IP]/rider/"
echo "========================================"
