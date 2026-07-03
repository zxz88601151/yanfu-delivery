'use strict';

/**
 * AI 模块全局配置
 *
 * @module config/ai_modules
 */

const config = {
  // ========== 数据库连接配置 ==========
  db: {
    host: process.env.YANFU_DB_HOST || 'localhost',
    port: parseInt(process.env.YANFU_DB_PORT, 10) || 3306,
    user: process.env.YANFU_DB_USER || 'root',
    password: process.env.YANFU_DB_PASSWORD || '',
    database: process.env.YANFU_DB_NAME || 'kuailv',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.YANFU_DB_CONNECTION_LIMIT, 10) || 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  },

  // ========== 模块开关 ==========
  moduleSwitches: {
    blindBox: process.env.YANFU_AI_BLIND_BOX_ENABLED !== 'false',
    dynamicPricing: process.env.YANFU_AI_DYNAMIC_PRICING_ENABLED === 'true',
    liveMap: process.env.YANFU_AI_LIVE_MAP_ENABLED === 'true',
    prePosition: process.env.YANFU_AI_PRE_POSITION_ENABLED === 'true',
    relayDelivery: process.env.YANFU_AI_RELAY_DELIVERY_ENABLED === 'true',
    creditPassport: process.env.YANFU_AI_CREDIT_PASSPORT_ENABLED === 'true',
    carbonCredit: process.env.YANFU_AI_CARBON_CREDIT_ENABLED === 'true',
  },

  // ========== 盲盒模块配置 ==========
  blindBox: {
    // 匹配超时时间（秒）
    matchTimeout: parseInt(process.env.YANFU_BLIND_BOX_MATCH_TIMEOUT, 10) || 300,
    // 最低折扣率（低于此值平台补贴）
    minDiscountRate: parseFloat(process.env.YANFU_BLIND_BOX_MIN_DISCOUNT_RATE) || 0.5,
    // 默认平台补贴比例
    defaultSubsidyRate: parseFloat(process.env.YANFU_BLIND_BOX_DEFAULT_SUBSIDY_RATE) || 0.1,
    // 平台补贴上限（元）
    maxSubsidyAmount: parseFloat(process.env.YANFU_BLIND_BOX_MAX_SUBSIDY) || 10.0,
    // 盲盒订单过期时间（秒）
    orderExpireSeconds: parseInt(process.env.YANFU_BLIND_BOX_EXPIRE_SECONDS, 10) || 300,
    // 新店/首发权重倍数
    featuredWeightMultiplier: parseFloat(process.env.YANFU_BLIND_BOX_FEATURED_WEIGHT) || 2.0,
    // 池清理定时任务 cron 表达式（默认每小时）
    poolCleanCron: process.env.YANFU_BLIND_BOX_POOL_CLEAN_CRON || '0 * * * *',
  },

  // ========== 动态定价模块配置 ==========
  dynamicPricing: {
    // 天气 API 配置
    weatherApiUrl: process.env.YANFU_WEATHER_API_URL || 'https://api.openweathermap.org/data/2.5/weather',
    weatherApiKey: process.env.YANFU_WEATHER_API_KEY || '',
    weatherCacheTtl: parseInt(process.env.YANFU_WEATHER_CACHE_TTL, 10) || 1800,
    weatherRequestTimeout: parseInt(process.env.YANFU_WEATHER_REQUEST_TIMEOUT, 10) || 5000,

    // 缓存 TTL（秒）
    configCacheTtl: parseInt(process.env.YANFU_CONFIG_CACHE_TTL, 10) || 60,
    zoneCacheTtl: parseInt(process.env.YANFU_ZONE_CACHE_TTL, 10) || 300,
    supplyDemandCacheTtl: parseInt(process.env.YANFU_SD_CACHE_TTL, 10) || 120,

    // GeoHash 精度
    geoHashPrecision: parseInt(process.env.YANFU_GEOHASH_PRECISION, 10) || 6,

    // Rate limit
    rateLimitPerMinute: parseInt(process.env.YANFU_RATE_LIMIT_PER_MINUTE, 10) || 60,

    // 定时任务 cron 表达式（每 5 分钟）
    recalcCron: process.env.YANFU_DYNAMIC_RECALC_CRON || '*/5 * * * *',

    // 日志保留天数
    logRetentionDays: parseInt(process.env.YANFU_LOG_RETENTION_DAYS, 10) || 90,

    // 区域系数显著变化阈值
    zoneChangeThreshold: parseFloat(process.env.YANFU_ZONE_CHANGE_THRESHOLD) || 0.10,

    // 标准配送费默认值
    defaultBaseFee: parseFloat(process.env.YANFU_DEFAULT_BASE_FEE) || 5.00,
  },

  // ========== 预置运力模块配置 ==========
  prePosition: {
    // 预测参数
    predictionIntervalMinutes: parseInt(process.env.YANFU_PP_PREDICT_INTERVAL, 10) || 10,
    predictionWindowMinutes: parseInt(process.env.YANFU_PP_PREDICT_WINDOW, 10) || 60,
    subWindowMinutes: parseInt(process.env.YANFU_PP_SUB_WINDOWS, 10) || 30,
    dispatchRedundancyFactor: parseFloat(process.env.YANFU_PP_REDUNDANCY_FACTOR) || 1.3,

    // 骑手能力
    defaultRiderCapacity: parseInt(process.env.YANFU_PP_RIDER_CAPACITY, 10) || 6,

    // 调度匹配参数
    maxDispatchDistanceKm: parseFloat(process.env.YANFU_PP_DISPATCH_RADIUS) || 3,
    minCreditScore: parseInt(process.env.YANFU_PP_MIN_CREDIT, 10) || 400,
    maxDistanceSubsidy: parseFloat(process.env.YANFU_PP_MAX_DISTANCE_SUBSIDY) || 5.0,
    earlyArrivalBonus: parseFloat(process.env.YANFU_PP_EARLY_BONUS) || 1.0,
    lateArrivalPenalty: parseFloat(process.env.YANFU_PP_LATE_PENALTY) || 0.5,
    lateArrivalGraceMinutes: parseInt(process.env.YANFU_PP_LATE_GRACE, 10) || 5,

    // 超时
    responseTimeoutMinutes: parseInt(process.env.YANFU_PP_RESPOND_TIMEOUT, 10) || 10,
    enrouteTimeoutMinutes: parseInt(process.env.YANFU_PP_ENROUTE_TIMEOUT, 10) || 20,
    cancelWindowMinutes: parseInt(process.env.YANFU_PP_CANCEL_WINDOW, 10) || 5,

    // 保底
    guaranteeEnabled: process.env.YANFU_PP_GUARANTEE_ENABLED !== 'false',
    guaranteeRate: parseFloat(process.env.YANFU_PP_GUARANTEE_RATE) || 0.6,
    dailyGuaranteeLimit: parseInt(process.env.YANFU_PP_DAILY_GUARANTEE_LIMIT, 10) || 5,

    // 激励费用
    baseFeeByIntensity: [0, 2, 3, 4, 5, 6],
    timeFactorByPeriod: {
      '00:00-06:00': 1.5,
      '06:00-09:00': 1.0,
      '09:00-11:00': 1.0,
      '11:00-14:00': 1.2,
      '14:00-17:00': 0.8,
      '17:00-21:00': 1.2,
      '21:00-24:00': 1.3,
    },
    distanceSubsidyPerKm: parseFloat(process.env.YANFU_PP_DISTANCE_SUBSIDY) || 1.0,

    // 缓存 TTL
    predictionCacheTtl: parseInt(process.env.YANFU_PP_PREDICTION_CACHE_TTL, 10) || 600,
    configCacheTtl: parseInt(process.env.YANFU_PP_CONFIG_CACHE_TTL, 10) || 600,
    creditScoreCacheTtl: parseInt(process.env.YANFU_PP_CREDIT_CACHE_TTL, 10) || 300,
    acceptRateCacheTtl: parseInt(process.env.YANFU_PP_ACCEPT_CACHE_TTL, 10) || 3600,
  },

  // ========== 活地图模块配置 ==========
  liveMap: {
    // 验证权重阈值
    verifyThreshold: parseFloat(process.env.YANFU_LM_VERIFY_THRESHOLD) || 2.5,
    // 空间去重半径（米）
    dedupRadius: parseInt(process.env.YANFU_LM_DEDUP_RADIUS, 10) || 50,
    // 验证匹配半径（米）
    matchRadius: parseInt(process.env.YANFU_LM_MATCH_RADIUS, 10) || 100,
    // 同分类频率限制（秒）
    rateLimitSeconds: parseInt(process.env.YANFU_LM_RATE_LIMIT_SECONDS, 10) || 300,
    // 超时未确认（分钟）
    verificationTimeout: parseInt(process.env.YANFU_LM_VERIFY_TIMEOUT, 10) || 30,
    // 红区生命周期（小时）
    conditionLifetimeHours: parseInt(process.env.YANFU_LM_CONDITION_LIFETIME, 10) || 24,
    // 降级时间（小时）
    degradeAfterHours: parseInt(process.env.YANFU_LM_DEGRADE_AFTER, 10) || 12,
    // 每日积分上限
    maxDailyPoints: parseInt(process.env.YANFU_LM_MAX_DAILY_POINTS, 10) || 60,
    // 单骑手每日上报上限
    maxDailyReports: parseInt(process.env.YANFU_LM_MAX_DAILY_REPORTS, 10) || 20,
    // 新骑手判定（完成订单数）
    newRiderOrderThreshold: parseInt(process.env.YANFU_LM_NEW_RIDER_THRESHOLD, 10) || 50,
    // 新骑手每日上限
    newRiderDailyLimit: parseInt(process.env.YANFU_LM_NEW_RIDER_DAILY_LIMIT, 10) || 5,
    // 新骑手注册天数限制
    newRiderDays: parseInt(process.env.YANFU_LM_NEW_RIDER_DAYS, 10) || 3,
    // 热力图缓存 TTL（秒）
    heatmapCacheTTL: parseInt(process.env.YANFU_LM_HEATMAP_CACHE_TTL, 10) || 60,
  },

  // ========== 协同配送模块配置 ==========
  relayDelivery: {
    // 拆单触发条件
    minSplitDistance: parseInt(process.env.YANFU_RD_MIN_DISTANCE, 10) || 5000,
    minSplitTime: parseInt(process.env.YANFU_RD_MIN_TIME, 10) || 40,
    minAmount: parseFloat(process.env.YANFU_RD_MIN_AMOUNT) || 20,
    excludeTags: (process.env.YANFU_RD_EXCLUDE_TAGS || 'fresh').split(','),

    // 分段参数
    minSegmentDistance: parseInt(process.env.YANFU_RD_MIN_SEGMENT, 10) || 2000,
    maxSegmentDistance: parseInt(process.env.YANFU_RD_MAX_SEGMENT, 10) || 4000,
    maxSegments: parseInt(process.env.YANFU_RD_MAX_SEGMENTS, 10) || 3,

    // 接力点
    stationSearchRadius: parseInt(process.env.YANFU_RD_STATION_RADIUS, 10) || 500,
    stationMatchRadius: parseInt(process.env.YANFU_RD_STATION_MATCH_RADIUS, 10) || 300,

    // 骑手推单
    riderDecideTimeout: parseInt(process.env.YANFU_RD_RIDER_DECIDE_TIMEOUT, 10) || 30,
    riderAssignTimeout: parseInt(process.env.YANFU_RD_ASSIGN_TIMEOUT, 10) || 300,

    // 交接
    handoffTimeout: parseInt(process.env.YANFU_RD_HANDOFF_TIMEOUT, 10) || 600,
    handoffRemindTimeout: parseInt(process.env.YANFU_RD_REMIND_TIMEOUT, 10) || 300,
    arriveRadius: parseInt(process.env.YANFU_RD_ARRIVE_RADIUS, 10) || 50,

    // 难度系数
    difficultyFactors: {
      first: parseFloat(process.env.YANFU_RD_FACTOR_FIRST) || 1.0,
      middle: parseFloat(process.env.YANFU_RD_FACTOR_MIDDLE) || 1.1,
      last: parseFloat(process.env.YANFU_RD_FACTOR_LAST) || 1.2,
    },

    // ETA
    handoffBufferSeconds: parseInt(process.env.YANFU_RD_HANDOFF_BUFFER, 10) || 180,
    floorTimePerKm: parseInt(process.env.YANFU_RD_FLOOR_TIME, 10) || 120,

    // 评分权重
    scoreWeights: {
      distance: 0.30,
      type: 0.25,
      history: 0.20,
      capacity: 0.15,
      weather: 0.10,
    },

    // 定时任务
    timeoutScanCron: process.env.YANFU_RD_TIMEOUT_CRON || '* * * * *',
    cleanupExpiredCron: process.env.YANFU_RD_CLEANUP_CRON || '*/10 * * * *',
  },

  // ========== 日志配置 ==========
  logger: {
    level: process.env.YANFU_LOG_LEVEL || 'info',
    dir: process.env.YANFU_LOG_DIR || './logs',
    maxSize: '10m',
    maxFiles: 7,
  },
};

module.exports = config;
