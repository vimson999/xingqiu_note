/**
 * 专家级日志模块 - 知识星球助手
 * 提供结构化、色彩化的日志输出，并支持日志分级。
 */

const LOG_LEVELS = {
  DEBUG: { value: 0, color: '#7f8c8d' }, // 灰色
  INFO:  { value: 1, color: '#2ecc71' }, // 绿色
  WARN:  { value: 2, color: '#f1c40f' }, // 黄色
  ERROR: { value: 3, color: '#e74c3c' }  // 红色
};

// 当前运行时的日志级别，生产环境建议设置为 INFO 或 WARN
const CURRENT_LEVEL = LOG_LEVELS.DEBUG;

export const logger = {
  /**
   * 核心打印函数
   * @param {string} module 模块名称
   * @param {string} level 级别 (DEBUG, INFO, WARN, ERROR)
   * @param {string} message 日志描述
   * @param {any} data 附加数据
   */
  log(module, level, message, data = null) {
    const config = LOG_LEVELS[level];
    if (!config || config.value < CURRENT_LEVEL.value) return;

    const timestamp = new Date().toLocaleString();
    const prefix = `%c[${timestamp}] [${level}] [${module}]`;
    const style = `color: ${config.color}; font-weight: bold;`;

    if (data) {
      console.groupCollapsed(`${prefix} ${message}`, style);
      console.log('Data:', data);
      console.trace('Stack Trace');
      console.groupEnd();
    } else {
      console.log(`${prefix} ${message}`, style);
    }

    // 关键错误自动存储至 chrome.storage (可选功能)
    if (level === 'ERROR') {
      this._persistError(module, message, data);
    }
  },

  debug(module, message, data) { this.log(module, 'DEBUG', message, data); },
  info(module, message, data) { this.log(module, 'INFO', message, data); },
  warn(module, message, data) { this.log(module, 'WARN', message, data); },
  error(module, message, data) { this.log(module, 'ERROR', message, data); },

  async _persistError(module, message, data) {
    try {
      const errorLog = {
        timestamp: new Date().toISOString(),
        module,
        message,
        data: data ? JSON.stringify(data) : null
      };
      const { logs = [] } = await chrome.storage.local.get('logs');
      logs.push(errorLog);
      // 仅保留最近 100 条错误日志
      if (logs.length > 100) logs.shift();
      await chrome.storage.local.set({ logs });
    } catch (e) {
      console.warn('Persistent logging failed:', e);
    }
  }
};
