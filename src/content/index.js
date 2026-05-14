/**
 * 注入脚本 v0.4.11 - 知识星球助手
 * 核心升级：引入“状态机清理机制”，确保旧弹层彻底消失后才触发新任务。
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const internalLog = (msg, data = '') => {
  console.log(`%c[ZsxqContent] ${msg}`, 'color: #8e44ad; font-weight: bold;', data);
};

async function appendContentLog(message, data = null) {
  try {
    const { logs = [] } = await chrome.storage.local.get('logs');
    const detail = data ? ` | ${JSON.stringify(data).slice(0, 500)}` : '';
    logs.push({
      timestamp: Date.now(),
      level: 'DEBUG',
      message: `[Content] ${message}${detail}`
    });
    if (logs.length > 200) logs.shift();
    await chrome.storage.local.set({ logs });
  } catch (err) {
    internalLog('写入诊断日志失败', err);
  }
}

// 1. 强力清理函数 (原子动作)
function triggerCloseActions() {
  const simulateNativeClick = (element) => {
    if (!element) return;
    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(evName => {
      element.dispatchEvent(new MouseEvent(evName, { view: window, bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
  };

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  const backdrops = document.querySelectorAll('.cdk-overlay-backdrop, .overlay-backdrop, .dialog-backdrop, .cdk-overlay-container');
  backdrops.forEach(b => simulateNativeClick(b));
  const closeBtns = document.querySelectorAll('.icon-close, .close-button, .close, .btn-close, [title="关闭"]');
  closeBtns.forEach(btn => simulateNativeClick(btn));
  simulateNativeClick(document.body);
}

// 2. 状态校验：确保页面变干净 (关键思路实现)
async function ensureCleanSlate(maxWaitMs = 5000) {
  const start = Date.now();
  internalLog("正在进行前置状态校验：确保无弹窗残留...");

  while (Date.now() - start < maxWaitMs) {
    const overlays = document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-backdrop, .overlay-backdrop, .dialog-container');
    const visibleOverlays = Array.from(overlays).filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.opacity !== '0' && s.visibility !== 'hidden' && el.offsetHeight > 0;
    });

    if (visibleOverlays.length === 0) {
      internalLog("状态校验通过：页面已清空。");
      return true;
    }

    internalLog(`检测到 ${visibleOverlays.length} 个存活弹层，执行清理并重试...`);
    triggerCloseActions();
    await sleep(600); // 等待关闭动画完成
  }

  internalLog("警告：清理超时，页面仍有残留。尝试强制继续...");
  return false;
}

async function closeOverlayAndWait(maxWaitMs = 5000) {
  triggerCloseActions();
  return ensureCleanSlate(maxWaitMs);
}

function normalizeFileName(name = '') {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/\.{3}|…/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getFileListItems() {
  return Array.from(document.querySelectorAll('.file-gallery-container .item, .file-gallery-container-box .item'));
}

function getVisibleDownloadButton() {
  const btns = document.querySelectorAll('.btn.download');
  return Array.from(btns).find(btn => {
    const s = window.getComputedStyle(btn);
    return s.display !== 'none'
      && s.opacity !== '0'
      && s.visibility !== 'hidden'
      && btn.offsetWidth > 0
      && btn.offsetHeight > 0;
  });
}

function findFileItemByName(fileName) {
  const wanted = normalizeFileName(fileName);
  const items = getFileListItems();
  const candidates = items.map(item => {
    const nameEl = item.querySelector('.file-name');
    return {
      item,
      rawName: nameEl?.innerText.trim() || '',
      normalizedName: normalizeFileName(nameEl?.innerText || '')
    };
  }).filter(c => c.normalizedName);

  let match = candidates.find(c => c.normalizedName === wanted);
  if (match) return match;

  match = candidates.find(c => wanted.includes(c.normalizedName) || c.normalizedName.includes(wanted));
  if (match) return match;

  const prefix = wanted.substring(0, 24);
  return candidates.find(c => c.normalizedName.startsWith(prefix) || prefix.startsWith(c.normalizedName.substring(0, 24)));
}

function overlayMatchesFile(container, fileName) {
  const wanted = normalizeFileName(fileName);
  const text = normalizeFileName(container?.innerText || '');
  const tokens = wanted
    .split(/[-_：:；;，,（）()\[\]\s]+/)
    .filter(t => t.length >= 2)
    .slice(0, 5);
  const tokenHits = tokens.filter(t => text.includes(t)).length;
  return text.includes(wanted)
    || text.includes(wanted.substring(0, 24))
    || tokenHits >= Math.min(3, tokens.length);
}

function parseDownloadCount(text = '') {
  const normalized = String(text).replace(/\s+/g, ' ');
  const patterns = [
    /下载量\s*[:：]?\s*([0-9,，]+)/,
    /下载次数\s*[:：]?\s*([0-9,，]+)/,
    /下载数\s*[:：]?\s*([0-9,，]+)/,
    /下载\s*[:：]?\s*([0-9,，]+)/,
    /([0-9,，]+)\s*次下载/,
    /已下载\s*([0-9,，]+)\s*次/,
    /下载\s*([0-9,，]+)\s*次/,
    /([0-9,，]+)\s*人?下载/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return parseInt(match[1].replace(/[,，]/g, ''), 10);
  }
  const downloadLine = normalized
    .split(/[\n\r。；;]/)
    .find(line => /下载/.test(line) && /[0-9]/.test(line));
  if (downloadLine) {
    const number = downloadLine.match(/([0-9][0-9,，]*)/);
    if (number) return parseInt(number[1].replace(/[,，]/g, ''), 10);
  }
  return null;
}

function namesReferToSameItem(a = '', b = '') {
  const left = normalizeFileName(a);
  const right = normalizeFileName(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  return left.substring(0, 24) === right.substring(0, 24);
}

function describeElement(element, container) {
  if (!element) return null;
  return {
    tag: element.tagName || '',
    className: String(element.className || ''),
    text: (element.innerText || element.textContent || '').trim().substring(0, 120),
    href: element.href || element.getAttribute?.('href') || '',
    role: element.getAttribute?.('role') || '',
    containerText: (container?.innerText || '').trim().substring(0, 180)
  };
}

async function updateStoredDownloadCount(storageKey, itemName, downloadCount) {
  const data = await chrome.storage.local.get(storageKey);
  const items = data[storageKey] || [];
  let updatedCount = 0;
  const updatedItems = items.map(item => {
    const name = item.name || '';
    if (!namesReferToSameItem(name, itemName)) return item;
    updatedCount++;
    return { ...item, downloadCount };
  });
  await chrome.storage.local.set({ [storageKey]: updatedItems });
  return updatedCount;
}

async function clickFileAndWaitForDownload(fileName) {
  internalLog(`[1. 预备阶段] ${fileName}`);
  await closeOverlayAndWait();
  await sleep(300);

  const match = findFileItemByName(fileName);
  if (!match) {
    internalLog("错误：未在当前文件列表中找到目标", fileName);
    return { success: false, error: 'NOT_FOUND_IN_FILE_LIST' };
  }

  const triggerClick = () => {
    internalLog(`[2. 执行点击] ${match.rawName}`);
    match.item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.scrollBy(0, -100);
    setTimeout(() => {
      const clickable = match.item.querySelector('.file-name') || match.item;
      clickable.click();
    }, 400);
  };

  triggerClick();
  const startedAt = Date.now();
  let retry = 0;

  while (Date.now() - startedAt < 30000) {
    await sleep(500);
    const btn = getVisibleDownloadButton();

    if (btn) {
      const container = btn.closest('.cdk-overlay-pane, .dialog-container, .modal-content, .detail-layer') || btn.parentElement?.parentElement?.parentElement;
      const matched = overlayMatchesFile(container, fileName);
      if (matched) {
        internalLog("[3. 结果确认] 弹层文件名匹配，点击下载", {
          expected: fileName,
          actualText: (container?.innerText || '').substring(0, 120)
        });
        btn.click();
        await sleep(2500);
        await closeOverlayAndWait();
        return { success: true, clickedDownload: describeElement(btn, container) };
      }

      internalLog("[3. 结果拒绝] 弹层文件名不匹配，关闭后重试", {
        expected: fileName,
        actualText: (container?.innerText || '').substring(0, 120)
      });
      await closeOverlayAndWait();
      triggerClick();
      retry++;
      continue;
    }

    if (retry === 8 || retry === 18) {
      internalLog("详情层未弹出，执行补点...");
      triggerClick();
    }
    retry++;
  }

  internalLog("严重错误：等待下载按钮最终超时", fileName);
  await closeOverlayAndWait();
  return { success: false, error: 'TIMEOUT_ON_PAGE' };
}

let isDeepScanStopped = false;

// 3. 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STOP_DEEP_SCAN') {
    isDeepScanStopped = true;
    sendResponse({ success: true });
    return true;
  }
  if (message.type === 'SCAN_FILES') {
    // ... 原有扫描逻辑保持不变 ...
    const items = document.querySelectorAll('.file-gallery-container .item, .file-gallery-container-box .item');
    const newFiles = Array.from(items).map(item => {
      const name = item.querySelector('.file-name')?.innerText.trim();
      let uploadTime = '未知';
      let parent = item.parentElement;
      for (let i = 0; i < 10; i++) { if (!parent) break; const dateEl = parent.querySelector('.date'); if (dateEl) { uploadTime = dateEl.innerText.trim(); break; } parent = parent.parentElement; }
      return name ? { name, uploadTime, downloadCount: 0, status: 'pending' } : null;
    }).filter(f => f);
    chrome.storage.local.get(['pendingFiles', 'downloadedHistory'], (data) => {
      const oldFiles = data.pendingFiles || [];
      const history = data.downloadedHistory || [];
      const combined = [...oldFiles];
      newFiles.forEach(nf => {
        if (history.includes(nf.name)) nf.status = 'done';
        const idx = combined.findIndex(of => of.name === nf.name);
        if (idx === -1) combined.push(nf);
        else { combined[idx].uploadTime = nf.uploadTime; if (history.includes(nf.name)) combined[idx].status = 'done'; }
      });
      chrome.storage.local.set({ pendingFiles: combined }, () => sendResponse({ count: combined.length }));
    });
    return true;
  }

  if (message.type === 'SCAN_AUDIO') {
    const items = document.querySelectorAll('.file-container .item');
    const newAudio = Array.from(items).map(item => {
      const name = item.querySelector('.name')?.innerText.trim();
      const uploadTime = item.querySelector('.time')?.innerText.trim() || '未知';
      return name ? { name, uploadTime, downloadCount: 0, status: 'pending' } : null;
    }).filter(Boolean);

    chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory'], (data) => {
      const oldAudio = data.pendingAudio || [];
      const history = data.downloadedAudioHistory || [];
      const combined = [...oldAudio];
      newAudio.forEach(na => {
        if (history.includes(na.name)) na.status = 'done';
        const idx = combined.findIndex(old => old.name === na.name);
        if (idx === -1) combined.push(na);
        else {
          combined[idx].uploadTime = na.uploadTime;
          if (history.includes(na.name)) combined[idx].status = 'done';
        }
      });
      chrome.storage.local.set({ pendingAudio: combined }, () => sendResponse({ count: combined.length, found: newAudio.length }));
    });
    return true;
  }

  if (message.type === 'TRIGGER_CLICK') {
    (async () => {
      try {
        const result = await clickFileAndWaitForDownload(message.payload.fileName);
        sendResponse(result);
      } catch (err) { sendResponse({ success: false, error: err.message }); }
    })();
    return true;
  }

  // 音频逻辑保持一致性
  if (message.type === 'TRIGGER_AUDIO_CLICK') {
    (async () => {
      try {
        const { fileName } = message.payload;
        await ensureCleanSlate();
        const items = document.querySelectorAll('.file-container .item');
        const targetItem = Array.from(items).find(item => item.querySelector('.name')?.innerText.includes(fileName.substring(0, 15)));
        if (!targetItem) { sendResponse({ success: false, error: 'NOT_FOUND' }); return; }
        
        const clickAudio = () => { targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' }); window.scrollBy(0, -100); setTimeout(() => targetItem.click(), 400); };
        clickAudio();

        let retry = 0;
        const checkInterval = setInterval(async () => {
          const btns = document.querySelectorAll('.btn.download, .download, .download-info button');
          const btn = Array.from(btns).find(b => { const s = window.getComputedStyle(b); return s.display !== 'none' && s.opacity !== '0' && b.offsetWidth > 0; });
          if (btn) {
            const container = btn.closest('.cdk-overlay-pane, .dialog-container, .modal-content, .detail-layer') || btn.parentElement?.parentElement;
            if ((container?.innerText || '').includes(fileName.substring(0, 10))) {
              clearInterval(checkInterval);
              btn.click();
              await sleep(2500);
              triggerCloseActions();
              sendResponse({ success: true });
              return;
            }
          }
          if (retry === 8) clickAudio();
          if (retry++ > 25) { clearInterval(checkInterval); sendResponse({ success: false, error: 'TIMEOUT' }); }
        }, 500);
      } catch (err) { sendResponse({ success: false, error: err.message }); }
    })();
    return true;
  }

  // 深度扫描获取下载量 (文件)
  if (message.type === 'DEEP_SCAN') {
    (async () => {
      try {
        isDeepScanStopped = false;
        internalLog("开始深度扫描文件下载量...");
        const items = getFileListItems();
        await appendContentLog(`文件 Deep Scan 启动，当前页面发现 ${items.length} 个文件条目`);
        let count = 0;
        let failed = 0;
        for (const item of items) {
          if (isDeepScanStopped) { internalLog("深度扫描已手动停止"); break; }
          
          const nameEl = item.querySelector('.file-name');
          if (!nameEl) continue;
          const fileName = nameEl.innerText.trim();
          
          await closeOverlayAndWait();
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.scrollBy(0, -100);
          await sleep(400);
          nameEl.click();
          
          let downloadCount = null;
          let lastOverlayText = '';
          let overlayFound = false;
          const startedAt = Date.now();
          while (Date.now() - startedAt < 5000) {
            if (isDeepScanStopped) break;
            const overlays = document.querySelectorAll('.cdk-overlay-pane, .dialog-container, .detail-layer');
            const overlay = Array.from(overlays).find(o => overlayMatchesFile(o, fileName));
            if (overlay) {
              overlayFound = true;
              const text = overlay.innerText;
              lastOverlayText = text.replace(/\s+/g, ' ').trim().slice(0, 220);
              const parsedCount = parseDownloadCount(text);
              if (parsedCount !== null) { downloadCount = parsedCount; break; }
            }
            await sleep(300);
          }
          
          if (downloadCount !== null) {
            const updatedCount = await updateStoredDownloadCount('pendingFiles', fileName, downloadCount);
            if (updatedCount > 0) count++;
            internalLog(`文件下载量已更新: ${fileName} => ${downloadCount}`, { updatedCount });
            if (updatedCount === 0) {
              failed++;
              await appendContentLog(`文件下载量解析成功但写回失败: ${fileName}`, { downloadCount, overlayFound, lastOverlayText });
            } else {
              await appendContentLog(`文件下载量写回成功: ${fileName}`, { downloadCount });
            }
          } else {
            failed++;
            internalLog(`未解析到文件下载量: ${fileName}`);
            await appendContentLog(`文件下载量未解析: ${fileName}`, { overlayFound, lastOverlayText });
          }
          await closeOverlayAndWait();
        }
        internalLog(`深度扫描完成，更新了 ${count} 个文件的下载量`);
        await appendContentLog(`文件 Deep Scan 完成，更新 ${count} 条，失败 ${failed} 条`);
        sendResponse({ success: true, count, failed });
      } catch (err) {
        internalLog("深度扫描发生异常:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 深度扫描获取下载量 (音频)
  if (message.type === 'DEEP_SCAN_AUDIO') {
    (async () => {
      try {
        isDeepScanStopped = false;
        internalLog("开始深度扫描音频下载量...");
        const items = document.querySelectorAll('.file-container .item');
        await appendContentLog(`音频 Deep Scan 启动，当前页面发现 ${items.length} 个音频条目`);
        let count = 0;
        let failed = 0;
        for (const item of items) {
          if (isDeepScanStopped) { internalLog("音频深度扫描已停止"); break; }
          
          const nameEl = item.querySelector('.name');
          if (!nameEl) continue;
          const audioName = nameEl.innerText.trim();
          
          await closeOverlayAndWait();
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.scrollBy(0, -100);
          await sleep(400);
          const clickable = item.querySelector('.name') || item;
          clickable.click();
          await sleep(250);
          item.click();
          
          let downloadCount = null;
          let lastOverlayText = '';
          let overlayFound = false;
          const startedAt = Date.now();
          while (Date.now() - startedAt < 5000) {
            if (isDeepScanStopped) break;
            const overlays = document.querySelectorAll('.cdk-overlay-pane, .dialog-container, .detail-layer');
            const overlay = Array.from(overlays).find(o => overlayMatchesFile(o, audioName));
            if (overlay) {
              overlayFound = true;
              const text = overlay.innerText;
              lastOverlayText = text.replace(/\s+/g, ' ').trim().slice(0, 220);
              const parsedCount = parseDownloadCount(text);
              if (parsedCount !== null) { downloadCount = parsedCount; break; }
            }
            await sleep(300);
          }
          
          if (downloadCount !== null) {
            const updatedCount = await updateStoredDownloadCount('pendingAudio', audioName, downloadCount);
            if (updatedCount > 0) count++;
            internalLog(`音频下载量已更新: ${audioName} => ${downloadCount}`, { updatedCount });
            if (updatedCount === 0) {
              failed++;
              await appendContentLog(`音频下载量解析成功但写回失败: ${audioName}`, { downloadCount, overlayFound, lastOverlayText });
            } else {
              await appendContentLog(`音频下载量写回成功: ${audioName}`, { downloadCount });
            }
          } else {
            failed++;
            internalLog(`未解析到音频下载量: ${audioName}`);
            await appendContentLog(`音频下载量未解析: ${audioName}`, { overlayFound, lastOverlayText });
          }
          await closeOverlayAndWait();
        }
        internalLog(`音频深度扫描完成，更新了 ${count} 个音频的下载量`);
        await appendContentLog(`音频 Deep Scan 完成，更新 ${count} 条，失败 ${failed} 条`);
        sendResponse({ success: true, count, failed });
      } catch (err) {
        internalLog("音频深度扫描异常:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
