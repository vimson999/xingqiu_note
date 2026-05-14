/**
 * 核心下载逻辑 (专家增强版) - 知识星球助手
 * 实现了队列下载机制和防反爬延时策略。
 */
import { logger } from '../utils/logger.js';
import { SELECTORS } from '../config/selectors.js';
import { SETTINGS } from '../config/settings.js';

const MODULE = 'DOWNLOAD_CORE';

// 工具函数：延时
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const downloader = {
  isDownloading: false,

  /**
   * 启动批量下载队列
   */
  async scanAndDownloadAll() {
    if (this.isDownloading) {
      alert('已有任务正在进行中，请耐心等待。');
      return;
    }

    const fileItems = document.querySelectorAll(SELECTORS.FILE_ITEM);
    
    if (fileItems.length === 0) {
      logger.warn(MODULE, 'No PDF files found in visibility.');
      alert('未发现可下载的文件条目，请确认页面已加载内容。');
      return;
    }

    const confirmDownload = confirm(`发现 ${fileItems.length} 个文件，将开始间隔下载（每 20s 一个），是否继续？`);
    if (!confirmDownload) return;

    this.isDownloading = true;
    logger.info(MODULE, `Starting queue for ${fileItems.length} files.`);

    for (let i = 0; i < fileItems.length; i++) {
      const item = fileItems[i];
      const fileNameEl = item.querySelector(SELECTORS.FILE_NAME);
      const filename = fileNameEl ? fileNameEl.innerText.trim() : `file_${i + 1}`;

      logger.info(MODULE, `[${i + 1}/${fileItems.length}] Processing: ${filename}`);

      try {
        // 1. 点击文件条目 (使其被选中/激活)
        item.click();
        
        // 2. 等待下载按钮出现 (UI 反应时间)
        await sleep(SETTINGS.DELAY.CLICK_WAIT);

        // 3. 寻找并点击“下载文件”按钮
        const downloadBtn = document.querySelector(SELECTORS.DOWNLOAD_BTN);
        if (downloadBtn) {
          logger.debug(MODULE, `Found download button for: ${filename}, clicking...`);
          downloadBtn.click();
        } else {
          logger.error(MODULE, `Could not find download button for: ${filename}`);
        }

        // 4. 20 秒长间隔 (除了最后一个文件，都要等)
        if (i < fileItems.length - 1) {
          logger.info(MODULE, `Waiting ${SETTINGS.DELAY.BATCH_INTERVAL / 1000}s for security interval...`);
          await sleep(SETTINGS.DELAY.BATCH_INTERVAL);
        }

      } catch (err) {
        logger.error(MODULE, `Failed to download index ${i}:`, err);
      }
    }

    this.isDownloading = false;
    logger.info(MODULE, 'Batch download process finished.');
    alert('全部下载任务已排入队列或完成。');
  }
};
