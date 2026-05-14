/**
 * DOM 操作工具类 - 知识星球助手
 */
import { logger } from './logger.js';

const MODULE = 'DOM_HELPER';

export const domHelper = {
  /**
   * 等待指定的 DOM 元素出现 (MutationObserver 封装)
   * @param {string} selector 选择器
   * @param {number} timeout 超时时间 (ms)
   * @returns {Promise<Element>}
   */
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`[${MODULE}] Wait for element timeout: ${selector}`));
      }, timeout);
    });
  },

  /**
   * 在页面注入一个操作按钮
   * @param {string} text 按钮文字
   * @param {Function} onClick 点击事件
   * @param {string} position 'top-left' | 'top-right'
   */
  injectActionButton(text, onClick, position = 'top-right') {
    const btn = document.createElement('button');
    btn.innerText = text;
    btn.className = `zsxq-assistant-btn zsxq-assistant-btn-${position}`;
    btn.onclick = (e) => {
      e.stopPropagation();
      onClick();
    };
    document.body.appendChild(btn);
    logger.debug(MODULE, `Injected action button: ${text}`);
  },

  /**
   * 下载文件 (通过 Background 代理)
   * @param {string} url 文件链接
   * @param {string} filename 建议文件名
   */
  triggerDownload(url, filename) {
    logger.info(MODULE, `Triggering download: ${filename}`, { url });
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      payload: { url, filename }
    });
  }
};
