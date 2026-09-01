/**
 * 后台脚本 v0.4.9 - 知识星球助手
 * 修复：解决任务回信丢失导致的卡死问题，增强 Promise 超时鲁棒性。
 */

import { resolveRemoteHistoryEndpoint, SETTINGS } from '../config/settings.js';
import {
  applyRemoteHistory,
  buildRemoteHistorySigningText,
  getRemoteHistoryNames,
  getTrustedRemoteFiles,
  hmacSha256Hex,
  mergeRemoteHistoryRecords,
  sha256Hex
} from '../utils/remote-history.mjs';
import { createBatchProgress, updateBatchProgress } from '../utils/batch-progress.mjs';
import { downloadNamesMatch, findExactDownloadMatches } from '../utils/download-match.mjs';
import { mergeImportedAudioItems, parseAudioSearchResponse } from '../utils/audio-response-import.mjs';
import { mergeImportedFileItems, parseFileSearchResponse } from '../utils/file-response-import.mjs';
import { isAudioSearchRequest, isFileTopicRequest } from '../utils/audio-network-capture.mjs';

let isBatchRunning = false;
let stopBatchRequested = false;
const FILE_BATCH_ALARM = 'ZSXQ_FILE_BATCH_NEXT';
const FILE_TASK_TIMEOUT_MS = 35000;
const DOWNLOAD_START_TIMEOUT_MS = 12000;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const BATCH_PROGRESS_STORAGE_KEY = 'batchDownloadProgress';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTO_IMPORT_AUDIO_RESPONSE') {
    automaticallyImportAudioResponse(message.payload)
      .then(result => sendResponse?.(result))
      .catch(async (err) => {
        await addLog('WARN', `音频搜索接口自动导入失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
  if (message.type === 'AUTO_IMPORT_FILE_RESPONSE') {
    automaticallyImportFileResponse(message.payload)
      .then(result => sendResponse?.(result))
      .catch(async (err) => {
        await addLog('WARN', `PDF 话题接口自动导入失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
  if (message.type === 'START_BATCH_DOWNLOAD') {
    if (isBatchRunning) {
      addLog('WARN', '已有下载任务在运行中。');
      sendResponse?.({ success: false, error: 'BATCH_RUNNING' });
      return true;
    }
    const { limit, minCount, filterNames, uploadStartMs, uploadEndMs } = message.payload || {};
    stopBatchRequested = false;
    startBatchDownload(limit, minCount, filterNames, uploadStartMs, uploadEndMs)
      .then(() => sendResponse?.({ success: true }))
      .catch(err => {
        addLog('ERROR', `启动批量任务失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
  if (message.type === 'START_RETRY_FAILED_DOWNLOAD') {
    if (isBatchRunning) {
      addLog('WARN', '已有下载任务在运行中。');
      sendResponse?.({ success: false, error: 'BATCH_RUNNING' });
      return true;
    }
    const { filterNames, minCount, uploadStartMs, uploadEndMs } = message.payload || {};
    stopBatchRequested = false;
    startBatchDownload(0, minCount, filterNames, uploadStartMs, uploadEndMs, {
      statuses: ['failed'],
      label: '重新下载失败文件'
    })
      .then(() => sendResponse?.({ success: true }))
      .catch(err => {
        addLog('ERROR', `启动失败重试任务失败: ${err.message}`);
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
  if (message.type === 'START_SINGLE_AUDIO_DOWNLOAD') {
    processSingleAudioDownload(message.payload.fileName)
      .then(() => sendResponse?.({ success: true }))
      .catch(err => sendResponse?.({ success: false, error: err.message }));
    return true;
  }
  if (message.type === 'START_BATCH_AUDIO_DOWNLOAD') {
    if (isBatchRunning) return;
    stopBatchRequested = false;
    startBatchAudioDownload(message.payload || {});
  }
  if (message.type === 'RECONCILE_AUDIO_DOWNLOAD_HISTORY') {
    reconcileAudioDownloadHistory()
      .then(result => sendResponse?.({ success: true, ...result }))
      .catch(err => {
        addLog('WARN', `音频下载历史校验失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
  if (message.type === 'SYNC_REMOTE_HISTORY') {
    syncRemoteHistory(message.payload?.kind)
      .then(result => sendResponse?.(result))
      .catch(async (err) => {
        await addLog('ERROR', `远端下载历史同步失败: ${err.message}`);
        sendResponse?.({ success: false, error: err.message });
      });
    return true;
  }
});

async function automaticallyImportAudioResponse(payload = {}) {
  const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl : '';
  const rawResponse = typeof payload.rawResponse === 'string' ? payload.rawResponse : '';
  if (!isAudioSearchRequest(sourceUrl)) {
    return { success: false, error: 'AUDIO_CAPTURE_SOURCE_INVALID' };
  }

  const parsed = parseAudioSearchResponse(rawResponse);
  if (parsed.sourceCount > 0 && parsed.items.length === 0) {
    return { success: false, error: 'AUDIO_IMPORT_NO_AUDIO_FILES' };
  }

  const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
  const merged = mergeImportedAudioItems(
    data.pendingAudio || [],
    parsed.items,
    data.downloadedAudioHistory || []
  );
  await chrome.storage.local.set({ pendingAudio: merged.items });
  if (merged.addedCount > 0 || merged.updatedCount > 0) {
    await addLog('INFO', `音频搜索接口自动导入：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。`);
  }
  return {
    success: true,
    addedCount: merged.addedCount,
    updatedCount: merged.updatedCount,
    sourceCount: parsed.sourceCount,
    skippedCount: parsed.skippedCount,
    nextIndex: parsed.nextIndex
  };
}

async function automaticallyImportFileResponse(payload = {}) {
  const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl : '';
  const rawResponse = typeof payload.rawResponse === 'string' ? payload.rawResponse : '';
  if (!isFileTopicRequest(sourceUrl)) {
    return { success: false, error: 'FILE_CAPTURE_SOURCE_INVALID' };
  }

  const parsed = parseFileSearchResponse(rawResponse);
  if (parsed.sourceFileCount > 0 && parsed.items.length === 0) {
    return { success: false, error: 'FILE_IMPORT_NO_PDF_FILES' };
  }

  const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
  const merged = mergeImportedFileItems(
    data.pendingFiles || [],
    parsed.items,
    data.downloadedHistory || []
  );
  await chrome.storage.local.set({ pendingFiles: merged.items });
  if (merged.addedCount > 0 || merged.updatedCount > 0) {
    await addLog('INFO', `PDF 话题接口自动导入：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。`);
  }
  return {
    success: true,
    addedCount: merged.addedCount,
    updatedCount: merged.updatedCount,
    sourceTopicCount: parsed.sourceTopicCount,
    sourceFileCount: parsed.sourceFileCount,
    skippedCount: parsed.skippedCount
  };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FILE_BATCH_ALARM) runNextBatchDownload();
});

function parseUploadTimeValue(value) {
  if (!value || value === '未知' || value === '-') return null;
  const normalized = value.trim().replace(/\//g, '-');
  const withYear = /^\d{2}-\d{2}/.test(normalized)
    ? `${new Date().getFullYear()}-${normalized}`
    : normalized;
  const date = new Date(withYear.replace(' ', 'T'));
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function isWithinUploadRange(file, startMs, endMs) {
  const uploadMs = parseUploadTimeValue(file.uploadTime);
  if (!uploadMs) return false;
  if (startMs && uploadMs < startMs) return false;
  if (endMs && uploadMs > endMs) return false;
  return true;
}

async function loadPrivateRemoteHistoryCredentials() {
  try {
    const privateModule = await import('../private/remote-history-credentials.js');
    return privateModule.REMOTE_HISTORY_CREDENTIALS || {};
  } catch {
    return {};
  }
}

async function getRemoteHistoryConfig(rawConfig = {}) {
  const privateCredentials = await loadPrivateRemoteHistoryCredentials();
  const parsedDays = Number.parseInt(rawConfig.days, 10);
  return {
    endpoint: resolveRemoteHistoryEndpoint(rawConfig.endpoint),
    appId: String(rawConfig.appId || privateCredentials.appId || '').trim(),
    appSecret: String(rawConfig.appSecret || privateCredentials.appSecret || '').trim(),
    groupId: String(rawConfig.groupId || SETTINGS.REMOTE_HISTORY.DEFAULT_GROUP_ID).trim(),
    pdfTabId: String(rawConfig.pdfTabId || SETTINGS.REMOTE_HISTORY.DEFAULT_PDF_TAB_ID).trim(),
    mp3TabId: String(rawConfig.mp3TabId || SETTINGS.REMOTE_HISTORY.DEFAULT_MP3_TAB_ID).trim(),
    days: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : SETTINGS.REMOTE_HISTORY.DEFAULT_DAYS
  };
}

function getRemoteHistoryStorageKeys(kind) {
  return kind === 'pdf'
    ? {
        itemsKey: 'pendingFiles',
        downloadHistoryKey: 'downloadedHistory',
        remoteHistoryKey: 'remotePdfDownloadHistory',
        syncInfoKey: 'lastRemotePdfHistorySync'
      }
    : {
        itemsKey: 'pendingAudio',
        downloadHistoryKey: 'downloadedAudioHistory',
        remoteHistoryKey: 'remoteAudioDownloadHistory',
        syncInfoKey: 'lastRemoteAudioHistorySync'
      };
}

function getRemoteHistoryConfigError(config, tabId) {
  if (!config.appId || !config.appSecret) return 'REMOTE_HISTORY_CREDENTIALS_MISSING';
  if (!config.groupId || !tabId) return 'REMOTE_HISTORY_SCOPE_MISSING';
  try {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== 'https:') return 'REMOTE_HISTORY_ENDPOINT_INVALID';
  } catch {
    return 'REMOTE_HISTORY_ENDPOINT_INVALID';
  }
  return null;
}

function getRemoteHistoryErrorMessage(error) {
  const messages = {
    REMOTE_HISTORY_CREDENTIALS_MISSING: '请先在“上传辅助”中填写 App ID 和 Secret。',
    REMOTE_HISTORY_SCOPE_MISSING: '请先填写星球 ID 和对应类型的 Tab ID。',
    REMOTE_HISTORY_ENDPOINT_INVALID: '远端历史接口地址无效。',
    HISTORY_INCOMPLETE: '服务端历史数据不完整，未用于本地去重。',
    REMOTE_HISTORY_INVALID_RESPONSE: '服务端返回的数据格式无效。'
  };
  return messages[error] || error;
}

function getRemoteResponseError(responseBody) {
  if (typeof responseBody?.error === 'string') return responseBody.error;
  if (typeof responseBody?.message === 'string') return responseBody.message;
  if (Array.isArray(responseBody?.errors) && typeof responseBody.errors[0] === 'string') return responseBody.errors[0];
  return 'REMOTE_HISTORY_REQUEST_FAILED';
}

async function syncRemoteHistory(kind) {
  if (!['pdf', 'mp3'].includes(kind)) return { success: false, error: 'REMOTE_HISTORY_KIND_INVALID' };

  const configData = await chrome.storage.local.get('remoteHistoryConfig');
  const config = await getRemoteHistoryConfig(configData.remoteHistoryConfig);
  const tabId = kind === 'pdf' ? config.pdfTabId : config.mp3TabId;
  const configError = getRemoteHistoryConfigError(config, tabId);
  if (configError) return { success: false, error: configError, message: getRemoteHistoryErrorMessage(configError) };

  const endpoint = new URL(config.endpoint);
  const requestPath = endpoint.pathname || SETTINGS.REMOTE_HISTORY.REQUEST_PATH;
  const requestBody = JSON.stringify({
    kind,
    days: config.days,
    group_id: config.groupId,
    tab_id: tabId
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodySha256 = await sha256Hex(requestBody);
  const signingText = buildRemoteHistorySigningText({
    appId: config.appId,
    timestamp,
    method: 'POST',
    path: requestPath,
    bodySha256
  });
  const signature = await hmacSha256Hex(config.appSecret, signingText);

  let response;
  try {
    response = await fetch(endpoint.href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': config.appId,
        'X-Timestamp': timestamp,
        'X-Signature': signature
      },
      body: requestBody
    });
  } catch (err) {
    return { success: false, error: `REMOTE_HISTORY_NETWORK_ERROR: ${err.message}` };
  }

  let responseBody;
  try {
    responseBody = await response.json();
  } catch {
    return { success: false, error: 'REMOTE_HISTORY_INVALID_RESPONSE', message: getRemoteHistoryErrorMessage('REMOTE_HISTORY_INVALID_RESPONSE') };
  }

  if (!response.ok) return { success: false, error: `REMOTE_HISTORY_HTTP_${response.status}` };
  if (responseBody?.success !== true) return { success: false, error: getRemoteResponseError(responseBody) };
  if (!responseBody.data || responseBody.data.complete !== true) {
    await addLog('WARN', `${kind.toUpperCase()} 远端历史数据不完整，未更新本地去重记录。`);
    return { success: false, error: 'HISTORY_INCOMPLETE', message: getRemoteHistoryErrorMessage('HISTORY_INCOMPLETE') };
  }
  if (responseBody.data.kind && responseBody.data.kind !== kind) {
    return { success: false, error: 'REMOTE_HISTORY_KIND_MISMATCH' };
  }
  if (!Array.isArray(responseBody.data.files)) {
    return { success: false, error: 'REMOTE_HISTORY_INVALID_RESPONSE', message: getRemoteHistoryErrorMessage('REMOTE_HISTORY_INVALID_RESPONSE') };
  }

  const keys = getRemoteHistoryStorageKeys(kind);
  const storage = await chrome.storage.local.get([
    keys.itemsKey,
    keys.downloadHistoryKey,
    keys.remoteHistoryKey
  ]);
  const incomingFiles = getTrustedRemoteFiles(responseBody.data.files);
  const mergedRemoteFiles = mergeRemoteHistoryRecords(storage[keys.remoteHistoryKey] || [], incomingFiles);
  const applied = applyRemoteHistory(storage[keys.itemsKey] || [], mergedRemoteFiles);
  const downloadedNames = [...new Set([
    ...(storage[keys.downloadHistoryKey] || []),
    ...getRemoteHistoryNames(mergedRemoteFiles),
    ...applied.historyNames
  ])];

  await chrome.storage.local.set({
    [keys.itemsKey]: applied.items,
    [keys.downloadHistoryKey]: downloadedNames,
    [keys.remoteHistoryKey]: mergedRemoteFiles,
    [keys.syncInfoKey]: {
      syncedAt: Date.now(),
      days: responseBody.data.days ?? config.days,
      receivedCount: responseBody.data.files.length,
      trustedCount: incomingFiles.length,
      matchedCount: applied.matchedCount,
      summary: responseBody.data.summary || null
    }
  });

  await addLog(
    'INFO',
    `${kind.toUpperCase()} 远端历史同步完成：服务端返回 ${responseBody.data.files.length} 条，可信 ${incomingFiles.length} 条，本地匹配 ${applied.matchedCount} 条。`
  );
  return {
    success: true,
    kind,
    receivedCount: responseBody.data.files.length,
    trustedCount: incomingFiles.length,
    matchedCount: applied.matchedCount,
    summary: responseBody.data.summary || null
  };
}

async function saveBatchProgress(progress) {
  await chrome.storage.local.set({ [BATCH_PROGRESS_STORAGE_KEY]: progress });
}

function createFileBatchProgress(state, patch = {}) {
  return updateBatchProgress(
    createBatchProgress({
      kind: 'file',
      label: state.label || '文件批量下载',
      total: state.total
    }),
    {
      current: state.index || 0,
      success: state.successCount || 0,
      failed: state.failedCount || 0,
      phase: 'waiting',
      ...patch
    }
  );
}

async function markBatchProgressStopped() {
  const { [BATCH_PROGRESS_STORAGE_KEY]: progress } = await chrome.storage.local.get(BATCH_PROGRESS_STORAGE_KEY);
  if (!progress || ['completed', 'stopped'].includes(progress.phase)) return;
  await saveBatchProgress(updateBatchProgress(progress, { phase: 'stopped', currentName: '' }));
}

async function startBatchDownload(limit, minCount, filterNames, uploadStartMs = null, uploadEndMs = null, options = {}) {
  isBatchRunning = true;
  await chrome.alarms.clear(FILE_BATCH_ALARM);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    addLog('ERROR', '启动失败：未找到当前知识星球标签页。');
    isBatchRunning = false;
    await chrome.storage.local.set({
      isDownloading: false,
      fileBatchState: null,
      [BATCH_PROGRESS_STORAGE_KEY]: createBatchProgress({ kind: 'file', label: options.label || '文件批量下载' })
    });
    return;
  }

  const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
  const pendingFiles = resetStaleProcessing(data.pendingFiles || []);
  const downloadedHistory = data.downloadedHistory || [];
  const statuses = options.statuses || ['pending'];
  let tasks = pendingFiles.filter(f => statuses.includes(f.status) && !downloadedHistory.includes(f.name));
  if (filterNames?.length > 0) tasks = tasks.filter(t => filterNames.includes(t.name));
  if (uploadStartMs || uploadEndMs) tasks = tasks.filter(t => isWithinUploadRange(t, uploadStartMs, uploadEndMs));
  if (minCount > 0) tasks = tasks.filter(t => (t.downloadCount || 0) >= minCount);
  if (limit > 0) tasks = tasks.slice(0, limit);

  if (tasks.length === 0) {
    addLog('WARN', options.label ? `${options.label}：无可执行文件。` : '无待下载文件。');
    isBatchRunning = false;
    await chrome.storage.local.set({
      pendingFiles,
      isDownloading: false,
      fileBatchState: null,
      [BATCH_PROGRESS_STORAGE_KEY]: createBatchProgress({ kind: 'file', label: options.label || '文件批量下载' })
    });
    return;
  }

  addLog('INFO', `${options.label || '启动批量任务'} [共 ${tasks.length} 个文件]`);
  await chrome.storage.local.set({
    pendingFiles,
    isDownloading: true,
    fileBatchState: {
      running: true,
      index: 0,
      total: tasks.length,
      taskNames: tasks.map(t => t.name),
      label: options.label || '文件批量下载',
      tabId: tab.id,
      successCount: 0,
      failedCount: 0,
      startedAt: Date.now(),
      updatedAt: Date.now()
    },
    [BATCH_PROGRESS_STORAGE_KEY]: updateBatchProgress(
      createBatchProgress({ kind: 'file', label: options.label || '文件批量下载', total: tasks.length }),
      { phase: 'running' }
    )
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
    await saveBatchProgress(createFileBatchProgress(state, {
      current: state.total,
      phase: 'completed',
      currentName: ''
    }));
    await notifyFileBatchResult(state);
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
    return;
  }

  const fileName = state.taskNames[state.index];
  const task = pendingFiles.find(f => f.name === fileName);
  if (!task) {
    addLog('WARN', `[${state.index + 1}/${state.total}] 任务已不在列表中，跳过: ${fileName}`);
    const skippedState = {
      ...state,
      failedCount: (state.failedCount || 0) + 1
    };
    const nextIndex = state.index + 1;
    await advanceBatchState(skippedState, nextIndex);
    await saveBatchProgress(createFileBatchProgress(skippedState, {
      current: nextIndex,
      phase: nextIndex >= state.total ? 'completed' : 'waiting',
      currentName: ''
    }));
    if (nextIndex >= state.total) {
      await notifyFileBatchResult(skippedState);
      isBatchRunning = false;
      await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
      return;
    }
    return scheduleNextBatchStep();
  }

  await saveBatchProgress(createFileBatchProgress(state, {
    current: state.index + 1,
    phase: 'running',
    currentName: task.name
  }));

  let succeeded = false;
  try {
    succeeded = await executeDownloadTask(task, state.index + 1, state.total, state.tabId);
  } catch (e) {
    addLog('ERROR', `任务执行器发生未捕获异常: ${e.message}`);
  }

  const nextIndex = state.index + 1;
  const nextState = {
    ...state,
    successCount: (state.successCount || 0) + (succeeded ? 1 : 0),
    failedCount: (state.failedCount || 0) + (succeeded ? 0 : 1)
  };
  await advanceBatchState(nextState, nextIndex);
  if (nextIndex >= state.taskNames.length || stopBatchRequested) {
    addLog('INFO', '批量任务执行完毕。');
    await saveBatchProgress(createFileBatchProgress(nextState, {
      current: nextIndex,
      phase: stopBatchRequested ? 'stopped' : 'completed',
      currentName: ''
    }));
    if (!stopBatchRequested) {
      await notifyFileBatchResult(nextState);
    }
    isBatchRunning = false;
    await chrome.storage.local.set({ isDownloading: false, fileBatchState: null });
    return;
  }

  await saveBatchProgress(createFileBatchProgress(nextState, {
    current: nextIndex,
    phase: 'waiting',
    currentName: ''
  }));
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
      await closeDownloadOverlay(tab.id, task.name);
      addLog('INFO', `[${current}/${total}] 成功 | ${cost}s | ${task.name}`);
      return true;
    } else {
      throw new Error(response?.error || 'UNKNOWN_PAGE_ERR');
    }
  } catch (err) {
    const cost = ((Date.now() - tStart) / 1000).toFixed(1);
    addLog('ERROR', `[${current}/${total}] 失败 | ${cost}s | ${err.message} | ${task.name}`);
    await updateFileStatus(task.name, 'failed', { processingStartedAt: null, lastError: err.message });
    return false;
  }
}

function closeDownloadOverlay(tabId, fileName) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, {
      type: 'CLOSE_DOWNLOAD_OVERLAY',
      payload: { fileName }
    }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function notifyBatchComplete(tabId, message) {
  return new Promise(resolve => {
    if (!tabId) return resolve();
    chrome.tabs.sendMessage(tabId, {
      type: 'BATCH_DOWNLOAD_COMPLETE',
      payload: { message }
    }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function notifyFileBatchResult(state) {
  const data = await chrome.storage.local.get('pendingFiles');
  const tasks = (data.pendingFiles || []).filter(file => state.taskNames.includes(file.name));
  const success = tasks.filter(file => file.status === 'done').length;
  const failed = tasks.filter(file => file.status === 'failed').length;
  await notifyBatchComplete(
    state.tabId,
    `${state.label || '文件批量下载'}结束：成功 ${success} 个，失败 ${failed} 个，共 ${state.taskNames.length} 个。`
  );
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
  await resetAudioProcessingToPending();
  await markBatchProgressStopped();
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

async function resetAudioProcessingToPending() {
  const data = await chrome.storage.local.get(['pendingAudio']);
  const pendingAudio = (data.pendingAudio || []).map(a => (
    a.status === 'processing'
      ? { ...a, status: 'pending', lastError: 'STOPPED_OR_RECOVERED' }
      : a
  ));
  await chrome.storage.local.set({ pendingAudio });
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

function downloadMatchesExpected(downloadItem, expectedName) {
  return downloadNamesMatch(downloadItem?.filename || '', expectedName);
}

function waitForDownloadStarted(expectedName, startedAtMs, timeoutMs, allowFallback = true, fallbackPredicate = null) {
  return new Promise((resolve) => {
    let settled = false;
    let fallbackDownload = null;

    const finish = (item) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onCreated.removeListener(onCreated);
      clearTimeout(timer);
      resolve(item || (allowFallback ? fallbackDownload : null));
    };

    const onCreated = (item) => {
      if (!item || item.startTime && Date.parse(item.startTime) + 1000 < startedAtMs) return;
      if (downloadMatchesExpected(item, expectedName)) return finish(item);
      if (!fallbackDownload && (!fallbackPredicate || fallbackPredicate(item))) {
        fallbackDownload = item;
      }
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    chrome.downloads.onCreated.addListener(onCreated);
  });
}

function searchChromeDownloads(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => {
      if (chrome.runtime.lastError) {
        resolve({ items: [], error: chrome.runtime.lastError.message });
        return;
      }
      resolve({ items: items || [], error: null });
    });
  });
}

async function reconcileAudioDownloadHistory({ writeLog = true } = {}) {
  const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
  const downloadedHistory = data.downloadedAudioHistory || [];
  const candidates = (data.pendingAudio || []).filter(audio => (
    (audio.status === 'pending' || audio.status === 'failed')
    && !downloadedHistory.includes(audio.name)
  ));
  if (candidates.length === 0) return { matchedCount: 0 };

  const { items: downloads, error } = await searchChromeDownloads({
    limit: 1000,
    orderBy: ['-startTime']
  });
  if (error) throw new Error(error);

  const matches = findExactDownloadMatches(candidates.map(audio => audio.name), downloads);
  if (matches.size === 0) return { matchedCount: 0 };

  const pendingAudio = (data.pendingAudio || []).map((audio) => {
    const download = matches.get(audio.name);
    if (!download) return audio;
    const downloadedAt = Date.parse(download.startTime || '');
    return {
      ...audio,
      status: 'done',
      processingStartedAt: null,
      lastError: null,
      ...(Number.isFinite(downloadedAt) ? { lastDownloadedAt: downloadedAt } : {}),
      downloadId: download.id || null,
      downloadFilename: download.filename || ''
    };
  });
  const history = [...new Set([...downloadedHistory, ...matches.keys()])];
  await chrome.storage.local.set({ pendingAudio, downloadedAudioHistory: history });
  if (writeLog) {
    await addLog('INFO', `音频下载历史校验完成：匹配 ${matches.size} 条，已标记为已下载。`);
  }
  return { matchedCount: matches.size };
}

async function startBatchAudioDownload({ limit = 5, minCount = 0, uploadStartMs = null, uploadEndMs = null, filterNames = [], retryFailed = false, sort = 'time_desc' } = {}) {
  isBatchRunning = true;
  const [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await reconcileAudioDownloadHistory({ writeLog: false });
  } catch (err) {
    await addLog('WARN', `批量下载前音频历史校验失败: ${err.message}`);
  }
  const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
  const downloadedAudioHistory = data.downloadedAudioHistory || [];
  let tasks = (data.pendingAudio || []).filter(a => (
    (retryFailed ? a.status === 'failed' : a.status === 'pending')
    && !downloadedAudioHistory.includes(a.name)
    && (minCount <= 0 || (a.downloadCount || 0) >= minCount)
    && isWithinUploadRange(a, uploadStartMs, uploadEndMs)
  ));
  if (filterNames.length > 0) tasks = tasks.filter(t => filterNames.includes(t.name));
  tasks.sort((a, b) => sort === 'count_desc'
    ? (b.downloadCount || 0) - (a.downloadCount || 0)
    : (b.uploadTime || '').localeCompare(a.uploadTime || ''));
  if (limit > 0) tasks = tasks.slice(0, limit);
  if (tasks.length === 0) {
    addLog('WARN', '无待下载音频。');
    isBatchRunning = false;
    await chrome.storage.local.set({
      isDownloading: false,
      [BATCH_PROGRESS_STORAGE_KEY]: createBatchProgress({ kind: 'audio', label: '音频批量下载' })
    });
    return;
  }
  addLog('INFO', `启动音频批量任务 [共 ${tasks.length} 个音频]`);
  let progress = updateBatchProgress(
    createBatchProgress({ kind: 'audio', label: '音频批量下载', total: tasks.length }),
    { phase: 'running' }
  );
  await chrome.storage.local.set({ isDownloading: true, [BATCH_PROGRESS_STORAGE_KEY]: progress });
  let successCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (stopBatchRequested) break;
    progress = updateBatchProgress(progress, {
      current: i + 1,
      phase: 'running',
      currentName: tasks[i].name
    });
    await saveBatchProgress(progress);

    if (await executeAudioDownloadTask(tasks[i], i + 1, tasks.length)) successCount++;
    else failedCount++;
    processedCount = i + 1;
    progress = updateBatchProgress(progress, {
      current: processedCount,
      success: successCount,
      failed: failedCount,
      phase: i < tasks.length - 1 && !stopBatchRequested ? 'waiting' : 'running',
      currentName: ''
    });
    await saveBatchProgress(progress);
    if (i < tasks.length - 1 && !stopBatchRequested) await sleep(SETTINGS.DELAY.BATCH_INTERVAL || 20000);
  }
  progress = updateBatchProgress(progress, {
    current: processedCount,
    success: successCount,
    failed: failedCount,
    phase: stopBatchRequested ? 'stopped' : 'completed',
    currentName: ''
  });
  await saveBatchProgress(progress);
  if (!stopBatchRequested) {
    await notifyBatchComplete(targetTab?.id, `音频批量下载结束：成功 ${successCount} 个，失败 ${failedCount} 个，共 ${tasks.length} 个。`);
  }
  isBatchRunning = false;
  await chrome.storage.local.set({ isDownloading: false });
}

async function executeAudioDownloadTask(task, current, total) {
  const startedAt = Date.now();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('NO_TAB');
    await updateAudioStatus(task.name, 'processing', { processingStartedAt: startedAt });
    const downloadWatch = waitForDownloadStarted(
      task.name,
      startedAt,
      DOWNLOAD_START_TIMEOUT_MS
    );
    const response = await Promise.race([
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_AUDIO_CLICK', payload: { fileName: task.name } }, (res) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(res || { success: false, error: 'NO_RES' });
        });
      }),
      new Promise(r => setTimeout(() => r({ success: false, error: 'TIMEOUT' }), 25000))
    ]);
    const download = await downloadWatch;
    if (!download) {
      if (response?.success) throw new Error('AUDIO_DOWNLOAD_NOT_STARTED');
      throw new Error(response?.error || 'AUDIO_TRIGGER_FAILED');
    }

    if (!response?.success) {
      addLog('WARN', `[${current}/${total}] 音频页面回执异常，但检测到浏览器下载任务，按成功处理 | ${response?.error || 'NO_RES'} | ${task.name}`);
    }
    await updateAudioStatus(task.name, 'done', {
      processingStartedAt: null,
      lastDownloadedAt: Date.now(),
      downloadId: download.id || null,
      downloadFilename: download.filename || ''
    });
    await closeDownloadOverlay(tab.id, task.name);
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1);
    addLog('INFO', `[${current}/${total}] 音频成功 | ${cost}s | ${task.name}`);
    return true;
  } catch (err) {
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1);
    addLog('ERROR', `[${current}/${total}] 音频失败 | ${cost}s | ${err.message} | ${task.name}`);
    await updateAudioStatus(task.name, 'failed', { processingStartedAt: null, lastError: err.message });
    return false;
  }
}

async function updateAudioStatus(name, status, extra = {}) {
  const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
  const updated = (data.pendingAudio || []).map(a => a.name === name ? { ...a, ...extra, status } : a);
  const updates = { pendingAudio: updated };
  if (status === 'done') {
    const history = data.downloadedAudioHistory || [];
    if (!history.includes(name)) history.push(name);
    updates.downloadedAudioHistory = history;
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
  if (logs.length > 1000) logs.shift();
  await chrome.storage.local.set({ logs });
}
async function processSingleDownload(fileName) {
  const data = await chrome.storage.local.get(['pendingFiles']);
  const task = (data.pendingFiles || []).find(f => f.name === fileName);
  if (task) await executeDownloadTask(task, 1, 1);
}

async function processSingleAudioDownload(fileName) {
  const data = await chrome.storage.local.get(['pendingAudio']);
  const task = (data.pendingAudio || []).find(a => a.name === fileName);
  if (!task) {
    await addLog('ERROR', `音频单个下载失败: ${fileName} - NOT_FOUND_IN_AUDIO_LIST`);
    return;
  }
  await executeAudioDownloadTask(task, 1, 1);
}
