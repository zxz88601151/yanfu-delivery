# 后端开发指南

## 安装依赖

```bash
npm install
```

注意：Joi验证库已集成，无需额外安装。

## 运行服务

### 开发模式
```bash
npm run dev
```

### 生产模式
```bash
npm start
```

## 输入验证

所有API路由已集成Joi验证中间件，位于 `middleware/validation.js`。

### 使用示例

```javascript
const { validateUserRegister, validateLogin } = require('../middleware/validation');

// 自动验证请求体
router.post('/user/register', validateUserRegister, async (req, res) => {
  // req.body 已经是验证后的数据
  const { name, phone, password } = req.body;
  // ...
});
```

### 可用验证器

**认证相关**:
- `validateUserRegister` - 用户注册
- `validateRiderRegister` - 骑手注册
- `validateMerchantRegister` - 商家注册
- `validateLogin` - 通用登录
- `validateAdminLogin` - 管理员登录

**用户端**:
- `validateCreateOrder` - 创建订单
- `validateAddAddress` - 添加地址

**骑手端**:
- `validateLocationUpdate` - 位置更新
- `validateAcceptOrder` - 接单

**商家端**:
- `validateAddMenuItem` - 添加菜品

**通用**:
- `validatePagination` - 分页查询参数

### 自定义验证器

在 `middleware/validation.js` 中添加新的验证schema：

```javascript
const mySchema = Joi.object({
  field: Joi.string().required()
});

exports.validateMyEndpoint = createValidationMiddleware(mySchema);
```

## 错误处理

验证失败会自动返回400错误，格式如下：

```json
{
  "success": false,
  "message": "请求参数验证失败",
  "error": {
    "code": 400001,
    "type": "VALIDATION_ERROR",
    "details": [
      {
        "field": "phone",
        "message": "手机号格式不正确"
      }
    ]
  }
}
```

## 测试

```bash
npm test
```

## 代码质量

```bash
# 运行ESLint（如果配置）
npm run lint
```
