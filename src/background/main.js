/**
 * 后台脚本 v0.4.9 - 知识星球助手
 * 修复：解决任务回信丢失导致的卡死问题，增强 Promise 超时鲁棒性。
 */

import { SETTINGS } from '../config/settings.js';

let isBatchRunning = false;
let stopBatchRequested = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_BATCH_DOWNLOAD') {
    if (isBatchRunning) { addLog('WARN', '已有下载任务在运行中。'); return; }
    const { limit, minCount, filterNames } = message.payload || {};
    stopBatchRequested = false;
    startBatchDownload(limit, minCount, filterNames);
  }
  if (message.type === 'STOP_BATCH_DOWNLOAD') {
    stopBatchRequested = true;
    isBatchRunning = false;
    addLog('INFO', '用户终止了批量任务。');
  }
  if (message.type === 'START_SINGLE_DOWNLOAD') { processSingleDownload(message.payload.fileName); }
  if (message.type === 'START_BATCH_AUDIO_DOWNLOAD') {
    if (isBatchRunning) return;
    stopBatchRequested = false;
    startBatchAudioDownload();
  }
});

async function startBatchDownload(limit, minCount, filterNames) {
  isBatchRunning = true;
  chrome.storage.local.set({ isDownloading: true });
  const data = await chrome.storage.local.get(['pendingFiles']);
  let tasks = (data.pendingFiles || []).filter(f => f.status === 'pending');
  if (filterNames?.length > 0) tasks = tasks.filter(t => filterNames.includes(t.name));
  if (minCount > 0) tasks = tasks.filter(t => (t.downloadCount || 0) >= minCount);
  if (limit > 0) tasks = tasks.slice(0, limit);

  if (tasks.length === 0) { addLog('WARN', '无待下载文件。'); isBatchRunning = false; chrome.storage.local.set({ isDownloading: false }); return; }

  addLog('INFO', `启动批量任务 [共 ${tasks.length} 个文件]`);

  for (let i = 0; i < tasks.length; i++) {
    if (stopBatchRequested) break;
    
    // 执行任务并强制等待结果
    try {
      await executeDownloadTask(tasks[i], i + 1, tasks.length);
    } catch (e) {
      addLog('ERROR', `任务执行器发生未捕获异常: ${e.message}`);
    }

    if (i < tasks.length - 1 && !stopBatchRequested) {
      await sleep(SETTINGS.DELAY.BATCH_INTERVAL || 20000);
    }
  }

  addLog('INFO', '批量任务执行完毕。');
  isBatchRunning = false;
  chrome.storage.local.set({ isDownloading: false });
}

async function executeDownloadTask(task, current, total) {
  const tStart = Date.now();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('TAB_LOST');

    await updateFileStatus(task.name, 'processing');
    addLog('DEBUG', `[${current}/${total}] 触发: ${task.name.substring(0, 30)}...`);

    // 极其严苛的 Promise 超时控制
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_CLICK', payload: { fileName: task.name } }, (res) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(res || { success: false, error: 'EMPTY_RES' });
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'TIMEOUT_LIMIT' }), 25000))
    ]);

    const cost = ((Date.now() - tStart) / 1000).toFixed(1);
    if (response && response.success) {
      await updateFileStatus(task.name, 'done');
      addLog('INFO', `[${current}/${total}] 成功 | ${cost}s | ${task.name}`);
    } else {
      throw new Error(response?.error || 'UNKNOWN_PAGE_ERR');
    }
  } catch (err) {
    const cost = ((Date.now() - tStart) / 1000).toFixed(1);
    addLog('ERROR', `[${current}/${total}] 失败 | ${cost}s | ${err.message} | ${task.name}`);
    await updateFileStatus(task.name, 'failed');
  }
}

async function updateFileStatus(fileName, status) {
  const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
  const updated = (data.pendingFiles || []).map(f => f.name === fileName ? { ...f, status } : f);
  const updates = { pendingFiles: updated };
  if (status === 'done') {
    const history = data.downloadedHistory || [];
    if (!history.includes(fileName)) { history.push(fileName); updates.downloadedHistory = history; }
  }
  await chrome.storage.local.set(updates);
}

async function startBatchAudioDownload() {
  isBatchRunning = true;
  chrome.storage.local.set({ isDownloading: true });
  const data = await chrome.storage.local.get(['pendingAudio']);
  const tasks = (data.pendingAudio || []).filter(a => a.status === 'pending');
  if (tasks.length === 0) { isBatchRunning = false; return; }
  for (let i = 0; i < tasks.length; i++) {
    if (stopBatchRequested) break;
    await executeAudioDownloadTask(tasks[i], i + 1, tasks.length);
    if (i < tasks.length - 1 && !stopBatchRequested) await sleep(SETTINGS.DELAY.BATCH_INTERVAL || 20000);
  }
  isBatchRunning = false;
  chrome.storage.local.set({ isDownloading: false });
}

async function executeAudioDownloadTask(task, current, total) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('NO_TAB');
    await updateAudioStatus(task.name, 'processing');
    const response = await Promise.race([
      new Promise(r => chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_AUDIO_CLICK', payload: { fileName: task.name } }, res => r(res || { success: false, error: 'NO_RES' }))),
      new Promise(r => setTimeout(() => r({ success: false, error: 'TIMEOUT' }), 25000))
    ]);
    if (response?.success) { await updateAudioStatus(task.name, 'done'); addLog('INFO', `音频成功: ${task.name}`); }
    else throw new Error(response?.error || 'ERR');
  } catch (err) { addLog('ERROR', `音频失败: ${task.name} - ${err.message}`); await updateAudioStatus(task.name, 'failed'); }
}

async function updateAudioStatus(name, status) {
  const data = await chrome.storage.local.get(['pendingAudio', 'downloadedHistory']);
  const updated = (data.pendingAudio || []).map(a => a.name === name ? { ...a, status } : a);
  const updates = { pendingAudio: updated };
  if (status === 'done') {
    const history = data.downloadedHistory || [];
    if (!history.includes(name)) history.push(name);
    updates.downloadedHistory = history;
  }
  await chrome.storage.local.set(updates);
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function addLog(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];
  const formattedMsg = `[${timestamp}] ${message}`;
  console.log(`[Background] [${level}] ${formattedMsg}`);
  logs.push({ timestamp: Date.now(), level, message: formattedMsg });
  if (logs.length > 200) logs.shift();
  await chrome.storage.local.set({ logs });
}
async function processSingleDownload(fileName) {
  const data = await chrome.storage.local.get(['pendingFiles']);
  const task = (data.pendingFiles || []).find(f => f.name === fileName);
  if (task) await executeDownloadTask(task, 1, 1);
}
