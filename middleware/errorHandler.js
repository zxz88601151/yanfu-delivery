/**
 * 盐阜配送 - 全局错误处理中间件
 */

// 错误类型定义
const ErrorTypes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  BUSINESS_LOGIC_ERROR: 'BUSINESS_LOGIC_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// 错误码映射
const ErrorCodes = {
  // 验证错误 (400)
  [ErrorTypes.VALIDATION_ERROR]: { status: 400, code: 400001, message: '请求参数验证失败' },

  // 认证错误 (401)
  [ErrorTypes.AUTHENTICATION_ERROR]: { status: 401, code: 401001, message: '认证失败' },
  TOKEN_EXPIRED: { status: 401, code: 401002, message: '访问令牌已过期' },
  TOKEN_INVALID: { status: 401, code: 401003, message: '无效的认证令牌' },

  // 授权错误 (403)
  [ErrorTypes.AUTHORIZATION_ERROR]: { status: 403, code: 403001, message: '权限不足' },

  // 未找到错误 (404)
  [ErrorTypes.NOT_FOUND_ERROR]: { status: 404, code: 404001, message: '资源不存在' },

  // 数据库错误 (500)
  [ErrorTypes.DATABASE_ERROR]: { status: 500, code: 500001, message: '数据库操作失败' },

  // 外部服务错误 (502)
  [ErrorTypes.EXTERNAL_SERVICE_ERROR]: { status: 502, code: 502001, message: '外部服务调用失败' },

  // 业务逻辑错误 (422)
  [ErrorTypes.BUSINESS_LOGIC_ERROR]: { status: 422, code: 422001, message: '业务逻辑错误' },

  // 限流错误 (429)
  [ErrorTypes.RATE_LIMIT_ERROR]: { status: 429, code: 429001, message: '请求过于频繁' },

  // 内部错误 (500)
  [ErrorTypes.INTERNAL_ERROR]: { status: 500, code: 500000, message: '服务器内部错误' }
};

/**
 * 自定义应用错误类
 */
class AppError extends Error {
  constructor(type, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.details = details;
    this.timestamp = new Date().toISOString();

    // 获取错误码配置
    const errorConfig = ErrorCodes[type] || ErrorCodes[ErrorTypes.INTERNAL_ERROR];
    this.statusCode = errorConfig.status;
    this.errorCode = errorConfig.code;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 验证错误
 */
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(ErrorTypes.VALIDATION_ERROR, message, details);
  }
}

/**
 * 认证错误
 */
class AuthenticationError extends AppError {
  constructor(message = '认证失败') {
    super(ErrorTypes.AUTHENTICATION_ERROR, message);
  }
}

/**
 * 授权错误
 */
class AuthorizationError extends AppError {
  constructor(message = '权限不足') {
    super(ErrorTypes.AUTHORIZATION_ERROR, message);
  }
}

/**
 * 未找到错误
 */
class NotFoundError extends AppError {
  constructor(resource = '资源') {
    super(ErrorTypes.NOT_FOUND_ERROR, `${resource}不存在`);
  }
}

/**
 * 数据库错误
 */
class DatabaseError extends AppError {
  constructor(message = '数据库操作失败') {
    super(ErrorTypes.DATABASE_ERROR, message);
  }
}

/**
 * 业务逻辑错误
 */
class BusinessLogicError extends AppError {
  constructor(message) {
    super(ErrorTypes.BUSINESS_LOGIC_ERROR, message);
  }
}

/**
 * 全局错误处理中间件
 */
function globalErrorHandler(err, req, res, next) {
  // 记录错误日志
  logError(err, req);

  // [P0修复] 统一响应格式: 顶层必须有 message 字段（Flutter端读取）
  // 同时保留嵌套 error 对象供调试使用

  // 如果是自定义应用错误
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: {
        code: err.errorCode,
        type: err.type,
        message: err.message,
        details: err.details,
        timestamp: err.timestamp
      }
    });
  }

  // JWT错误处理
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: '无效的认证令牌',
      error: {
        code: 401003,
        type: ErrorTypes.AUTHENTICATION_ERROR,
        message: '无效的认证令牌'
      }
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: '访问令牌已过期',
      error: {
        code: 401002,
        type: ErrorTypes.AUTHENTICATION_ERROR,
        message: '访问令牌已过期',
        shouldRefresh: true
      }
    });
  }

  // [P0修复] express-rate-limit 的 X-Forwarded-For 配置错误
  // 当 Nginx 转发时会设置此header，但 trust proxy 未设置时会抛 ValidationError
  if (err.name === 'ValidationError' && err.message && err.message.includes('X-Forwarded-For')) {
    return res.status(500).json({
      success: false,
      message: '服务器配置错误，请稍后重试',
      error: {
        code: 500000,
        type: ErrorTypes.INTERNAL_ERROR,
        message: '服务器代理配置错误',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      }
    });
  }

  // MySQL错误处理
  if (err.code && err.code.startsWith('ER_')) {
    let message = '数据库操作失败';
    let statusCode = 500;

    switch (err.code) {
      case 'ER_DUP_ENTRY':
        message = '数据已存在';
        statusCode = 409;
        break;
      case 'ER_NO_REFERENCED_ROW':
      case 'ER_NO_REFERENCED_ROW_2':
        message = '引用的数据不存在';
        statusCode = 400;
        break;
      case 'ER_BAD_NULL_ERROR':
        message = '必填字段不能为空';
        statusCode = 400;
        break;
      case 'ER_DATA_TOO_LONG':
        message = '数据长度超出限制';
        statusCode = 400;
        break;
    }

    return res.status(statusCode).json({
      success: false,
      message: message,
      error: {
        code: 500001,
        type: ErrorTypes.DATABASE_ERROR,
        message: message,
        details: process.env.NODE_ENV === 'development' ? err.sqlMessage : undefined
      }
    });
  }

  // 默认内部错误
  const isDev = process.env.NODE_ENV === 'development';

  res.status(500).json({
    success: false,
    message: isDev ? err.message : '服务器内部错误',
    error: {
      code: 500000,
      type: ErrorTypes.INTERNAL_ERROR,
      message: isDev ? err.message : '服务器内部错误',
      stack: isDev ? err.stack : undefined
    }
  });
}

/**
 * 记录错误日志
 */
function logError(err, req) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      type: err.type,
      code: err.code
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user ? req.user.id : null
    }
  };

  // 控制台输出
  console.error('=================================');
  console.error('错误发生:', errorLog.timestamp);
  console.error('类型:', err.name);
  console.error('消息:', err.message);
  console.error('URL:', req.originalUrl);
  console.error('=================================');

  // 这里可以集成 Winston 或其他日志库写入文件
  // 生产环境可以发送到 Sentry、ELK 等监控系统
}

/**
 * 未捕获的Promise拒绝处理
 */
function setupUnhandledRejectionHandler() {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    // 记录到日志系统
    // 可以选择优雅地关闭进程
  });

  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    // 记录到日志系统
    // 优雅地关闭进程
    process.exit(1);
  });
}

/**
 * 异步错误包装器
 * 用于包装异步路由处理函数
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 请求验证中间件（使用Joi）
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));

      return res.status(400).json({
        success: false,
        error: {
          code: 400001,
          type: ErrorTypes.VALIDATION_ERROR,
          message: '请求参数验证失败',
          details: details
        }
      });
    }

    // 使用验证后的值
    req.body = value;
    next();
  };
}

module.exports = {
  ErrorTypes,
  ErrorCodes,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  DatabaseError,
  BusinessLogicError,
  globalErrorHandler,
  setupUnhandledRejectionHandler,
  asyncHandler,
  validateRequest
};
