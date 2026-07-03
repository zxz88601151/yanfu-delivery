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
 * 预置运力模块 - Joi 参数校验
 *
 * @module ai_modules/pre_position/validators
 */

const Joi = require('joi');

/**
 * 获取爆单预测列表 - 查询参数校验
 * GET /pre_position/predictions
 */
const predictionsQuerySchema = Joi.object({
  district_ids: Joi.string().optional()
    .label('区域ID列表（逗号分隔）')
    .messages({
      'string.base': 'district_ids 必须是字符串',
    }),
  min_intensity: Joi.number().integer().min(0).max(5).optional()
    .label('最低爆单强度')
    .messages({
      'number.base': 'min_intensity 必须是整数',
      'number.min': 'min_intensity 不能小于 0',
      'number.max': 'min_intensity 不能大于 5',
    }),
  status: Joi.number().integer().valid(0, 1, 2).optional()
    .label('预测状态')
    .messages({
      'number.base': 'status 必须是整数',
      'number.valid': 'status 必须为 0(待验证), 1(活跃), 2(已过期)',
    }),
  page: Joi.number().integer().min(1).default(1)
    .label('页码')
    .messages({
      'number.base': 'page 必须是整数',
      'number.min': 'page 不能小于 1',
    }),
  page_size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数')
    .messages({
      'number.base': 'page_size 必须是整数',
      'number.min': 'page_size 不能小于 1',
      'number.max': 'page_size 不能大于 100',
    }),
});

/**
 * 发起预置调度 - 请求体校验
 * POST /pre_position/dispatch
 */
const createDispatchSchema = Joi.object({
  prediction_id: Joi.number().integer().positive().required()
    .label('预测ID')
    .messages({
      'number.base': 'prediction_id 必须是整数',
      'any.required': 'prediction_id 是必填参数',
    }),
  dispatch_type: Joi.number().integer().valid(1, 2).default(1)
    .label('调度类型')
    .messages({
      'number.base': 'dispatch_type 必须是整数',
      'number.valid': 'dispatch_type 必须为 1(预置调度) 或 2(补充调度)',
    }),
  rider_ids: Joi.array().items(Joi.number().integer().positive()).optional()
    .label('指定骑手ID列表')
    .messages({
      'array.base': 'rider_ids 必须是数组',
    }),
  force: Joi.boolean().default(false)
    .label('是否强制调度')
    .messages({
      'boolean.base': 'force 必须是布尔值',
    }),
});

/**
 * 骑手响应调度 - 请求体校验
 * POST /pre_position/dispatch/:id/respond
 */
const respondDispatchSchema = Joi.object({
  rider_id: Joi.number().integer().positive().required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),
  action: Joi.string().valid('accept', 'reject').required()
    .label('响应动作')
    .messages({
      'string.base': 'action 必须是字符串',
      'any.only': 'action 必须为 accept 或 reject',
      'any.required': 'action 是必填参数',
    }),
  reason: Joi.string().valid('too_far', 'busy', 'other').optional()
    .label('拒绝原因')
    .messages({
      'string.base': 'reason 必须是字符串',
      'any.only': 'reason 必须为 too_far, busy 或 other',
    }),
});

/**
 * 骑手到达标记 - 请求体校验
 * PUT /pre_position/dispatch/:id/arrive
 */
const arriveDispatchSchema = Joi.object({
  rider_id: Joi.number().integer().positive().required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),
  location: Joi.object({
    lng: Joi.number().min(-180).max(180).required()
      .label('经度')
      .messages({ 'any.required': 'location.lng 是必填参数' }),
    lat: Joi.number().min(-90).max(90).required()
      .label('纬度')
      .messages({ 'any.required': 'location.lat 是必填参数' }),
  }).required()
    .label('位置信息')
    .messages({
      'object.base': 'location 必须是对象',
      'any.required': 'location 是必填参数',
    }),
  arrived_at: Joi.string().isoDate().optional()
    .label('到达时间')
    .messages({
      'string.base': 'arrived_at 必须是字符串',
      'string.isoDate': 'arrived_at 必须是 ISO 8601 格式',
    }),
});

/**
 * 仪表盘 - 查询参数校验
 * GET /pre_position/dashboard
 */
const dashboardQuerySchema = Joi.object({
  start_date: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required()
    .label('开始日期')
    .messages({
      'string.base': 'start_date 必须是字符串',
      'string.pattern.base': 'start_date 格式必须为 YYYY-MM-DD',
      'any.required': 'start_date 是必填参数',
    }),
  end_date: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required()
    .label('结束日期')
    .messages({
      'string.base': 'end_date 必须是字符串',
      'string.pattern.base': 'end_date 格式必须为 YYYY-MM-DD',
      'any.required': 'end_date 是必填参数',
    }),
  district_ids: Joi.string().optional()
    .label('区域ID列表（逗号分隔）')
    .messages({
      'string.base': 'district_ids 必须是字符串',
    }),
});

/**
 * 商圈活动 - 请求体校验（P1）
 * POST /pre_position/events
 */
const eventSchema = Joi.object({
  district_id: Joi.number().integer().positive().required()
    .label('区域ID')
    .messages({
      'number.base': 'district_id 必须是整数',
      'any.required': 'district_id 是必填参数',
    }),
  event_name: Joi.string().min(2).max(128).required()
    .label('活动名称')
    .messages({
      'string.base': 'event_name 必须是字符串',
      'string.min': 'event_name 不能少于2个字符',
      'string.max': 'event_name 不能超过128个字符',
      'any.required': 'event_name 是必填参数',
    }),
  event_date: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required()
    .label('活动日期')
    .messages({
      'string.pattern.base': 'event_date 格式必须为 YYYY-MM-DD',
      'any.required': 'event_date 是必填参数',
    }),
  event_time_start: Joi.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).required()
    .label('开始时间')
    .messages({
      'string.pattern.base': 'event_time_start 格式必须为 HH:mm 或 HH:mm:ss',
      'any.required': 'event_time_start 是必填参数',
    }),
  event_time_end: Joi.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).required()
    .label('结束时间')
    .messages({
      'string.pattern.base': 'event_time_end 格式必须为 HH:mm 或 HH:mm:ss',
      'any.required': 'event_time_end 是必填参数',
    }),
  expected_boost_pct: Joi.number().min(0).max(1000).required()
    .label('预期提升百分比')
    .messages({
      'number.base': 'expected_boost_pct 必须是数字',
      'any.required': 'expected_boost_pct 是必填参数',
    }),
  remark: Joi.string().max(255).optional().allow('')
    .label('备注')
    .messages({
      'string.base': 'remark 必须是字符串',
      'string.max': 'remark 不能超过255个字符',
    }),
});

module.exports = {
  predictionsQuerySchema,
  createDispatchSchema,
  respondDispatchSchema,
  arriveDispatchSchema,
  dashboardQuerySchema,
  eventSchema,
};
