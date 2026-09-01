/**
 * 全局设置与默认值 - 知识星球助手
 */

export const SETTINGS = {
  VERSION: '0.4.4',
  DEBUG_MODE: true,

  // 基础 URL
  BASE_URL: 'https://zsxq.com',
  AUDIO_SEARCH_URL: 'https://wx.zsxq.com/search/mp3?groupId=28888112822211&searchUid=0.8761816833421697',

  // 远端下载历史同步（凭证仅保存于扩展本地存储，不写入源码）
  REMOTE_HISTORY: {
    ENDPOINT: 'https://xiaoshanqing.tech/api/v1/zsxq/browser-import/history',
    REQUEST_PATH: '/api/v1/zsxq/browser-import/history',
    DEFAULT_GROUP_ID: '28888112822211',
    DEFAULT_PDF_TAB_ID: '51184248544214',
    DEFAULT_MP3_TAB_ID: '88844545452542',
    DEFAULT_DAYS: 3
  },

  // 下载相关配置
  DOWNLOAD: {
    DEFAULT_FOLDER: 'zsxq-downloads',
    FILE_NAME_FORMAT: '{date}_{star}_{title}.pdf', // 文件命名模板
    AUTO_RETRY: true,
    MAX_RETRY_COUNT: 3
  },

  // 延时策略 (防反爬)
  DELAY: {
    BATCH_INTERVAL: 10000, // 批量下载之间的间隔 (10s)
    CLICK_WAIT: 1500,      // 点击文件项后等待下载按钮出现的延迟
    PAGE_LOAD_WAIT: 3000
  },

  // 日志配置
  LOGGING: {
    LEVEL: 'DEBUG', // DEBUG, INFO, WARN, ERROR
    MAX_PERSISTED_ERRORS: 100
  }
};

const LEGACY_REMOTE_HISTORY_ENDPOINTS = new Set([
  'https://ji448ziqobpp.ngrok.xiaomiqiu123.top/api/v1/zsxq/browser-import/history'
]);

export function resolveRemoteHistoryEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/+$/, '');
  if (!endpoint || LEGACY_REMOTE_HISTORY_ENDPOINTS.has(endpoint)) {
    return SETTINGS.REMOTE_HISTORY.ENDPOINT;
  }
  return endpoint;
}
