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
 * 协同配送模块 - Joi 参数校验
 *
 * @module ai_modules/relay_delivery/validators
 */

const Joi = require('joi');

const locationSchema = Joi.object({
  lng: Joi.number().min(-180).max(180).required().label('经度'),
  lat: Joi.number().min(-90).max(90).required().label('纬度'),
});

/**
 * 拆单请求校验
 */
const splitSchema = Joi.object({
  order_id: Joi.number().integer().min(1).required()
    .label('订单ID'),
  merchant_location: locationSchema.required()
    .label('商家位置'),
  customer_location: locationSchema.required()
    .label('用户位置'),
  total_distance: Joi.number().integer().min(0).required()
    .label('总距离（米）'),
  estimated_time: Joi.number().integer().min(0).optional()
    .label('预估时长（秒）'),
  total_fee: Joi.number().min(0).required()
    .label('配送费（元）'),
  order_amount: Joi.number().min(0).required()
    .label('订单金额（元）'),
  tags: Joi.array().items(Joi.string()).optional()
    .label('商品标签列表'),
  no_relay: Joi.boolean().optional().default(false)
    .label('用户拒绝接力配送'),
});

/**
 * 获取接力配送详情校验
 */
const getOrderSchema = Joi.object({
  id: Joi.number().integer().min(1).required()
    .label('接力订单ID'),
});

/**
 * 骑手到达接力点校验
 */
const arriveSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID'),
  location: locationSchema.required()
    .label('当前位置'),
  arrived_at: Joi.date().iso().optional()
    .label('到达时间'),
});

/**
 * 交接确认校验
 */
const handoffSchema = Joi.object({
  rider_id: Joi.number().integer().min(1).required()
    .label('骑手ID'),
  confirm_method: Joi.string().valid('scan_qr', 'photo', 'manual').required()
    .label('确认方式'),
  package_condition: Joi.string().valid('good', 'damaged').default('good')
    .label('包裹状况'),
  note: Joi.string().max(200).allow('').optional()
    .label('备注'),
  counterpart_rider_id: Joi.number().integer().min(1).optional()
    .label('对接骑手ID'),
});

/**
 * 进度查询校验
 */
const progressSchema = Joi.object({
  order_id: Joi.number().integer().min(1).required()
    .label('原始订单ID'),
});

/**
 * 获取接力点列表校验
 */
const listStationsSchema = Joi.object({
  type: Joi.number().integer().min(0).max(3).optional()
    .label('接力点类型'),
  status: Joi.number().integer().min(0).max(2).optional()
    .label('接力点状态'),
  page: Joi.number().integer().min(1).default(1)
    .label('页码'),
  size: Joi.number().integer().min(1).max(100).default(20)
    .label('每页条数'),
});

/**
 * 新增接力点校验
 */
const createStationSchema = Joi.object({
  name: Joi.string().max(100).required()
    .label('接力点名称'),
  type: Joi.number().integer().min(0).max(3).required()
    .label('类型: 0=驿站 1=商户 2=公共 3=虚拟'),
  location: locationSchema.required()
    .label('坐标'),
  address: Joi.string().max(255).allow('').optional()
    .label('地址'),
  business_hours: Joi.object({
    open: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
      .label('营业开始时间'),
    close: Joi.string().pattern(/^\d{2}:\d{2}$/).required()
      .label('营业结束时间'),
  }).optional()
    .label('营业时间'),
  amenities: Joi.array().items(Joi.string()).optional()
    .label('设施列表'),
});

module.exports = {
  splitSchema,
  getOrderSchema,
  arriveSchema,
  handoffSchema,
  progressSchema,
  listStationsSchema,
  createStationSchema,
};
