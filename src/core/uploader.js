import { logger } from '../utils/logger.js';
import { SELECTORS } from '../config/selectors.js';

const MODULE = 'UPLOAD_CORE';

export const uploader = {
  /**
   * 触发页面的上传文件对话框
   */
  async triggerUpload() {
    logger.info(MODULE, 'Attempting to trigger file upload...');

    // 1. 尝试寻找隐藏的 file input
    const fileInput = document.querySelector(SELECTORS.INPUT_FILE);
    
    if (fileInput) {
      logger.info(MODULE, 'File input found, triggering click.');
      fileInput.click();
    } else {
      logger.warn(MODULE, 'No file input found. Trying to click upload entry icon...');
      // 2. 如果没有 input，尝试点击上传图标入口
      const uploadIcon = document.querySelector(SELECTORS.UPLOAD_ENTRY);
      if (uploadIcon) {
        uploadIcon.click();
      } else {
        logger.error(MODULE, 'No upload entry found on page.');
        alert('未在页面发现上传入口，请先确保您已处于“发布帖子”编辑状态。');
      }
    }
  }
};
