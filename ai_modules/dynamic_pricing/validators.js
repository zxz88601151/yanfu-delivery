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

'use strict';

/**
 * 动态定价模块 - Joi 参数校验
 *
 * @module ai_modules/dynamic_pricing/validators
 */

const Joi = require('joi');

/**
 * 估算配送费请求校验
 */
const estimateSchema = Joi.object({
  user_id: Joi.number().integer().min(1).required()
    .label('用户ID')
    .messages({
      'number.base': 'user_id 必须是整数',
      'any.required': 'user_id 是必填参数',
    }),

  merchant_lng: Joi.number().min(-180).max(180).required()
    .label('商家经度')
    .messages({
      'number.base': 'merchant_lng 必须是数字',
      'number.min': 'merchant_lng 超出范围',
      'number.max': 'merchant_lng 超出范围',
      'any.required': 'merchant_lng 是必填参数',
    }),

  merchant_lat: Joi.number().min(-90).max(90).required()
    .label('商家纬度')
    .messages({
      'number.base': 'merchant_lat 必须是数字',
      'number.min': 'merchant_lat 超出范围',
      'number.max': 'merchant_lat 超出范围',
      'any.required': 'merchant_lat 是必填参数',
    }),

  delivery_lng: Joi.number().min(-180).max(180).required()
    .label('配送经度')
    .messages({
      'number.base': 'delivery_lng 必须是数字',
      'any.required': 'delivery_lng 是必填参数',
    }),

  delivery_lat: Joi.number().min(-90).max(90).required()
    .label('配送纬度')
    .messages({
      'number.base': 'delivery_lat 必须是数字',
      'any.required': 'delivery_lat 是必填参数',
    }),

  district_id: Joi.number().integer().min(1).required()
    .label('区域ID')
    .messages({
      'number.base': 'district_id 必须是整数',
      'any.required': 'district_id 是必填参数',
    }),
});

/**
 * 区域热力图查询参数校验
 */
const zoneQuerySchema = Joi.object({
  district_ids: Joi.string().allow('').optional()
    .label('区域ID列表（逗号分隔）')
    .messages({
      'string.base': 'district_ids 必须是字符串',
    }),
});

/**
 * 更新定价配置校验
 */
const updateConfigSchema = Joi.object({
  configs: Joi.array().items(
    Joi.object({
      config_key: Joi.string().max(64).required()
        .label('配置键'),
      config_value: Joi.any().required()
        .label('配置值'),
    }),
  ).min(1).max(50).required()
    .label('配置列表')
    .messages({
      'array.base': 'configs 必须是数组',
      'array.min': '至少需要 1 个配置项',
      'array.max': '最多支持 50 个配置项',
      'any.required': 'configs 是必填参数',
    }),
});

/**
 * 定价日志查询参数校验
 */
const logsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .label('页码'),
  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数'),
  district_id: Joi.number().integer().min(1).optional()
    .label('区域ID'),
  start_date: Joi.date().iso().optional()
    .label('开始日期'),
  end_date: Joi.date().iso().optional()
    .label('结束日期'),
  user_id: Joi.number().integer().min(1).optional()
    .label('用户ID'),
});

/**
 * 报表查询参数校验
 */
const reportQuerySchema = Joi.object({
  dimension: Joi.string().valid('district', 'time_slot', 'weather').default('district')
    .label('分析维度'),
  start_date: Joi.date().iso().required()
    .label('开始日期')
    .messages({ 'any.required': 'start_date 是必填参数' }),
  end_date: Joi.date().iso().required()
    .label('结束日期')
    .messages({ 'any.required': 'end_date 是必填参数' }),
  export: Joi.string().valid('csv').optional()
    .label('导出格式'),
});

module.exports = {
  estimateSchema,
  zoneQuerySchema,
  updateConfigSchema,
  logsQuerySchema,
  reportQuerySchema,
};
