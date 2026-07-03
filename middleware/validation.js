/**
 * 盐阜配送 - Joi输入验证中间件
 * 
 * 使用方法:
 * const { validateUserRegister } = require('../middleware/validation');
 * router.post('/user/register', validateUserRegister, handler);
 */

const Joi = require('joi');

// ========== 通用验证函数 ==========

/**
 * 创建验证中间件
 */
function createValidationMiddleware(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,  // 返回所有错误
      stripUnknown: true, // 移除未知字段
      convert: true       // 类型转换
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, '')
      }));

      return res.status(400).json({
        success: false,
        message: '请求参数验证失败',
        error: {
          code: 400001,
          type: 'VALIDATION_ERROR',
          details: details
        }
      });
    }

    // 使用验证后的值（已清理）
    req.body = value;
    next();
  };
}

// ========== 认证相关验证 ==========

/**
 * 用户注册验证
 */
const userRegisterSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.min': '姓名至少2个字符',
    'string.max': '姓名不能超过50个字符',
    'any.required': '姓名不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确',
    'any.required': '手机号不能为空'
  }),
  password: Joi.string().min(6).max(100).required().messages({
    'string.min': '密码至少6位',
    'string.max': '密码不能超过100位',
    'any.required': '密码不能为空'
  }),
  address: Joi.string().max(200).optional().allow('')
});

exports.validateUserRegister = createValidationMiddleware(userRegisterSchema);

/**
 * 用户登录验证
 */
const loginSchema = Joi.object({
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确',
    'any.required': '手机号不能为空'
  }),
  password: Joi.string().min(1).required().messages({
    'any.required': '密码不能为空'
  })
});

exports.validateLogin = createValidationMiddleware(loginSchema);

/**
 * 骑手注册验证
 */
const riderRegisterSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'string.min': '姓名至少2个字符',
    'string.max': '姓名不能超过50个字符',
    'any.required': '姓名不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确',
    'any.required': '手机号不能为空'
  }),
  password: Joi.string().min(6).max(100).required().messages({
    'string.min': '密码至少6位',
    'any.required': '密码不能为空'
  })
});

exports.validateRiderRegister = createValidationMiddleware(riderRegisterSchema);

/**
 * 商家注册验证
 */
const merchantRegisterSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    'string.min': '店名至少2个字符',
    'any.required': '店名不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确',
    'any.required': '手机号不能为空'
  }),
  password: Joi.string().min(6).max(100).required().messages({
    'string.min': '密码至少6位',
    'any.required': '密码不能为空'
  }),
  address: Joi.string().max(200).optional(),
  category: Joi.string().max(50).optional()
});

exports.validateMerchantRegister = createValidationMiddleware(merchantRegisterSchema);

/**
 * 管理员登录验证
 */
const adminLoginSchema = Joi.object({
  username: Joi.string().min(3).max(50).required().messages({
    'string.min': '用户名至少3个字符',
    'any.required': '用户名不能为空'
  }),
  password: Joi.string().min(1).required().messages({
    'any.required': '密码不能为空'
  })
});

exports.validateAdminLogin = createValidationMiddleware(adminLoginSchema);

// ========== 用户端验证 ==========

/**
 * 创建订单验证
 */
const createOrderSchema = Joi.object({
  merchantId: Joi.number().integer().positive().required().messages({
    'number.base': '商家ID必须是数字',
    'any.required': '商家ID不能为空'
  }),
  items: Joi.array().items(
    Joi.object({
      menuId: Joi.number().integer().positive().required(),
      quantity: Joi.number().integer().min(1).max(99).required(),
      price: Joi.number().positive().required()
    })
  ).min(1).required().messages({
    'array.min': '至少选择一个商品',
    'any.required': '商品列表不能为空'
  }),
  addressId: Joi.number().integer().positive().required().messages({
    'any.required': '收货地址不能为空'
  }),
  remark: Joi.string().max(200).optional().allow(''),
  couponId: Joi.number().integer().positive().optional().allow(null)
});

exports.validateCreateOrder = createValidationMiddleware(createOrderSchema);

/**
 * 添加地址验证
 */
const addAddressSchema = Joi.object({
  name: Joi.string().min(2).max(50).required().messages({
    'any.required': '收货人姓名不能为空'
  }),
  phone: Joi.string().pattern(/^1[3-9]\d{9}$/).required().messages({
    'string.pattern.base': '手机号格式不正确'
  }),
  address: Joi.string().min(5).max(200).required().messages({
    'string.min': '地址至少5个字符',
    'any.required': '地址不能为空'
  }),
  isDefault: Joi.boolean().optional().default(false)
});

exports.validateAddAddress = createValidationMiddleware(addAddressSchema);

// ========== 骑手端验证 ==========

/**
 * 位置更新验证
 */
const locationUpdateSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required().messages({
    'any.required': '纬度不能为空'
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    'any.required': '经度不能为空'
  }),
  accuracy: Joi.number().positive().optional(),
  timestamp: Joi.number().integer().optional()
});

exports.validateLocationUpdate = createValidationMiddleware(locationUpdateSchema);

/**
 * 接单验证
 */
const acceptOrderSchema = Joi.object({
  orderId: Joi.string().required().messages({
    'any.required': '订单ID不能为空'
  })
});

exports.validateAcceptOrder = createValidationMiddleware(acceptOrderSchema);

// ========== 商家端验证 ==========

/**
 * 添加菜品验证
 */
const addMenuItemSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    'any.required': '菜品名称不能为空'
  }),
  price: Joi.number().positive().required().messages({
    'any.required': '价格不能为空'
  }),
  category: Joi.string().max(50).optional().default('其他'),
  description: Joi.string().max(500).optional().allow(''),
  image: Joi.string().uri().optional().allow(''),
  isAvailable: Joi.boolean().optional().default(true)
});

exports.validateAddMenuItem = createValidationMiddleware(addMenuItemSchema);

// ========== 查询参数验证 ==========

/**
 * 分页查询验证
 */
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

exports.validatePagination = (req, res, next) => {
  const { error, value } = paginationSchema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: '查询参数验证失败',
      error: {
        code: 400001,
        type: 'VALIDATION_ERROR',
        details: error.details.map(d => d.message)
      }
    });
  }

  req.query = value;
  next();
};

// ========== 导出所有验证器 ==========
exports.createValidationMiddleware = createValidationMiddleware;
