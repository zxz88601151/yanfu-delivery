# 盐阜配送 - Yanfu Delivery
> 盐城本地同城即时配送平台 | AI 智能驱动 | 全链路闭环 | RC 候选版本 v1.0.0-rc1
## 📋 项目概述
**盐阜配送** 是一个面向江苏省盐城市的本地化同城即时配送平台，覆盖亭湖区、盐都区、大丰区、建湖县、射阳县、阜宁县、滨海县、响水县、东台市共 9 个区县，搭载自研 AI 智能派单引擎。
项目从零开始，经过高密度开发、测试与工程化整合，已进入 Release Candidate 阶段。当前具备完整的用户端、商家端、骑手端、管理后台四大核心模块，以及钱包体系、自动结算、实时定位、WebSocket 通讯等基础设施。
## ✨ 功能全景
### 🧑 用户端
- 注册/登录 · 浏览商家菜单 · 购物车管理
- 下单/取消 · 订单跟踪 · 评价/退款
- **钱包充值** · 余额查询 · 交易流水 · 汇总统计
### 🏪 商家端
- 菜单管理 · 接单/出餐 · 订单管理
- **经营看板** · 趋势分析 · 菜品销量分析
- **T+1 自动结算** · 财务报表 · **PDF 报表导出**
- **提现** · 结算记录查询
### 🚴 骑手端
- 接单/配送 · 状态更新
- **实时 GPS 定位上传** (HTTP + WebSocket 双通道)
- 收入明细 · 提现 · 银行卡管理
### 🔧 管理后台
- 系统管理 · 财务审核 · 工单处理
- 数据看板 (实时/趋势/用户分析)
- 转化漏斗 · 留存率 · 骑手效率分析
### 🤖 AI 智能引擎
| 模块 | 功能 |
|------|------|
| 智能派单引擎 | ML 模型 + 多因子匹配（距离/天气/时段/骑手信用） |
| 动态定价系统 | 5 因子聚合（供需/天气/时段/距离/密度），降级熔断 |
| 活地图 | 骑手路况上报、热力图、红区预警、激励积分 |
| 预置运力预测 | 预测各区域订单高峰，提前调度骑手 |
| 接力配送 | 大订单自动拆单、多骑手接力、交接超时扫描 |
| 盲盒订单 | 随机折扣匹配、平台补贴 |
| 碳信用/积分 | 环保配送积分体系 |
| 知识图谱 | 商家/区域/路线关系推理 |
## 🏗️ 技术架构
### 后端技术栈
| 类别 | 技术 |
|------|------|
| 运行环境 | Node.js 22 + Express |
| 数据库 | MySQL 5.7 (35+ 张表) |
| 进程管理 | PM2 (cluster 模式) |
| 实时通讯 | Socket.IO (WebSocket) |
| 认证鉴权 | JWT (用户/商家/骑手/管理员四级权限) |
| 地图服务 | 高德地图 Web 服务 API（地址解析/逆地理编码/距离计算） |
| 支付 | 支付宝 SDK / 微信支付回调 / 余额支付 |
| PDF 生成 | pdfkit (中文报表导出) |
| 安全 | Helmet · Rate Limiting · CORS · 参数化 SQL · 输入校验 |
### 项目结构
```
yanfu_backend/
├── app.js                  # 入口文件（路由注册、cron、中间件）
├── ecosystem.config.js     # PM2 进程配置
├── routes/                 # API 路由层（9 个分组，60+ 端点）
│   ├── auth.js             # 认证（用户/商家/骑手/管理员）
│   ├── user.js             # 用户端（下单/购物车/评价）
│   ├── merchant.js         # 商家端（菜单/接单/报表/结算）
│   ├── rider.js            # 骑手端（接单/定位/收入）
│   ├── wallet.js           # 钱包（充值/余额/流水）
│   ├── admin.js            # 管理后台
│   ├── ticket.js           # 工单系统
│   ├── analytics.js        # 数据分析
│   └── ...                 # 其他路由
├── services/               # 业务服务层
│   ├── settlement.js       # T+1 自动结算服务
│   ├── report-pdf.js       # PDF 报表生成
│   ├── websocket.js        # WebSocket 实时通讯
│   ├── payment.js          # 支付服务
│   └── map.js              # 高德地图服务
├── ai_modules/             # AI 智能模块（8 个子模块）
│   ├── rider_dispatch/     # 智能派单
│   ├── dynamic_pricing/    # 动态定价
│   ├── live_map/           # 活地图
│   ├── pre_position/       # 预置运力
│   ├── relay_delivery/     # 接力配送
│   ├── blind_box/          # 盲盒订单
│   ├── carbon_credit/      # 碳信用
│   └── credit_passport/    # 信用通行证
├── middleware/             # 中间件层
│   ├── auth.js             # JWT 验证
│   ├── errorHandler.js     # 全局错误处理 + 错误码体系
│   └── validation.js       # 参数校验
├── config/                 # 配置
│   ├── database.js         # 数据库连接池
│   ├── ai_modules.js       # AI 模块配置
│   └── error_codes.js      # 错误码定义
├── tests/                  # 自动化测试
│   ├── auth.test.js        # 认证模块测试（6 用例）
│   └── wallet.test.js      # 钱包模块测试（12 用例）
├── migrations/             # 数据库迁移脚本
├── Dockerfile              # Docker 构建
└── docker-compose.yml      # Docker 编排
```
## 🚀 快速部署
### 前置要求
- Node.js 22+
- MySQL 5.7+
- npm / Docker
### 方式一：Docker 一键部署（推荐）
```bash
# 1. 克隆项目
git clone <repo-url>
cd yanfu_backend
# 2. 启动（自动构建 + 数据库初始化）
docker compose up -d
# 3. 验证
curl http://localhost:3000/health    # → {"status":"ok","database":"connected"}
curl http://localhost:3000/ready     # → {"status":"ready"}
```
### 方式二：本地开发
```bash
# 1. 安装依赖
npm install
# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入数据库连接信息
# 3. 初始化数据库
mysql -u root -p < migrations/001_phase1_core_tables.sql
# 4. 启动
npm start
# 5. 运行测试
npm test
```
## 🧪 测试套件
### 自动化测试
```bash
# 一条命令运行全部测试
npm test
# 输出示例
# Test Suites: 2 passed, 2 total
# Tests:       18 passed, 18 total
# Time:        0.75 s
```
当前覆盖模块：**Auth**（6 用例）+ **Wallet**（12 用例）
### 全链路验收测试
| 测试类别 | 用例数 | 通过率 |
|---------|:------:|:-----:|
| E2E 全流程（用户→下单→接单→配送） | 30 | 100% |
| 钱包异常（并发50线程/非法金额/精度/幂等） | 15 | 100% |
| 权限安全（JWT/SQL注入/XSS/跨角色访问） | 12 | 100% |
| **总计** | **57** | **100%** |
### 性能基线
| 并发 | TPS | P50 | P95 | P99 | 内存 |
|------|-----|-----|-----|-----|------|
| 10   | 1,596 | 5ms  | 13ms | 18ms | 859MB |
| 50   | 1,771 | 26ms | 49ms | 58ms | 859MB |
| 100  | 1,757 | 55ms | 88ms | 94ms | 859MB |
| 200  | 1,724 | 105ms| 147ms| 212ms| 965MB |
| 500  | 1,703 | 236ms| 329ms| 2386ms| 965MB |
> 测试环境: 1.9G RAM / 40G disk / Ubuntu 6.8.0 / MySQL 5.7
## 🔐 安全保障
- **JWT 四级权限**: 用户 / 商家 / 骑手 / 管理员，严格隔离
- **参数化查询**: 所有 SQL 通过 `mysql2` 参数化接口，杜绝注入
- **Helmet 安全头**: CSP / HSTS / X-Frame-Options / X-Content-Type-Options
- **Rate Limiting**: 按接口分级限流（认证 200r/m，支付 60r/m，上传 30r/m）
- **金额精度校验**: DECIMAL 定点存储 + 服务端 2 位小数校验
- **事务保护**: 钱包 / 订单 / 支付 / 结算关键路径均有事务
- **输入校验**: 统一参数校验，拒绝非法类型和边界值
## 📊 数据库
| 指标 | 数值 |
|------|:----:|
| 数据库引擎 | MySQL 5.7 |
| 数据表 | 97 张 |
| 金额字段 | 52 个 DECIMAL + 3 个 INT（零 FLOAT/DOUBLE）|
| 备份策略 | 每日自动备份，保留 30 天 |
| 恢复方式 | `bash /root/backups/restore.sh` |
## 🗺️ 覆盖区域
盐城市 9 个区县，每区县至少 1 个配送到家商家：
| 区县 | 测试商家 | 核心菜品 |
|------|---------|---------|
| 亭湖区 | 测试快餐店 | 招牌牛肉面 ¥28 |
| 盐都区 | 盐都老味道 | 大煮干丝 ¥28 |
| 大丰区 | 大丰食府 | 大丰红烧肉 ¥38 |
| 射阳县 | 射阳海鲜楼 | 清蒸大闸蟹 ¥68 |
| 建湖县 | 建湖生态农庄 | 土鸡汤 ¥42 |
| 阜宁县 | 阜宁大糕坊 | 阜宁大糕 ¥18 |
| 滨海县 | 滨海家常菜 | 猪头肉 ¥32 |
| 响水县 | 响水淮扬楼 | 红烧鳗鱼 ¥55 |
| 东台市 | 东台鱼汤面馆 | 鱼汤面 ¥15 |
## 📜 更新历史
详见 [CHANGELOG.md](./CHANGELOG.md)
- **v1.0.0-rc1** (2026-07-03): 钱包系统 · 自动结算 · PDF 报表 · 高德地图集成 · 测试框架 · Docker 部署 · CI 配置
## 📮 联系方式
项目作者：中哥
项目状态：Release Candidate (RC)
