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

// 版本检查 + 强制更新接口
const express = require('express');
const router = express.Router();

// ─── 版本配置 ────────────────────────────────────────────────────────────────
// 生产上线时更新此处的版本号和下载地址
const appVersions = {
  rider: {
    platform: 'rider',
    version: '1.0.0',
    buildNumber: 1,
    minVersion: '1.0.0',       // 低于此版本强制更新
    minBuildNumber: 1,
    downloadUrl: '',            // APK 下载地址
    updateDesc: '修复已知问题，提升稳定性',
    forceUpdate: false,         // 当前不强制
  },
  merchant: {
    platform: 'merchant',
    version: '1.0.0',
    buildNumber: 1,
    minVersion: '1.0.0',
    minBuildNumber: 1,
    downloadUrl: '',
    updateDesc: '修复已知问题，提升稳定性',
    forceUpdate: false,
  },
  user: {
    platform: 'user',
    version: '1.0.0',
    buildNumber: 1,
    minVersion: '1.0.0',
    minBuildNumber: 1,
    downloadUrl: '',
    updateDesc: '修复已知问题，提升稳定性',
    forceUpdate: false,
  },
};

// ─── GET /api/version?platform=rider&version=1.0.0&build=1 ───────────────────
router.get('/', (req, res) => {
  const { platform, version, build } = req.query;

  if (!platform) {
    return res.status(400).json({ success: false, message: '缺少 platform 参数' });
  }

  const info = appVersions[platform];
  if (!info) {
    return res.status(400).json({ success: false, message: `未知平台: ${platform}` });
  }

  const clientVersion = version || '0.0.0';
  const clientBuild = parseInt(build, 10) || 0;

  // 判断是否需要更新
  const needUpdate =
    compareVersion(clientVersion, info.minVersion) < 0 ||
    (compareVersion(clientVersion, info.minVersion) === 0 && clientBuild < info.minBuildNumber);

  const hasNewer =
    compareVersion(clientVersion, info.version) < 0 ||
    (compareVersion(clientVersion, info.version) === 0 && clientBuild < info.buildNumber);

  res.json({
    success: true,
    data: {
      platform: info.platform,
      latestVersion: info.version,
      latestBuildNumber: info.buildNumber,
      minVersion: info.minVersion,
      minBuildNumber: info.minBuildNumber,
      downloadUrl: info.downloadUrl,
      updateDesc: info.updateDesc,
      needUpdate,                        // 是否需要更新（包括非强制）
      forceUpdate: needUpdate && info.forceUpdate,  // 是否强制更新
      hasNewer,                          // 是否有新版本
    },
  });
});

// GET /api/version/check → 兼容前端调用
router.get('/check', (req, res) => {
  const { platform = 'user', version = '1.0.0', build = '1' } = req.query;
  const info = appVersions[platform] || appVersions.user;
  const clientVersion = version || '1.0.0';
  const clientBuild = parseInt(build, 10) || 1;
  const needUpdate = compareVersion(clientVersion, info.minVersion) < 0 ||
    (compareVersion(clientVersion, info.minVersion) === 0 && clientBuild < info.minBuildNumber);
  const hasNewer = compareVersion(clientVersion, info.version) < 0 ||
    (compareVersion(clientVersion, info.version) === 0 && clientBuild < info.buildNumber);
  res.json({
    success: true,
    data: {
      platform: info.platform, latestVersion: info.version,
      latestBuildNumber: info.buildNumber, minVersion: info.minVersion,
      minBuildNumber: info.minBuildNumber, downloadUrl: info.downloadUrl,
      updateDesc: info.updateDesc, needUpdate,
      forceUpdate: needUpdate && info.forceUpdate, hasNewer,
    },
  });
});

// ─── semantic version compare helper ─────────────────────────────────────────
function compareVersion(v1, v2) {
  const a = v1.split('.').map(Number);
  const b = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

module.exports = { router, appVersions };
