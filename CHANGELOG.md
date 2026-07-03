# Changelog

## v1.0.0-rc1 (2026-07-03)

### 新增功能
- **钱包系统**: 用户充值、余额查询、交易流水、汇总统计
- **商家结算**: T+1 自动结算 cron、手工触发、幂等保护
- **PDF 报表**: 经营报表 PDF 下载（含概要面板 + 每日明细表格）
- **高德地图集成**: Web 服务 API 签名验证、地址解析、逆地理编码
- **健康检查**: GET /health（存活+DB检查）、GET /ready（就绪探针）
- **自动化测试**: Jest + Supertest 测试框架（Auth + Wallet 18 个测试）

### 修复
- Cron 定时任务 MySQL ECONNREFUSED（共享连接池替代独立连接）
- PrePosition surge_start 日期格式（ISO 8601 → MySQL DATETIME）
- 动态定价报表空值异常（null → 0 保护）
- merchant_orders 表缺少 remark 列
- 钱包充值精度校验缺失（添加 2 位小数限制）

### 工程化
- 数据库备份 + 恢复脚本 (/root/backups/)
- 唯一约束（merchant_settlements 幂等兜底）
- 事务保护覆盖钱包/结算/提现关键路径
- Dockerfile + docker-compose + .env.example
- 盐城 9 区县数据初始化
- 性能基线报告（500 并发下 1,703 TPS）

### 技术栈
- Node.js 22 + Express
- MySQL 5.7
- PM2 进程管理
- WebSocket (Socket.IO)
- JWT 认证
- pdfkit（PDF 生成）
- 高德地图 Web 服务 API


