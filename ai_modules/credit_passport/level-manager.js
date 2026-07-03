'use strict';

/**
 * 骑手信用等级管理
 *
 * @module ai_modules/credit_passport/level-manager
 */

/**
 * 等级配置表
 * level: 等级数字
 * name: 等级英文标识
 * label: 等级中文名称
 * minScore: 该等级最低分（含）
 * maxScore: 该等级最高分（含）
 * priorityWeight: 派单优先级权重
 * subsidyRate: 额外补贴比例
 */
const LEVELS = [
  {
    level: 1,
    name: 'bronze',
    label: '青铜',
    minScore: 0,
    maxScore: 599,
    priorityWeight: 1.0,
    subsidyRate: 0,
  },
  {
    level: 2,
    name: 'silver',
    label: '白银',
    minScore: 600,
    maxScore: 749,
    priorityWeight: 1.1,
    subsidyRate: 0.02,
  },
  {
    level: 3,
    name: 'gold',
    label: '黄金',
    minScore: 750,
    maxScore: 899,
    priorityWeight: 1.2,
    subsidyRate: 0.05,
  },
  {
    level: 4,
    name: 'diamond',
    label: '钻石',
    minScore: 900,
    maxScore: 1000,
    priorityWeight: 1.5,
    subsidyRate: 0.10,
  },
];

/**
 * 根据信用分获取等级信息
 *
 * @param {number} score - 信用总分 (0-1000)
 * @returns {{ level: number, name: string, label: string }}
 */
function getLevel(score) {
  const clampedScore = Math.max(0, Math.min(1000, score));

  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const levelConfig = LEVELS[i];
    if (clampedScore >= levelConfig.minScore && clampedScore <= levelConfig.maxScore) {
      return {
        level: levelConfig.level,
        name: levelConfig.name,
        label: levelConfig.label,
      };
    }
  }

  // 兜底返回青铜
  return {
    level: 1,
    name: 'bronze',
    label: '青铜',
  };
}

/**
 * 判断等级是否发生变化，以及变化方向
 *
 * @param {number} prevScore - 变更前分数
 * @param {number} newScore - 变更后分数
 * @returns {{ changed: boolean, direction: string|null, oldLevel: Object, newLevel: Object }}
 *   direction: 'upgrade' | 'downgrade' | null
 */
function getLevelChanged(prevScore, newScore) {
  const oldLevel = getLevel(prevScore);
  const newLevel = getLevel(newScore);

  if (oldLevel.level === newLevel.level) {
    return { changed: false, direction: null, oldLevel, newLevel };
  }

  return {
    changed: true,
    direction: newLevel.level > oldLevel.level ? 'upgrade' : 'downgrade',
    oldLevel,
    newLevel,
  };
}

/**
 * 获取指定等级的权益详情
 *
 * @param {number} level - 等级数字 (1-4)
 * @returns {{ priorityWeight: number, subsidyRate: number }|null}
 */
function getLevelBenefits(level) {
  const config = LEVELS.find((l) => l.level === level);
  if (!config) {
    return null;
  }
  return {
    priorityWeight: config.priorityWeight,
    subsidyRate: config.subsidyRate,
  };
}

/**
 * 获取完整等级配置列表
 *
 * @returns {Array}
 */
function getAllLevels() {
  return LEVELS.map((l) => ({
    level: l.level,
    name: l.name,
    label: l.label,
    minScore: l.minScore,
    maxScore: l.maxScore,
    priorityWeight: l.priorityWeight,
    subsidyRate: l.subsidyRate,
  }));
}

module.exports = {
  getLevel,
  getLevelChanged,
  getLevelBenefits,
  getAllLevels,
};
