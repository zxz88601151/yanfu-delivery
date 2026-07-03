'use strict';

/**
 * 活地图模块 - Joi 参数校验
 *
 * @module ai_modules/live_map/validators
 */

const Joi = require('joi');

/**
 * 路况类型列表
 */
const REPORT_TYPES = [1, 2, 3, 4, 5, 6];

/**
 * POST /reports - 提交路况上报
 */
const submitReportSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID')
    .messages({
      'number.base': 'rider_id 必须是整数',
      'any.required': 'rider_id 是必填参数',
    }),

  report_type: Joi.number().integer().valid(...REPORT_TYPES).required()
    .label('路况类型')
    .messages({
      'number.base': 'report_type 必须是整数',
      'any.only': 'report_type 必须在 1-6 之间',
      'any.required': 'report_type 是必填参数',
    }),

  location: Joi.object({
    lng: Joi.number().min(-180).max(180).required()
      .label('经度'),
    lat: Joi.number().min(-90).max(90).required()
      .label('纬度'),
  }).required()
    .label('GPS坐标')
    .messages({
      'object.base': 'location 必须是对象',
      'any.required': 'location 是必填参数',
    }),

  gps_accuracy: Joi.number().integer().min(0).max(1000).default(0)
    .label('GPS精度')
    .messages({
      'number.base': 'gps_accuracy 必须是整数',
      'number.min': 'gps_accuracy 不能小于 0',
    }),

  address: Joi.string().max(255).allow('').optional()
    .label('地址'),

  description: Joi.string().max(200).allow('').optional()
    .label('描述'),

  images: Joi.array().items(
    Joi.string().uri().max(500),
  ).max(3).optional()
    .label('图片URL列表'),

}).required();

/**
 * GET /reports - 查询上报列表（P1）
 */
const listReportsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .label('页码'),
  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数'),
  status: Joi.number().integer().valid(0, 1, 2, 3).optional()
    .label('状态'),
  report_type: Joi.number().integer().valid(...REPORT_TYPES).optional()
    .label('路况类型'),
  rider_id: Joi.number().integer().min(1).optional()
    .label('骑手ID'),
  start_date: Joi.date().iso().optional()
    .label('开始日期'),
  end_date: Joi.date().iso().optional()
    .label('结束日期'),
});

/**
 * GET /heatmap - 获取热力图
 */
const heatmapSchema = Joi.object({
  bounds: Joi.string().optional()
    .label('地图范围'),
  zoom: Joi.number().integer().min(1).max(20).optional()
    .label('缩放级别'),
  district_ids: Joi.string().optional()
    .label('区域ID列表'),
});

/**
 * GET /conditions - 获取路况列表（P1）
 */
const listConditionsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1)
    .label('页码'),
  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数'),
  status: Joi.number().integer().valid(0, 1, 2, 3).optional()
    .label('状态'),
  difficulty_level: Joi.number().integer().valid(0, 1, 2, 3).optional()
    .label('难度等级'),
  district_id: Joi.number().integer().min(1).optional()
    .label('区域ID'),
});

/**
 * POST /conditions/:id/expire - 手动过期红区（P2）
 */
const expireConditionSchema = Joi.object({
  // 路径参数 id 在 controller 中处理
});

/**
 * GET /routes/avoid-advice - 获取避让建议（P1）
 */
const avoidAdviceSchema = Joi.object({
  from_lng: Joi.number().min(-180).max(180).required()
    .label('起点经度')
    .messages({ 'any.required': 'from_lng 是必填参数' }),
  from_lat: Joi.number().min(-90).max(90).required()
    .label('起点纬度')
    .messages({ 'any.required': 'from_lat 是必填参数' }),
  to_lng: Joi.number().min(-180).max(180).required()
    .label('终点经度')
    .messages({ 'any.required': 'to_lng 是必填参数' }),
  to_lat: Joi.number().min(-90).max(90).required()
    .label('终点纬度')
    .messages({ 'any.required': 'to_lat 是必填参数' }),
  rider_id: Joi.number().integer().min(1).optional()
    .label('骑手ID'),
});

/**
 * GET /stats - 统计仪表盘（P2）
 */
const statsSchema = Joi.object({
  date: Joi.date().iso().optional()
    .label('日期'),
});

module.exports = {
  submitReportSchema,
  listReportsSchema,
  heatmapSchema,
  listConditionsSchema,
  expireConditionSchema,
  avoidAdviceSchema,
  statsSchema,
};
