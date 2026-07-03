#!/bin/bash
# 盐阜配送 - API测试脚本 v2
echo "=== 盐阜配送 API 测试 v2 ==="

# 1. 用户登录（已有账号）
echo "[1] 用户登录..."
LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/user/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13900139000","password":"test123456"}')
echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  用户Token:', d.get('data',{}).get('token','无')[:50]+'...' if d.get('data',{}).get('token') else '  登录失败: '+d.get('message',''))" 2>/dev/null
USER_TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)

# 2. 管理端登录
echo "[2] 管理端登录..."
ADMIN_LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"zxzjxx","password":"0pO9iU8$yT7#rE5wQ3sD1fG2"}')
echo "$ADMIN_LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  管理Token:', d.get('data',{}).get('token','无')[:50]+'...' if d.get('data',{}).get('token') else '  登录失败: '+d.get('message',''))" 2>/dev/null
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('token',''))" 2>/dev/null)

# 3. 商家列表（正确路由）
echo "[3] 商家列表 (/api/user/stores/nearby)..."
STORES=$(curl -s "http://localhost:3001/api/user/stores/nearby?lat=23.13&lng=113.26")
echo "$STORES" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  商家数:', len(d.get('data',[])) if isinstance(d.get('data'),list) else d.get('message','未知'))" 2>/dev/null

# 4. 管理端用户列表
echo "[4] 管理端用户列表..."
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; then
  USERS=$(curl -s "http://localhost:3001/api/admin/users?page=1&limit=5" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  echo "$USERS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); print('  用户数:', data.get('total','?') if isinstance(data,dict) else len(data) if isinstance(data,list) else d.get('message','未知'))" 2>/dev/null
else
  echo "  跳过（无Token）"
fi

# 5. 管理端商家列表
echo "[5] 管理端商家列表..."
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; then
  MERCHANTS=$(curl -s "http://localhost:3001/api/admin/merchants?page=1&limit=5" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  echo "$MERCHANTS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); print('  商家数:', data.get('total','?') if isinstance(data,dict) else len(data) if isinstance(data,list) else d.get('message','未知'))" 2>/dev/null
else
  echo "  跳过（无Token）"
fi

# 6. 管理端骑手列表
echo "[6] 管理端骑手列表..."
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; then
  RIDERS=$(curl -s "http://localhost:3001/api/admin/riders?page=1&limit=5" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  echo "$RIDERS" | python3 -c "import sys,json; d=json.load(sys.stdin); data=d.get('data',{}); print('  骑手数:', data.get('total','?') if isinstance(data,dict) else len(data) if isinstance(data,list) else d.get('message','未知'))" 2>/dev/null
else
  echo "  跳过（无Token）"
fi

# 7. 管理端Dashboard
echo "[7] 管理端Dashboard..."
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "None" ]; then
  DASH=$(curl -s "http://localhost:3001/api/admin/dashboard" \
    -H "Authorization: Bearer $ADMIN_TOKEN")
  echo "$DASH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  状态:', '成功' if d.get('success') else d.get('message','失败'))" 2>/dev/null
else
  echo "  跳过（无Token）"
fi

echo ""
echo "=== 测试完成 ==="
