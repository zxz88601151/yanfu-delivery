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

// 文件上传服务 - 支持本地存储和腾讯云COS
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ========== 配置 ==========
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1920;
const IMAGE_QUALITY = 80;

// 腾讯云COS配置（从环境变量读取，未配置时使用本地存储）
const COS_CONFIG = {
  SecretId: process.env.COS_SECRET_ID || '',
  SecretKey: process.env.COS_SECRET_KEY || '',
  Bucket: process.env.COS_BUCKET || '',
  Region: process.env.COS_REGION || '',
};

// 确保上传目录存在
const dirs = ['avatars', 'menu', 'reviews', 'qualifications', 'general'];
dirs.forEach(dir => {
  const fullPath = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// ========== Multer 存储 ==========
// MIME 类型到扩展名的白名单映射（不信任用户提供的扩展名）
const MIME_EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 根据上传类型选择目录
    let subDir = 'general';
    const field = file.fieldname || '';
    if (field.includes('avatar')) subDir = 'avatars';
    else if (field.includes('menu') || field.includes('dish')) subDir = 'menu';
    else if (field.includes('review')) subDir = 'reviews';
    else if (field.includes('qual') || field.includes('cert')) subDir = 'qualifications';
    
    cb(null, path.join(UPLOAD_DIR, subDir));
  },
  filename: (req, file, cb) => {
    const ext = MIME_EXT_MAP[file.mimetype] || '.jpg';
    const filename = `${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
    cb(null, filename);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${file.mimetype}，仅支持 JPG/PNG/GIF/WebP`), false);
  }
};

// Multer 实例
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 9, // 最多9张图
  }
});

// ========== 图片压缩 ==========
async function compressImage(filePath) {
  try {
    const output = filePath.replace(/(\.\w+)$/, '_compressed$1');
    await sharp(filePath)
      .resize(MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY })
      .toFile(output);
    
    // 替换原文件
    fs.unlinkSync(filePath);
    fs.renameSync(output, filePath);
    return true;
  } catch (err) {
    console.error('图片压缩失败:', err.message);
    return false;
  }
}

// ========== 腾讯云COS上传 ==========
async function uploadToCOS(filePath, key) {
  if (!COS_CONFIG.SecretId || !COS_CONFIG.Bucket) {
    return null; // 未配置COS，返回null表示使用本地存储
  }
  
  try {
    const COS = require('cos-nodejs-sdk-v5');
    const cos = new COS({ SecretId: COS_CONFIG.SecretId, SecretKey: COS_CONFIG.SecretKey });
    
    return new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: key,
        Body: fs.createReadStream(filePath),
      }, (err, data) => {
        if (err) {
          console.error('COS上传失败:', err.message);
          resolve(null);
        } else {
          // 返回CDN地址（如果配置了CDN域名）或COS地址
          const cdnDomain = process.env.COS_CDN_DOMAIN || '';
          const url = cdnDomain
            ? `https://${cdnDomain}/${key}`
            : `https://${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com/${key}`;
          resolve(url);
        }
      });
    });
  } catch (err) {
    console.error('COS SDK加载失败:', err.message);
    return null;
  }
}

// ========== 从COS删除 ==========
async function deleteFromCOS(key) {
  if (!COS_CONFIG.SecretId || !COS_CONFIG.Bucket) return;
  
  try {
    const COS = require('cos-nodejs-sdk-v5');
    const cos = new COS({ SecretId: COS_CONFIG.SecretId, SecretKey: COS_CONFIG.SecretKey });
    
    cos.deleteObject({
      Bucket: COS_CONFIG.Bucket,
      Region: COS_CONFIG.Region,
      Key: key,
    }, (err) => {
      if (err) console.error('COS删除失败:', err.message);
    });
  } catch (err) {
    console.error('COS删除失败:', err.message);
  }
}

// ========== 统一上传处理 ==========
async function handleUpload(files, category = 'general') {
  const results = [];
  
  if (!files || files.length === 0) return results;
  
  const fileArray = Array.isArray(files) ? files : [files];
  
  for (const file of fileArray) {
    try {
      // 1. 压缩图片
      await compressImage(file.path);
      
      // 2. 尝试上传到COS
      const cosKey = `${category}/${path.basename(file.path)}`;
      const cosUrl = await uploadToCOS(file.path, cosKey);
      
      if (cosUrl) {
        // COS上传成功，删除本地文件
        fs.unlinkSync(file.path);
        results.push({
          url: cosUrl,
          key: cosKey,
          storage: 'cos',
          originalName: file.originalname,
          size: file.size,
        });
      } else {
        // 使用本地存储
        const relativePath = `${category}/${path.basename(file.path)}`;
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        results.push({
          url: `${baseUrl}/uploads/${relativePath}`,
          path: relativePath,
          storage: 'local',
          originalName: file.originalname,
          size: file.size,
        });
      }
    } catch (err) {
      console.error('文件处理失败:', err.message);
      results.push({
        url: null,
        error: err.message,
        originalName: file.originalname,
      });
    }
  }
  
  return results;
}

module.exports = {
  upload,
  handleUpload,
  compressImage,
  uploadToCOS,
  deleteFromCOS,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_TYPES,
};
