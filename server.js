const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ChatGPTAutomation = require('./chatgpt-automation');

const app = express();
const PORT = 3000;

// 中介軟體
app.use(cors());
app.use(express.json());

// 提供 presets.json 給前端（必須在 static 之前）
app.get('/presets.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'presets.json'));
});

app.use(express.static('public'));
app.use('/output', express.static('output'));

// 設定檔案上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB（增加限制以支援高解析度圖片）
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只允許上傳圖片檔案 (jpg, png, webp)'));
    }
  }
});

// 全域變數儲存所有任務狀態
const tasks = {};
const taskQueue = [];
let isProcessingQueue = false;

// ==================== API 路由 ====================

/**
 * 首頁
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'generator.html'));
});

/**
 * 上傳母圖和錨點圖
 */
app.post('/api/upload', upload.fields([
  { name: 'motherImage', maxCount: 1 },
  { name: 'anchorImage', maxCount: 1 }
]), (req, res) => {
  try {
    if (!req.files || !req.files.motherImage || !req.files.anchorImage) {
      return res.status(400).json({
        success: false,
        error: '請上傳母圖和錨點圖'
      });
    }

    const motherImage = req.files.motherImage[0];
    const anchorImage = req.files.anchorImage[0];

    res.json({
      success: true,
      message: '圖片上傳成功',
      files: {
        motherImage: {
          filename: motherImage.filename,
          path: motherImage.path,
          size: motherImage.size
        },
        anchorImage: {
          filename: anchorImage.filename,
          path: anchorImage.path,
          size: anchorImage.size
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 開始生成貼圖 (改為任務佇列)
 */
app.post('/api/generate/start', async (req, res) => {
  try {
    const { motherImagePath, anchorImagePath, selectedPresets, customPrompt } = req.body;

    if (!motherImagePath || !anchorImagePath) {
      return res.status(400).json({
        success: false,
        error: '請提供母圖和錨點圖路徑'
      });
    }

    // 建立獨特的任務 ID
    const taskId = 'task_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    // 載入預設文字
    const allPresets = JSON.parse(fs.readFileSync('presets.json', 'utf8'));

    const presetsToGenerate = selectedPresets && selectedPresets.length > 0
      ? allPresets.filter((p, i) => selectedPresets.includes(i))
      : allPresets;

    // 初始化任務狀態並存入 tasks
    tasks[taskId] = {
      id: taskId,
      status: 'pending', // pending, running, completed, failed
      progress: 0,
      total: presetsToGenerate.length,
      currentSticker: '',
      results: [],
      error: null,
      startTime: null,
      endTime: null
    };

    // 將任務加入佇列
    taskQueue.push({
      taskId,
      motherImagePath,
      anchorImagePath,
      presetsToGenerate,
      customPrompt
    });

    // 立即回應
    res.json({
      success: true,
      message: '任務已排入佇列',
      taskId: taskId,
      total: presetsToGenerate.length
    });

    // 啟動佇列處理（如果尚未啟動）
    processQueue();

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 查詢任務狀態
 */
app.get('/api/generate/status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).json({ success: false, error: '找不到該任務' });
  }

  res.json({
    success: true,
    task: task
  });
});

/**
 * 取得生成結果
 */
app.get('/api/generate/results/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).json({ success: false, error: '找不到該任務' });
  }

  if (task.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: '任務尚未完成',
      status: task.status
    });
  }

  res.json({
    success: true,
    results: task.results,
    summary: {
      total: task.total,
      success: task.results.filter(r => r.success).length,
      failed: task.results.filter(r => !r.success).length,
      startTime: task.startTime,
      endTime: task.endTime
    }
  });
});

/**
 * 下載單張貼圖 (支援任務目錄)
 */
app.get('/api/download/:taskId/:filename', (req, res) => {
  const { taskId, filename } = req.params;
  const filePath = path.join(__dirname, 'output', taskId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: '檔案不存在'
    });
  }

  res.download(filePath);
});

/**
 * 下載所有貼圖 (ZIP，支援任務目錄)
 */
app.get('/api/download-all/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const outputDir = path.join(__dirname, 'output', taskId);

  if (!fs.existsSync(outputDir)) {
    return res.status(404).json({ success: false, error: '該任務沒有生成的檔案' });
  }

  try {
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.attachment(`line-stickers-${taskId}.zip`);
    archive.pipe(res);

    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png'));
    files.forEach(file => {
      archive.file(path.join(outputDir, file), { name: file });
    });

    await archive.finalize();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 重置/清除任務
 */
app.post('/api/reset/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  if (tasks[taskId] && tasks[taskId].status === 'running') {
    return res.status(400).json({ success: false, error: '無法重置正在執行的任務' });
  }

  delete tasks[taskId];
  res.json({ success: true, message: '任務已清除' });
});

// ==================== 佇列處理 ====================

/**
 * 依序處理任務佇列
 */
async function processQueue() {
  if (isProcessingQueue || taskQueue.length === 0) return;

  isProcessingQueue = true;

  while (taskQueue.length > 0) {
    const taskData = taskQueue.shift();
    const { taskId, motherImagePath, anchorImagePath, presetsToGenerate, customPrompt } = taskData;
    const task = tasks[taskId];

    if (!task) continue;

    const bot = new ChatGPTAutomation();

    try {
      console.log(`\n🚀 [Queue] 開始執行任務：${taskId}`);

      task.status = 'running';
      task.startTime = new Date().toISOString();

      // 初始化並登入
      await bot.init();
      await bot.login();

      // 為每個任務建立獨立的輸出目錄
      const taskOutputDir = path.join('output', taskId);
      if (!fs.existsSync(taskOutputDir)) {
        fs.mkdirSync(taskOutputDir, { recursive: true });
      }

      // 生成貼圖
      const results = await bot.generateStickers(
        presetsToGenerate,
        motherImagePath,
        anchorImagePath,
        taskOutputDir, // 傳遞隔離的輸出目錄
        customPrompt,
        (progress, currentSticker) => {
          // 更新進度回饋
          task.progress = progress;
          task.currentSticker = currentSticker;
        }
      );

      // 更新結果
      task.status = 'completed';
      task.progress = presetsToGenerate.length;
      task.results = results.map(r => ({
        ...r,
        // 轉換為前端可訪問的相對路徑
        path: r.path ? r.path.replace(/\\/g, '/') : null
      }));
      task.endTime = new Date().toISOString();

      console.log(`\n✅ [Queue] 任務完成：${taskId}\n`);

    } catch (error) {
      console.error(`\n❌ [Queue] 任務失敗 (${taskId})：`, error);
      task.status = 'failed';
      task.error = error.message;
      task.endTime = new Date().toISOString();
    } finally {
      await bot.close();
    }
  }

  isProcessingQueue = false;
}

// ==================== 啟動伺服器 ====================

app.listen(PORT, () => {
  console.log('\n🎨 ========================================');
  console.log('🎨 LINE 貼圖生成器伺服器已啟動');
  console.log('🎨 ========================================\n');
  console.log(`📡 伺服器位址：http://localhost:${PORT}`);
  console.log(`📁 輸出目錄：${path.resolve('output')}`);
  console.log(`📤 上傳目錄：${path.resolve('uploads')}\n`);
  console.log('💡 提示：');
  console.log('   1. 在瀏覽器開啟 http://localhost:3000');
  console.log('   2. 上傳母圖和錨點圖');
  console.log('   3. 點擊「開始生成」\n');
  console.log('⚠️  注意：首次執行需要手動登入 ChatGPT\n');
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n\n👋 正在關閉伺服器...');
  process.exit(0);
});
