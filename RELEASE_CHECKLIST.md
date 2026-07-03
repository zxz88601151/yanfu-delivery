# 盐阜配送平台 - Release Checklist

## v1.0.0-rc1 发布验收清单

### 工程质量
- [ ] 所有自动化测试通过 (`npm test`)
- [ ] 无 P0/P1 未解决缺陷
- [ ] Docker 构建成功 (`docker build -t kuailv-app .`)
- [ ] 性能基线达标 (TPS ≥ 1000, P95 < 500ms)

### 数据
- [ ] 数据库备份已验证可恢复
- [ ] 定时任务已验证注册
- [ ] 钱包交易一致性验证
- [ ] 结算幂等验证

### 安全
- [ ] JWT 认证覆盖所有敏感接口
- [ ] 权限隔离（用户/商家/骑手/管理员）
- [ ] 限流配置已生效
- [ ] SQL 注入防护
- [ ] XSS 防护

### 运维
- [ ] `/health` 返回正常
- [ ] `/ready` 返回正常
- [ ] 日志可追溯（RequestId/TraceId）
- [ ] 数据库备份自动执行
- [ ] Docker Compose 一键启动成功

### 文档
- [ ] README.md 完成
- [ ] CHANGELOG.md 更新
- [ ] .env.example 最新
- [ ] API 文档（Swagger/OpenAPI）

### 发布
- [ ] Git tag 已创建 (`v1.0.0-rc1`)
- [ ] Release Notes 已编写
- [ ] 灰度策略已确认
- [ ] 回滚方案已准备

---

## 性能基线 (2026-07-03)

| 并发 | TPS | P50 | P95 | P99 | CPU | 内存 |
|------|-----|-----|-----|-----|-----|------|
| 10   | 1,596 | 5ms  | 13ms  | 18ms  | -  | 859MB |
| 50   | 1,771 | 26ms | 49ms  | 58ms  | -  | 859MB |
| 100  | 1,757 | 55ms | 88ms  | 94ms  | -  | 859MB |
| 200  | 1,724 | 105ms| 147ms | 212ms | -  | 965MB |
| 500  | 1,703 | 236ms| 329ms | 2386ms| -  | 965MB |

**测试环境**: 1.9G RAM / 40G disk / Ubuntu 6.8.0 / MySQL 5.7
**瓶颈**: 500 并发时 P99 升至 2.3s，连接排队开始明显
**建议**: 建议线上生产环境至少 4G RAM，P99 可降至 500ms 以内

---

© 中哥  All Rights Reserved. 商用需联系本人授权
FP_UUID_31adb5871aea40b8b0c288773f094ab2|FP_AUTHOR_中哥_SN_20260531|FP_HASH_20260531B9F3|FP_ORIGIN_2026_AUTHOR_中哥
