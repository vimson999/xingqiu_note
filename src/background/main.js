/**
 * 后台脚本 v0.4.9 - 知识星球助手
 * 修复：解决任务回信丢失导致的卡死问题，增强 Promise 超时鲁棒性。
 */

import { SETTINGS } from '../config/settings.js';

let isBatchRunning = false;
let stopBatchRequested = false;
const FILE_BATCH_ALARM = 'ZSXQ_FILE_BATCH_NEXT';
const FILE_TASK_TIMEOUT_MS = 35000;
const DOWNLOAD_START_TIMEOUT_MS = 12000;
const STALE_PROCESSING_MS = 2 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_BATCH_DOWNLOAD') {
    if (isBatchRunning) {
      addLog('WARN', '已有下载任务在运行中。');
      sendResponse?.({ success: false, error: 'BATCH_RUNNING' });
      return true;
    }
    const { limit, minCount, filterNames } = message.payload || {};
    stopBatchRequested = false;
    startBatchDownload(limit, minCount, filterNames)
      .then(() => sendResponse?.({ success: true }))
      .catch(err => {
        addLog('ERROR', `启动批量任务失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
  if (message.type === 'STOP_BATCH_DOWNLOAD') {
    stopBatchRequested = true;
    isBatchRunning = false;
    stopFileBatch('用户终止了批量任务。')
      .then(() => sendResponse?.({ success: true }))
      .catch(err => sendResponse?.({ success: false, error: err.message }));
    return true;
  }
  if (message.type === 'START_SINGLE_DOWNLOAD') { processSingleDownload(message.payload.fileName); }
  if (message.type === 'START_BATCH_AUDIO_DOWNLOAD') {
    if (isBatchRunning) return;
    stopBatchRequested = false;
    startBatchAudioDownload();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FILE_BATCH_ALARM) runNextBatchDownload();
});

async function startBatchDownload(limit, minCount, filterNames) {
  isBatchRunning = true;
  await chrome.alarms.clear(FILE_BATCH_ALARM);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    addLog('ERROR', '启动失败：未找到当前知识星球标签页。');
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
    return;
  }

  const data = await chrome.storage.local.get(['pendingFiles']);
  const pendingFiles = resetStaleProcessing(data.pendingFiles || []);
  let tasks = pendingFiles.filter(f => f.status === 'pending');
  if (filterNames?.length > 0) tasks = tasks.filter(t => filterNames.includes(t.name));
  if (minCount > 0) tasks = tasks.filter(t => (t.downloadCount || 0) >= minCount);
  if (limit > 0) tasks = tasks.slice(0, limit);

  if (tasks.length === 0) {
    addLog('WARN', '无待下载文件。');
    isBatchRunning = false;
    await chrome.storage.local.set({ pendingFiles, isDownloading: false, fileBatchState: null });
    return;
  }

  addLog('INFO', `启动批量任务 [共 ${tasks.length} 个文件]`);
  await chrome.storage.local.set({
    pendingFiles,
    isDownloading: true,
    fileBatchState: {
      running: true,
      index: 0,
      total: tasks.length,
      taskNames: tasks.map(t => t.name),
      tabId: tab.id,
      startedAt: Date.now(),
      updatedAt: Date.now()
    }
  });
  await runNextBatchDownload();
}

async function runNextBatchDownload() {
  if (stopBatchRequested) return stopFileBatch('批量任务已停止。');
  const data = await chrome.storage.local.get(['pendingFiles', 'fileBatchState']);
  const state = data.fileBatchState;
  if (!state?.running) {
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false });
    return;
  }

  isBatchRunning = true;
  const pendingFiles = data.pendingFiles || [];
  if (state.index >= state.taskNames.length) {
    addLog('INFO', '批量任务执行完毕。');
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
    return;
  }

  const fileName = state.taskNames[state.index];
  const task = pendingFiles.find(f => f.name === fileName);
  if (!task) {
    addLog('WARN', `[${state.index + 1}/${state.total}] 任务已不在列表中，跳过: ${fileName}`);
    await advanceBatchState(state);
    return scheduleNextBatchStep();
  }

  try {
    await executeDownloadTask(task, state.index + 1, state.total, state.tabId);
  } catch (e) {
    addLog('ERROR', `任务执行器发生未捕获异常: ${e.message}`);
  }

  const nextIndex = state.index + 1;
  await advanceBatchState(state, nextIndex);
  if (nextIndex >= state.taskNames.length || stopBatchRequested) {
    addLog('INFO', '批量任务执行完毕。');
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
    return;
  }

  scheduleNextBatchStep();
}

async function executeDownloadTask(task, current, total, targetTabId = null) {
  const tStart = Date.now();
  try {
    const tab = targetTabId
      ? { id: targetTabId }
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab) throw new Error('TAB_LOST');

    await updateFileStatus(task.name, 'processing', { processingStartedAt: Date.now() });
    addLog('DEBUG', `[${current}/${total}] 触发: ${task.name.substring(0, 30)}...`);

    const downloadWatch = waitForDownloadStarted(task.name, Date.now(), DOWNLOAD_START_TIMEOUT_MS);
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_CLICK', payload: { fileName: task.name } }, (res) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(res || { success: false, error: 'EMPTY_RES' });
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, error: 'TIMEOUT_LIMIT' }), FILE_TASK_TIMEOUT_MS))
    ]);

    const cost = ((Date.now() - tStart) / 1000).toFixed(1);
    if (response && response.success) {
      const download = await downloadWatch;
      if (!download) {
        const detail = response.clickedDownload
          ? ` | clicked=${JSON.stringify(response.clickedDownload)}`
          : '';
        addLog('WARN', `[${current}/${total}] 页面返回成功但未产生下载${detail}`);
        throw new Error('DOWNLOAD_NOT_STARTED');
      }

      await updateFileStatus(task.name, 'done', {
        processingStartedAt: null,
        lastDownloadedAt: Date.now(),
        downloadId: download.id || null,
        downloadFilename: download.filename || ''
      });
      addLog('INFO', `[${current}/${total}] 成功 | ${cost}s | ${task.name}`);
    } else {
      throw new Error(response?.error || 'UNKNOWN_PAGE_ERR');
    }
  } catch (err) {
    const cost = ((Date.now() - tStart) / 1000).toFixed(1);
    addLog('ERROR', `[${current}/${total}] 失败 | ${cost}s | ${err.message} | ${task.name}`);
    await updateFileStatus(task.name, 'failed', { processingStartedAt: null, lastError: err.message });
  }
}

async function updateFileStatus(fileName, status, extra = {}) {
  const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
  const updated = (data.pendingFiles || []).map(f => f.name === fileName ? { ...f, ...extra, status } : f);
  const updates = { pendingFiles: updated };
  if (status === 'done') {
    const history = data.downloadedHistory || [];
    if (!history.includes(fileName)) { history.push(fileName); updates.downloadedHistory = history; }
  }
  await chrome.storage.local.set(updates);
}

async function advanceBatchState(state, nextIndex = state.index + 1) {
  await chrome.storage.local.set({
    fileBatchState: { ...state, index: nextIndex, updatedAt: Date.now() }
  });
}

function scheduleNextBatchStep() {
  const delayMs = SETTINGS.DELAY.BATCH_INTERVAL || 20000;
  chrome.alarms.create(FILE_BATCH_ALARM, { when: Date.now() + delayMs });
  addLog('DEBUG', `等待 ${Math.round(delayMs / 1000)}s 后执行下一个文件。`);
}

async function stopFileBatch(message) {
  await chrome.alarms.clear(FILE_BATCH_ALARM);
  addLog('INFO', message);
  await resetProcessingToPending();
  await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
}

async function resetProcessingToPending() {
  const data = await chrome.storage.local.get(['pendingFiles']);
  const pendingFiles = (data.pendingFiles || []).map(f => (
    f.status === 'processing'
      ? { ...f, status: 'pending', processingStartedAt: null, lastError: 'STOPPED_OR_RECOVERED' }
      : f
  ));
  await chrome.storage.local.set({ pendingFiles });
}

function resetStaleProcessing(files) {
  const now = Date.now();
  return files.map(f => {
    if (f.status !== 'processing') return f;
    const startedAt = f.processingStartedAt || 0;
    if (now - startedAt < STALE_PROCESSING_MS) return f;
    return { ...f, status: 'pending', processingStartedAt: null, lastError: 'STALE_PROCESSING_RESET' };
  });
}

function normalizeDownloadText(text = '') {
  return String(text)
    .replace(/\.pdf$/i, '')
    .replace(/\.{3}|…/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function downloadMatchesExpected(downloadItem, expectedName) {
  const expected = normalizeDownloadText(expectedName);
  const filename = normalizeDownloadText(downloadItem?.filename || '');
  if (!filename) return false;
  if (filename.includes(expected) || expected.includes(filename)) return true;

  const tokens = expected
    .split(/[-_：:；;，,（）()\[\]\s]+/)
    .filter(t => t.length >= 2)
    .slice(0, 5);
  const hits = tokens.filter(t => filename.includes(t)).length;
  return hits >= Math.min(3, tokens.length);
}

function waitForDownloadStarted(expectedName, startedAtMs, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let fallbackDownload = null;

    const finish = (item) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onCreated.removeListener(onCreated);
      clearTimeout(timer);
      resolve(item || fallbackDownload);
    };

    const onCreated = (item) => {
      if (!item || item.startTime && Date.parse(item.startTime) + 1000 < startedAtMs) return;
      if (downloadMatchesExpected(item, expectedName)) return finish(item);
      fallbackDownload = fallbackDownload || item;
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    chrome.downloads.onCreated.addListener(onCreated);
  });
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
