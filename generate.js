#!/usr/bin/env node

/**
 * 獨立執行腳本 - 不需要啟動伺服器
 * 直接執行生成任務
 */

const ChatGPTAutomation = require('./chatgpt-automation');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('\n🎨 ========================================');
  console.log('🎨 LINE 貼圖生成器 - 獨立執行模式');
  console.log('🎨 ========================================\n');

  // 檢查必要檔案
  const motherImagePath = process.argv[2] || 'mother.png';
  const anchorImagePath = process.argv[3] || 'anchor.png';

  if (!fs.existsSync(motherImagePath)) {
    console.error(`❌ 找不到母圖：${motherImagePath}`);
    console.log('\n使用方式：');
    console.log('  node generate.js <母圖路徑> <錨點圖路徑>');
    console.log('\n範例：');
    console.log('  node generate.js mother.png anchor.png');
    process.exit(1);
  }

  if (!fs.existsSync(anchorImagePath)) {
    console.error(`❌ 找不到錨點圖：${anchorImagePath}`);
    process.exit(1);
  }

  // 載入預設文字
  const presets = JSON.parse(fs.readFileSync('presets.json', 'utf8'));

  console.log(`📷 母圖：${path.resolve(motherImagePath)}`);
  console.log(`📷 錨點圖：${path.resolve(anchorImagePath)}`);
  console.log(`📝 將生成 ${presets.length} 張貼圖\n`);

  const bot = new ChatGPTAutomation();

  try {
    // 初始化
    await bot.init();

    // 登入
    await bot.login();

    // 生成所有貼圖
    const results = await bot.generateStickers(
      presets,
      motherImagePath,
      anchorImagePath,
      'output'
    );

    // 顯示最終結果
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log('\n\n🎉 ========================================');
    console.log('🎉 全部完成！');
    console.log('🎉 ========================================\n');
    console.log(`✅ 成功：${successCount}/${presets.length}`);
    console.log(`❌ 失敗：${failCount}/${presets.length}`);
    console.log(`📁 輸出目錄：${path.resolve('output')}\n`);

    if (failCount > 0) {
      console.log('❌ 失敗的貼圖：');
      results.filter(r => !r.success).forEach(r => {
        console.log(`   - ${r.title}`);
      });
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ 發生錯誤：', error);
    process.exit(1);
  } finally {
    await bot.close();
  }
}

// 執行
main().catch(error => {
  console.error('❌ 執行失敗：', error);
  process.exit(1);
});
