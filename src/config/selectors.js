/**
 * 知识星球 DOM 选择器定义 - 知识星球助手
 * 所有选择器必须在此统一维护，严禁在业务逻辑中硬编码。
 */

export const SELECTORS = {
  // 星球列表及内容容器
  POST_ITEM: '.talk-content-container', 

  // 附件相关 (基于 Angular 版结构)
  FILE_GALLERY: 'app-file-gallery',
  FILE_ITEM: '.file-gallery-container .item', // PDF 文件条目
  FILE_NAME: '.file-name',                    // 文件名文本所在类
  DOWNLOAD_BTN: '.btn.download',              // “下载文件”按钮

  // 上传相关
  UPLOAD_ENTRY: '.post-topic-icon-file',
  INPUT_FILE: 'input[type="file"]',

  // 页面信息
  GROUP_NAME: '.group-name',

  // 音频相关 (基于音频搜索页真实结构)
  AUDIO_ITEM: '.file-container .item', 
  AUDIO_TITLE: '.name',
  AUDIO_TIME: '.time',
  AUDIO_DOWNLOAD_BTN: '.file-icon.file-mp3' // 列表通常无直接下载按钮，点击此图标或项进入详情
};
