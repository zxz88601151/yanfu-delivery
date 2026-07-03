/**
 * 盐阜配送 - AI智能派单系统配置
 * 五维评分权重 + 分段评分表 + 系统参数
 */

// ============================================================
// 五维评分权重（可动态调整，通过 admin API 更新）
// ============================================================
const SCORE_WEIGHTS = {
  DISTANCE: 0.30,    // 距离适配分 30%
  LOAD: 0.25,        // 骑手负载分 25%
  QUALITY: 0.20,     // 履约质量分 20%
  TIME_ENV: 0.15,    // 时段环境分 15%
  FAIRNESS: 0.10,    // 公平轮循修正分 10%
};

// ============================================================
// 距离评分表（单位: km, 满分30分）
// ============================================================
const DISTANCE_SCORE_TABLE = [
  { maxKm: 1.0,   minScore: 30, maxScore: 30, label: '0~1km' },
  { maxKm: 3.0,   minScore: 25, maxScore: 29, label: '1~3km' },
  { maxKm: 5.0,   minScore: 20, maxScore: 24, label: '3~5km' },
  { maxKm: Infinity, minScore: 10, maxScore: 19, label: '5km+' },
];

// ============================================================
// 负载评分表（单位: 当前进行中订单数, 满分25分）
// ============================================================
const LOAD_SCORE_TABLE = [
  { maxOrders: 0, score: 25, label: '0单' },
  { maxOrders: 1, score: 22, label: '1单' },
  { maxOrders: 2, score: 18, label: '2单' },
  { maxOrders: 3, score: 12, label: '3单' },
  { maxOrders: Infinity, score: 5, label: '≥4单' },
];

// ============================================================
// 履约质量评分（满分20分）
// ============================================================
const QUALITY_SCORE_TABLE = [
  { minRate: 0.98, score: 20, label: '≥98%' },
  { minRate: 0.95, score: 18, label: '95%~97%' },
  { minRate: 0.90, score: 15, label: '90%~94%' },
  { minRate: 0,    score: 10, label: '<90%' },
];

// 违规扣分（有违规记录则履约质量降为0）
const VIOLATION_PENALTY = 0;

// ============================================================
// 时段环境加分（满分15分基础上加分）
// ============================================================
const TIME_ENV_BONUS = {
  // 时段加分
  PEAK_LUNCH: 3,     // 午高峰 11:00-13:00
  PEAK_DINNER: 3,    // 晚高峰 17:00-19:00
  NIGHT: 5,          // 夜间 22:00-06:00
  // 天气加分
  WEATHER_RAIN: 2,   // 雨天
  WEATHER_STORM: 4,  // 暴雨
  WEATHER_SNOW: 3,   // 雪天
  // 路况扣分
  TRAFFIC_CONGESTED: -2, // 拥堵
  TRAFFIC_HEAVY: -1,     // 车多
};

// ============================================================
// 公平轮循修正（满分10分基数基础上调整）
// ============================================================
const FAIRNESS_ADJUSTMENT = {
  CONSECUTIVE_ADVANCED_PENALTY: -4,  // 连续3单优质订单 -4分
  NEW_RIDER_BONUS: 3,                // 新手7天内 +3分
  UNDERDOG_BONUS: 3,                 // 弱势骑手（近1小时未接单）+3分
  LONG_WAIT_BONUS: 2,                // 长时间等待骑手 +2分
};

// ============================================================
// 超时配单（扩容）配置
// ============================================================
const EXPANSION_CONFIG = {
  INITIAL_RADIUS_METERS: 2000,  // 初始搜索半径 2000m
  EXPAND_STEP_METERS: 500,      // 每次扩容增加 500m
  MAX_EXPANSIONS: 3,            // 最大扩容次数
  TIMEOUT_SECONDS: 10,          // 无人接单超时时间 10s
  EXPAND_BONUS_PER_STEP: 0.5,   // 每扩容一次补贴增加 0.5元
};

// ============================================================
// 降级配置
// ============================================================
const FALLBACK_CONFIG = {
  ENABLED: true,                // 是否启用降级
  FALLBACK_TO_LEVEL_POOL: true, // 降级到等级池派单
  CACHE_TTL_SECONDS: 300,       // AI评分缓存 TTL 5分钟
};

