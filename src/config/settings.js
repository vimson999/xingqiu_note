/**
 * 全局设置与默认值 - 知识星球助手
 */

export const SETTINGS = {
  VERSION: '0.4.4',
  DEBUG_MODE: true,

  // 基础 URL
  BASE_URL: 'https://zsxq.com',
  AUDIO_SEARCH_URL: 'https://wx.zsxq.com/search/mp3?groupId=28888112822211&searchUid=0.8761816833421697',

  // 下载相关配置
  DOWNLOAD: {
    DEFAULT_FOLDER: 'zsxq-downloads',
    FILE_NAME_FORMAT: '{date}_{star}_{title}.pdf', // 文件命名模板
    AUTO_RETRY: true,
    MAX_RETRY_COUNT: 3
  },

  // 延时策略 (防反爬)
  DELAY: {
    BATCH_INTERVAL: 20000, // 批量下载之间的间隔 (20s)
    CLICK_WAIT: 1500,      // 点击文件项后等待下载按钮出现的延迟
    PAGE_LOAD_WAIT: 3000
  },

  // 日志配置
  LOGGING: {
    LEVEL: 'DEBUG', // DEBUG, INFO, WARN, ERROR
    MAX_PERSISTED_ERRORS: 100
  }
};