// ============================================================
// Redis Key 前缀
// ============================================================
const REDIS_KEYS = {
  RIDER_SCORE_PREFIX: 'ai:rider:score:',       // 骑手评分缓存 key
  ORDER_DISPATCH_PREFIX: 'ai:order:dispatch:',  // 订单派单状态 key
  ROUND_ROBIN_COUNTER: 'ai:rr:counter',         // 轮循计数器 key
  RIDER_POOL_QUEUE_PREFIX: 'ai:pool:',           // 池队列前缀
  EXPANSION_PREFIX: 'ai:expansion:',             // 扩容任务 key
};

// ============================================================
// 三池调度阈值
// ============================================================
const POOL_THRESHOLDS = {
  // 普惠保底池: 基础短途单，3km以内
  BASIC_MAX_DISTANCE_KM: 3.0,
  // AI择优进阶池: 长途/溢价单
  PREMIUM_MIN_DISTANCE_KM: 3.0,
  PREMIUM_MIN_AMOUNT: 30,     // 最低订单金额(元)
  // 顺路自由池: 叠单
  FREE_POOL_MAX_RADIUS_KM: 0.5,  // 顺路半径 500m
};

// ============================================================
// 时段定义
// ============================================================
const PEAK_PERIODS = {
  LUNCH_START: 11,
  LUNCH_END: 13,
  DINNER_START: 17,
  DINNER_END: 19,
  NIGHT_START: 22,
  NIGHT_END: 6,
};

// ============================================================
// 风控系统配置（AI Risk Control）
// ============================================================
const RISK_CONFIG = {
  ENABLED: true,
  THRESHOLD_BLOCK: 80,       // ≥80分 拦截
  THRESHOLD_REVIEW: 50,      // 50-79分 审核
  AUTO_BLACKLIST_COUNT: 3,   // 连续N次高风险自动拉黑
  AUTO_BLACKLIST_DURATION_HOURS: 72,
  SCORE_WEIGHT_RULE: 0.7,    // 规则命中分权重
  SCORE_WEIGHT_BLACKLIST: 0.3, // 黑名单命中分权重
  DEFAULT_BLACKLIST_SCORE: 90, // 黑名单命中默认分
  DEFAULT_WHITELIST_SCORE: 0,  // 白名单命中默认分
};

// ============================================================
// 路径优化配置（AI Route Optimization）
// ============================================================
const ROUTE_CONFIG = {
  MAX_DELIVERIES: 10,           // 最大配送点数
  TIME_LIMIT_MS: 500,           // 计算时间上限
  TRAFFIC_WEIGHTS: {            // 路况权重修正系数
    smooth: 1.0,
    normal: 1.2,
    heavy: 1.8,
    congested: 2.5,
    bad: 3.0,
  },
  REPLAN_THRESHOLD_MINUTES: 5,  // 路况恶化超过5分钟触发重规划
  MONITOR_INTERVAL_SECONDS: 60, // 路况监测轮询间隔
  CACHE_TTL_SECONDS: 1800,      // 路径缓存30分钟
};

// ============================================================
// 需求预测配置（AI Demand Prediction）
// ============================================================
const PREDICT_CONFIG = {
  ENABLED: true,
  HISTORY_DAYS: 30,             // 历史数据窗口
  WEIGHTS: {                    // 加权移动平均权重（最近→最远递减）
    daily: [0.30, 0.25, 0.20, 0.12, 0.08, 0.03, 0.02],
  },
  RIDER_CAPACITY: 5,            // 每个骑手每小时承接能力（单）
  SURPLUS_THRESHOLD: 0.30,      // 运力过剩>30%触发建议
  SHORTAGE_THRESHOLD: 0.20,     // 运力缺口>20%触发建议
  SCHEDULE_CRON: '0 3 * * *',   // 每日凌晨3点运行全量预测
  HOURLY_UPDATE: true,          // 是否每小时增量更新
  WEATHER_CORRECTION_FACTORS: {  // 天气修正系数
    sunny: 1.0,
    cloudy: 1.05,
    rain: 1.2,
    storm: 0.7,
    snow: 0.6,
    heavy_rain: 0.8,
    thunderstorm: 0.7,
  },
};

module.exports = {
  SCORE_WEIGHTS,
  DISTANCE_SCORE_TABLE,
  LOAD_SCORE_TABLE,
  QUALITY_SCORE_TABLE,
  VIOLATION_PENALTY,
  TIME_ENV_BONUS,
  FAIRNESS_ADJUSTMENT,
  EXPANSION_CONFIG,
  FALLBACK_CONFIG,
  REDIS_KEYS,
  POOL_THRESHOLDS,
  PEAK_PERIODS,
  RISK_CONFIG,
  ROUTE_CONFIG,
  PREDICT_CONFIG,
};
