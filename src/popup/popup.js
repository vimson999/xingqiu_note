import { resolveRemoteHistoryEndpoint, SETTINGS } from '../config/settings.js';
import { formatBatchProgress } from '../utils/batch-progress.mjs';
import { mergeImportedAudioItems, parseAudioSearchResponse } from '../utils/audio-response-import.mjs';
import { mergeImportedFileItems, parseFileSearchResponse } from '../utils/file-response-import.mjs';
import { buildListJsonExport } from '../utils/list-json-export.mjs';

/**
 * Popup 控制逻辑 v0.4.4 - 知识星球助手
 * 默认排序：按上传时间从新到旧 (time_desc)
 */

const INSTITUTIONS = [
  { label: '高盛 (GS)', keywords: ['高盛', 'Goldman', 'GS'] },
  { label: '摩根士丹利 (MS)', keywords: ['大摩', 'Morgan Stanley', 'MS'] },
  { label: '摩根大通 (JPM)', keywords: ['小摩', 'JPMorgan', 'JPM'] },
  { label: '野村证券 (Nomura)', keywords: ['野村', 'Nomura'] },
  { label: '瑞银 (UBS)', keywords: ['瑞银', 'UBS'] },
  { label: '中金公司 (CICC)', keywords: ['中金', 'CICC'] },
  { label: '中信证券 (CITIC)', keywords: ['中信', 'CITIC'] }
];

const REMOTE_HISTORY_CONFIG_KEY = 'remoteHistoryConfig';
let privateRemoteHistoryCredentials = {};

async function loadPrivateRemoteHistoryCredentials() {
  try {
    const privateModule = await import('../private/remote-history-credentials.js');
    return privateModule.REMOTE_HISTORY_CREDENTIALS || {};
  } catch {
    return {};
  }
}

function getDefaultRemoteHistoryConfig() {
  return {
    endpoint: SETTINGS.REMOTE_HISTORY.ENDPOINT,
    appId: privateRemoteHistoryCredentials.appId || '',
    appSecret: privateRemoteHistoryCredentials.appSecret || '',
    groupId: SETTINGS.REMOTE_HISTORY.DEFAULT_GROUP_ID,
    pdfTabId: SETTINGS.REMOTE_HISTORY.DEFAULT_PDF_TAB_ID,
    mp3TabId: SETTINGS.REMOTE_HISTORY.DEFAULT_MP3_TAB_ID,
    days: SETTINGS.REMOTE_HISTORY.DEFAULT_DAYS
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 按钮 & 元素定义
  const btnScan = document.getElementById('btn-scan');
  const btnImportFileResponse = document.getElementById('btn-import-file-response');
  const fileImportPanel = document.getElementById('file-import-panel');
  const fileImportResponse = document.getElementById('file-import-response');
  const btnConfirmFileImport = document.getElementById('btn-confirm-file-import');
  const btnCancelFileImport = document.getElementById('btn-cancel-file-import');
  const btnDeepScan = document.getElementById('btn-deep-scan');
  const btnStopDeep = document.getElementById('btn-stop-deep');
  const btnStartBatch = document.getElementById('btn-start-batch');
  const btnStopBatch = document.getElementById('btn-stop-batch');
  const btnRetryFailed = document.getElementById('btn-retry-failed');
  const btnExportList = document.getElementById('btn-export-list');
  const btnExportListJson = document.getElementById('btn-export-list-json');
  const btnClearFiles = document.getElementById('btn-clear-files');
  const btnSyncFileHistory = document.getElementById('btn-sync-file-history');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const btnExportLogs = document.getElementById('btn-export-logs');

  // 音频 tab 按钮
  const btnGoAudio = document.getElementById('btn-go-audio');
  const btnScanAudio = document.getElementById('btn-scan-audio');
  const btnImportAudioResponse = document.getElementById('btn-import-audio-response');
  const audioImportPanel = document.getElementById('audio-import-panel');
  const audioImportResponse = document.getElementById('audio-import-response');
  const btnConfirmAudioImport = document.getElementById('btn-confirm-audio-import');
  const btnCancelAudioImport = document.getElementById('btn-cancel-audio-import');
  const btnDeepScanAudio = document.getElementById('btn-deep-scan-audio');
  const btnStopDeepAudio = document.getElementById('btn-stop-deep-audio');
  const btnBatchAudio = document.getElementById('btn-batch-audio');
  const btnStopAudio = document.getElementById('btn-stop-audio');
  const btnRetryFailedAudio = document.getElementById('btn-retry-failed-audio');
  const audioSort = document.getElementById('audio-sort');
  const btnExportAudio = document.getElementById('btn-export-audio');
  const btnExportAudioJson = document.getElementById('btn-export-audio-json');
  const btnClearAudio = document.getElementById('btn-clear-audio');
  const btnClearAudioHistory = document.getElementById('btn-clear-audio-history');
  const btnSyncAudioHistory = document.getElementById('btn-sync-audio-history');
  const audioListEl = document.getElementById('audio-list');
  
  const selectInst = document.getElementById('select-institution');
  const selectSort = document.getElementById('select-sort');
  const fileListEl = document.getElementById('file-list');
  const logViewerEl = document.getElementById('log-viewer');
  const btnSaveRemoteHistoryConfig = document.getElementById('btn-save-remote-history-config');

  function renderBatchProgress(kind, progress) {
    const container = document.getElementById(`${kind}-batch-progress`);
    if (!container) return;
    const total = Number(progress?.total) || 0;
    const isRelevant = progress?.kind === (kind === 'file' ? 'file' : 'audio') && total > 0;
    container.hidden = !isRelevant;
    if (!isRelevant) return;

    const formatted = formatBatchProgress(progress);
    const bar = document.getElementById(`${kind}-batch-progress-bar`);
    const text = document.getElementById(`${kind}-batch-progress-text`);
    const name = document.getElementById(`${kind}-batch-progress-name`);
    text.textContent = formatted.summary;
    name.textContent = formatted.currentName;
    name.title = formatted.currentName;
    bar.max = total;
    bar.value = Math.min(Number(progress.current) || 0, total);
    container.className = `batch-progress phase-${progress.phase || 'idle'}`;
  }

  // 2. 初始化机构下拉框
  INSTITUTIONS.forEach(inst => {
    const opt = document.createElement('option');
    opt.value = inst.keywords.join('|');
    opt.innerText = inst.label;
    selectInst.appendChild(opt);
  });

  // 3. Tab 切换逻辑
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    };
  });

  // 4. 通用：安全发消息函数
  async function safeSendMessage(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('zsxq.com')) return null;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    });
  }

  async function sendRuntimeMessage(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: 'EXTENSION_MESSAGE_FAILED' });
          return;
        }
        resolve(response || { success: false, error: 'NO_RESPONSE' });
      });
    });
  }

  async function reconcileAudioDownloadHistory() {
    return sendRuntimeMessage({ type: 'RECONCILE_AUDIO_DOWNLOAD_HISTORY' });
  }

  // 快捷日志显示
  async function showLog(message) {
    const data = await chrome.storage.local.get(['logs']);
    const logs = data.logs || [];
    logs.push({ timestamp: Date.now(), message });
    if (logs.length > 1000) logs.shift();
    await chrome.storage.local.set({ logs });
  }

  function downloadJsonList(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function exportListJson(kind) {
    const isAudio = kind === 'audio';
    const itemsKey = isAudio ? 'pendingAudio' : 'pendingFiles';
    const historyKey = isAudio ? 'downloadedAudioHistory' : 'downloadedHistory';
    const label = isAudio ? '音频' : 'PDF';
    const data = await chrome.storage.local.get([itemsKey, historyKey]);
    const items = data[itemsKey] || [];
    if (items.length === 0) {
      alert('列表为空，无可导出数据');
      return;
    }

    const payload = buildListJsonExport({
      kind,
      items,
      downloadedNames: data[historyKey] || []
    });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadJsonList(payload, `zsxq_${kind}_list_${timestamp}.json`);
    await showLog(`${label} 列表 JSON 已导出：${items.length} 条。`);
  }

  function getRemoteHistoryConfigFromForm() {
    const defaults = getDefaultRemoteHistoryConfig();
    const days = Number.parseInt(document.getElementById('remote-history-days').value, 10);
    return {
      endpoint: resolveRemoteHistoryEndpoint(document.getElementById('remote-history-endpoint').value),
      appId: document.getElementById('remote-history-app-id').value.trim(),
      appSecret: document.getElementById('remote-history-secret').value.trim(),
      groupId: document.getElementById('remote-history-group-id').value.trim() || defaults.groupId,
      pdfTabId: document.getElementById('remote-history-pdf-tab-id').value.trim(),
      mp3TabId: document.getElementById('remote-history-mp3-tab-id').value.trim(),
      days: Number.isFinite(days) && days > 0 ? days : defaults.days
    };
  }

  function fillRemoteHistoryConfig(rawConfig = {}) {
    const defaults = getDefaultRemoteHistoryConfig();
    const config = {
      endpoint: resolveRemoteHistoryEndpoint(rawConfig.endpoint),
      appId: rawConfig.appId || defaults.appId,
      appSecret: rawConfig.appSecret || defaults.appSecret,
      groupId: rawConfig.groupId || defaults.groupId,
      pdfTabId: rawConfig.pdfTabId || defaults.pdfTabId,
      mp3TabId: rawConfig.mp3TabId || defaults.mp3TabId,
      days: rawConfig.days || defaults.days
    };
    document.getElementById('remote-history-endpoint').value = config.endpoint;
    document.getElementById('remote-history-app-id').value = config.appId;
    document.getElementById('remote-history-secret').value = config.appSecret;
    document.getElementById('remote-history-group-id').value = config.groupId;
    document.getElementById('remote-history-pdf-tab-id').value = config.pdfTabId;
    document.getElementById('remote-history-mp3-tab-id').value = config.mp3TabId;
    document.getElementById('remote-history-days').value = config.days;
  }

  async function persistRemoteHistoryConfig() {
    const config = getRemoteHistoryConfigFromForm();
    await chrome.storage.local.set({ [REMOTE_HISTORY_CONFIG_KEY]: config });
    return config;
  }

  async function syncRemoteHistory(kind, button) {
    const originalText = button.innerText;
    button.disabled = true;
    button.innerText = '同步中...';
    try {
      await persistRemoteHistoryConfig();
      const result = await sendRuntimeMessage({ type: 'SYNC_REMOTE_HISTORY', payload: { kind } });
      if (!result.success) {
        alert(result.message || `同步失败：${result.error || 'UNKNOWN_ERROR'}`);
        return;
      }
      const label = kind === 'pdf' ? 'PDF' : '音频';
      alert(`${label} 下载历史同步完成：服务端返回 ${result.receivedCount} 条，可信 ${result.trustedCount} 条，本地列表标记 ${result.matchedCount} 条。`);
      await renderFromStorage();
    } finally {
      button.disabled = false;
      button.innerText = originalText;
    }
  }

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

  function getDateTimeInputMs(id) {
    const value = document.getElementById(id)?.value;
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }

  function isWithinUploadRange(file, startMs, endMs) {
    const uploadMs = parseUploadTimeValue(file.uploadTime);
    if (!uploadMs) return false;
    if (startMs && uploadMs < startMs) return false;
    if (endMs && uploadMs > endMs) return false;
    return true;
  }

  function isUploadedToday(file) {
    const uploadMs = parseUploadTimeValue(file.uploadTime);
    if (!uploadMs) return false;
    const uploadDate = new Date(uploadMs);
    const today = new Date();
    return uploadDate.getFullYear() === today.getFullYear()
      && uploadDate.getMonth() === today.getMonth()
      && uploadDate.getDate() === today.getDate();
  }

  // --- 5. 核心操作绑定 ---

  // 音频采集
  btnGoAudio.onclick = () => {
    chrome.tabs.create({ url: 'https://wx.zsxq.com/search/mp3?groupId=28888112822211&searchUid=0.8761816833421697' });
  };

  btnSaveRemoteHistoryConfig.onclick = async () => {
    await persistRemoteHistoryConfig();
    alert('远端下载历史配置已保存。');
  };

  btnSyncFileHistory.onclick = () => syncRemoteHistory('pdf', btnSyncFileHistory);
  btnSyncAudioHistory.onclick = () => syncRemoteHistory('mp3', btnSyncAudioHistory);

  btnScanAudio.onclick = async () => {
    btnScanAudio.innerText = '扫描中...';
    const response = await safeSendMessage({ type: 'SCAN_AUDIO' });
    btnScanAudio.innerText = '扫描列表';
    if (!response) alert('未连接到知识星球音频页面，请确认当前标签页是音频搜索页并已刷新。');
    else await reconcileAudioDownloadHistory();
    renderFromStorage();
  };

  function getAudioImportErrorMessage(error) {
    const messages = {
      AUDIO_IMPORT_JSON_INVALID: '导入失败：粘贴内容不是有效 JSON。',
      AUDIO_IMPORT_RESPONSE_NOT_SUCCEEDED: '导入失败：接口响应未返回成功状态。',
      AUDIO_IMPORT_FILES_MISSING: '导入失败：未找到 resp_data.files。',
      AUDIO_IMPORT_NO_AUDIO_FILES: '导入失败：响应中没有可导入的音频文件。'
    };
    return messages[error?.message] || `导入失败：${error?.message || 'UNKNOWN_ERROR'}`;
  }

  function closeAudioImportPanel() {
    audioImportPanel.hidden = true;
    audioImportResponse.value = '';
  }

  btnImportAudioResponse.onclick = () => {
    const isOpening = audioImportPanel.hidden;
    audioImportPanel.hidden = !isOpening;
    if (isOpening) audioImportResponse.focus();
  };

  btnCancelAudioImport.onclick = closeAudioImportPanel;

  btnConfirmAudioImport.onclick = async () => {
    const rawResponse = audioImportResponse.value.trim();
    if (!rawResponse) {
      alert('请先粘贴接口响应 JSON。');
      return;
    }

    try {
      const parsed = parseAudioSearchResponse(rawResponse);
      if (parsed.sourceCount > 0 && parsed.items.length === 0) {
        throw new Error('AUDIO_IMPORT_NO_AUDIO_FILES');
      }
      const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
      const merged = mergeImportedAudioItems(
        data.pendingAudio || [],
        parsed.items,
        data.downloadedAudioHistory || []
      );
      await chrome.storage.local.set({ pendingAudio: merged.items });
      await showLog(`音频接口响应导入完成：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。`);
      closeAudioImportPanel();
      await renderFromStorage();

      const nextPageHint = parsed.nextIndex === null ? '' : ` 下一页 index：${parsed.nextIndex}。`;
      const skippedHint = parsed.skippedCount > 0 ? ` 跳过 ${parsed.skippedCount} 条非音频记录。` : '';
      alert(`音频接口响应已导入：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。${nextPageHint}${skippedHint}`);
    } catch (error) {
      alert(getAudioImportErrorMessage(error));
    }
  };

  function getFileImportErrorMessage(error) {
    const messages = {
      FILE_IMPORT_JSON_INVALID: '导入失败：粘贴内容不是有效 JSON。',
      FILE_IMPORT_RESPONSE_NOT_SUCCEEDED: '导入失败：接口响应未返回成功状态。',
      FILE_IMPORT_TOPICS_MISSING: '导入失败：未找到 resp_data.topics。',
      FILE_IMPORT_NO_PDF_FILES: '导入失败：响应中没有可导入的 PDF 文件。'
    };
    return messages[error?.message] || `导入失败：${error?.message || 'UNKNOWN_ERROR'}`;
  }

  function closeFileImportPanel() {
    fileImportPanel.hidden = true;
    fileImportResponse.value = '';
  }

  btnImportFileResponse.onclick = () => {
    const isOpening = fileImportPanel.hidden;
    fileImportPanel.hidden = !isOpening;
    if (isOpening) fileImportResponse.focus();
  };

  btnCancelFileImport.onclick = closeFileImportPanel;

  btnConfirmFileImport.onclick = async () => {
    const rawResponse = fileImportResponse.value.trim();
    if (!rawResponse) {
      alert('请先粘贴接口响应 JSON。');
      return;
    }

    try {
      const parsed = parseFileSearchResponse(rawResponse);
      if (parsed.items.length === 0) throw new Error('FILE_IMPORT_NO_PDF_FILES');
      const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
      const merged = mergeImportedFileItems(
        data.pendingFiles || [],
        parsed.items,
        data.downloadedHistory || []
      );
      await chrome.storage.local.set({ pendingFiles: merged.items });
      await showLog(`PDF 接口响应导入完成：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。`);
      closeFileImportPanel();
      await renderFromStorage();

      const skippedHint = parsed.skippedCount > 0 ? ` 跳过 ${parsed.skippedCount} 条非 PDF 记录。` : '';
      alert(`PDF 接口响应已导入：新增 ${merged.addedCount} 条，更新 ${merged.updatedCount} 条。${skippedHint}`);
    } catch (error) {
      alert(getFileImportErrorMessage(error));
    }
  };

  btnDeepScanAudio.onclick = async () => {
    btnDeepScanAudio.style.display = 'none';
    btnStopDeepAudio.style.display = 'inline-block';
    const res = await safeSendMessage({ type: 'DEEP_SCAN_AUDIO' });
    if (!res) alert('音频深度扫描启动失败，请确认当前在音频搜索页并已刷新。');
    else await showLog(`音频下载量获取完成：更新 ${res.count || 0} 条，失败 ${res.failed || 0} 条。`);
    btnDeepScanAudio.style.display = 'inline-block';
    btnStopDeepAudio.style.display = 'none';
    renderFromStorage();
  };

  btnStopDeepAudio.onclick = async () => {
    await safeSendMessage({ type: 'STOP_DEEP_SCAN' });
    btnStopDeepAudio.innerText = '停止中...';
    setTimeout(() => { btnStopDeepAudio.innerText = '停止获取'; }, 2000);
  };

  btnBatchAudio.onclick = async () => {
    if (confirm('是否开始批量下载音频？')) {
      const limit = parseInt(document.getElementById('audio-download-limit').value) || 5;
      const minCount = parseInt(document.getElementById('audio-min-count').value) || 0;
      const untilName = document.getElementById('audio-download-until').value.trim();
      const uploadStartMs = getDateTimeInputMs('audio-upload-start-time');
      const uploadEndMs = getDateTimeInputMs('audio-upload-end-time');
      const data = await chrome.storage.local.get(['pendingAudio', 'downloadedAudioHistory']);
      const downloadedAudioHistory = data.downloadedAudioHistory || [];
      let audioItems = (data.pendingAudio || []).filter(a => (
        a.status !== 'done'
        && !downloadedAudioHistory.includes(a.name)
        && (minCount <= 0 || (a.downloadCount || 0) >= minCount)
        && isWithinUploadRange(a, uploadStartMs, uploadEndMs)
      ));
      
      // 排序 logic 与渲染保持一致
      audioItems.sort((a, b) => audioSort.value === 'count_desc'
        ? (b.downloadCount || 0) - (a.downloadCount || 0)
        : (b.uploadTime || '').localeCompare(a.uploadTime || ''));

      let audioToDownload = [];
      const pendingItems = audioItems.filter(a => a.status === 'pending');

      if (untilName) {
        // 如果指定了截止文件名，寻找其索引
        const untilIndex = pendingItems.findIndex(a => a.name === untilName);
        if (untilIndex !== -1) {
          audioToDownload = pendingItems.slice(0, untilIndex + 1);
        } else {
          // 模糊匹配
          const fuzzyIndex = pendingItems.findIndex(a => a.name.includes(untilName));
          if (fuzzyIndex !== -1) {
            audioToDownload = pendingItems.slice(0, fuzzyIndex + 1);
          } else {
            alert('未找到指定的截止文件，将按默认数量下载');
            audioToDownload = pendingItems.slice(0, limit);
          }
        }
      } else {
        audioToDownload = pendingItems.slice(0, limit);
      }

      chrome.runtime.sendMessage({
        type: 'START_BATCH_AUDIO_DOWNLOAD',
        payload: {
          limit: audioToDownload.length,
          minCount,
          uploadStartMs,
          uploadEndMs,
          sort: audioSort.value,
          filterNames: audioToDownload.map(a => a.name)
        }
      });
    }
  };

  btnRetryFailedAudio.onclick = async () => {
    const minCount = parseInt(document.getElementById('audio-min-count').value) || 0;
    const uploadStartMs = getDateTimeInputMs('audio-upload-start-time');
    const uploadEndMs = getDateTimeInputMs('audio-upload-end-time');
    const data = await chrome.storage.local.get(['pendingAudio']);
    const failedAudio = (data.pendingAudio || []).filter(a => (
      a.status === 'failed'
      && (minCount <= 0 || (a.downloadCount || 0) >= minCount)
      && isWithinUploadRange(a, uploadStartMs, uploadEndMs)
    ));
    if (failedAudio.length === 0) {
      alert('当前条件下没有失败音频可重新下载。');
      return;
    }
    if (!confirm(`是否重新下载 ${failedAudio.length} 个失败音频？`)) return;
    chrome.runtime.sendMessage({
      type: 'START_BATCH_AUDIO_DOWNLOAD',
      payload: {
        retryFailed: true,
        limit: 0,
        minCount,
        uploadStartMs,
        uploadEndMs,
        sort: audioSort.value,
        filterNames: failedAudio.map(a => a.name)
      }
    });
  };

  btnStopAudio.onclick = () => chrome.runtime.sendMessage({ type: 'STOP_BATCH_DOWNLOAD' });

  btnExportAudio.onclick = async () => {
    const data = await chrome.storage.local.get(['pendingAudio']);
    const items = data.pendingAudio || [];
    if (items.length === 0) {
      alert('列表为空，无可导出数据');
      return;
    }

    let csvContent = "\ufeff"; // UTF-8 BOM
    csvContent += "音频标题,上传时间,下载量,状态\n";
    items.forEach(item => {
      const row = [
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.uploadTime || ''}"`,
        `"${item.downloadCount || 0}"`,
        `"${item.status}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `zsxq_audio_export_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  btnExportAudioJson.onclick = () => exportListJson('audio');

  btnClearAudio.onclick = async () => {
    if (confirm('确定清空音频列表？下载记录将保留，用于避免重复下载。')) {
      await chrome.storage.local.set({ pendingAudio: [] });
      renderFromStorage();
    }
  };

  btnClearAudioHistory.onclick = async () => {
    if (confirm('确定清除音频下载记录？已完成的音频会重新变为可下载。')) {
      const data = await chrome.storage.local.get(['pendingAudio']);
      const pendingAudio = (data.pendingAudio || []).map(a => (
        a.status === 'done' ? { ...a, status: 'pending' } : a
      ));
      await chrome.storage.local.set({ downloadedAudioHistory: [], pendingAudio });
      renderFromStorage();
    }
  };

  // 刷新当前页
  btnScan.onclick = async () => {
    btnScan.innerText = '刷新中...';
    const activeTab = document.querySelector('.tab.active')?.dataset.tab;
    const messageType = activeTab === 'audio' ? 'SCAN_AUDIO' : 'SCAN_FILES';
    const response = await safeSendMessage({ type: messageType });
    btnScan.innerText = '刷新当前页';
    if (!response) alert('未连接到知识星球页面，请确认当前标签页是 zsxq.com 并已刷新。');
    else if (activeTab === 'audio') await reconcileAudioDownloadHistory();
    renderFromStorage();
  };

  // 深度扫描获取下载量
  btnDeepScan.onclick = async () => {
    btnDeepScan.style.display = 'none';
    btnStopDeep.style.display = 'inline-block';
    const res = await safeSendMessage({ type: 'DEEP_SCAN' });
    if (!res) alert('深度扫描启动失败，请确认当前在文件列表页并已刷新。');
    else await showLog(`文件下载量获取完成：更新 ${res.count || 0} 条，失败 ${res.failed || 0} 条。`);
    btnDeepScan.style.display = 'inline-block';
    btnStopDeep.style.display = 'none';
    renderFromStorage();
  };

  btnStopDeep.onclick = async () => {
    await safeSendMessage({ type: 'STOP_DEEP_SCAN' });
    btnStopDeep.innerText = '停止中...';
  };

  // 批量下载
  btnStartBatch.onclick = async () => {
    const limit = parseInt(document.getElementById('download-limit').value) || 5;
    const minCount = parseInt(document.getElementById('min-count').value) || 0;
    const uploadStartMs = getDateTimeInputMs('upload-start-time');
    const uploadEndMs = getDateTimeInputMs('upload-end-time');
    const data = await chrome.storage.local.get(['pendingFiles', 'downloadedHistory']);
    const downloadedHistory = data.downloadedHistory || [];
    const currentFilter = selectInst.value;
    
    // 应用当前筛选
    let filesToDownload = (data.pendingFiles || []).filter(f => (
      f.status !== 'done' && !downloadedHistory.includes(f.name)
    ));
    if (currentFilter) {
      const keywords = currentFilter.split('|');
      filesToDownload = filesToDownload.filter(f => keywords.some(k => f.name.toLowerCase().includes(k.toLowerCase())));
    }
    if (uploadStartMs || uploadEndMs) {
      filesToDownload = filesToDownload.filter(f => isWithinUploadRange(f, uploadStartMs, uploadEndMs));
    }

    if (filesToDownload.length === 0) {
      alert('当前筛选条件下没有可下载文件。');
      return;
    }

    chrome.runtime.sendMessage({ 
      type: 'START_BATCH_DOWNLOAD', 
      payload: {
        limit,
        minCount,
        filterNames: filesToDownload.map(f => f.name),
        uploadStartMs,
        uploadEndMs
      } 
    });
  };

  btnRetryFailed.onclick = async () => {
    const minCount = parseInt(document.getElementById('min-count').value) || 0;
    const uploadStartMs = getDateTimeInputMs('upload-start-time');
    const uploadEndMs = getDateTimeInputMs('upload-end-time');
    const data = await chrome.storage.local.get(['pendingFiles']);
    const currentFilter = selectInst.value;

    let failedFiles = (data.pendingFiles || []).filter(f => f.status === 'failed');
    if (currentFilter) {
      const keywords = currentFilter.split('|');
      failedFiles = failedFiles.filter(f => keywords.some(k => f.name.toLowerCase().includes(k.toLowerCase())));
    }
    if (uploadStartMs || uploadEndMs) {
      failedFiles = failedFiles.filter(f => isWithinUploadRange(f, uploadStartMs, uploadEndMs));
    }
    if (minCount > 0) {
      failedFiles = failedFiles.filter(f => (f.downloadCount || 0) >= minCount);
    }

    if (failedFiles.length === 0) {
      alert('当前条件下没有失败文件可重新下载。');
      return;
    }
    if (!confirm(`是否重新下载 ${failedFiles.length} 个失败文件？`)) return;

    await showLog(`准备重新下载失败文件：${failedFiles.length} 个`);
    chrome.runtime.sendMessage({
      type: 'START_RETRY_FAILED_DOWNLOAD',
      payload: {
        filterNames: failedFiles.map(f => f.name),
        minCount,
        uploadStartMs,
        uploadEndMs
      }
    });
  };

  btnStopBatch.onclick = () => chrome.runtime.sendMessage({ type: 'STOP_BATCH_DOWNLOAD' });

  // 导出列表数据
  btnExportList.onclick = async () => {
    const { pendingFiles = [] } = await chrome.storage.local.get('pendingFiles');
    if (pendingFiles.length === 0) {
      alert('列表为空，无可导出数据');
      return;
    }
    // CSV 内容构建 (带 BOM 以支持 Excel 中文)
    let csvContent = '\uFEFF文件名,下载次数,上传时间,状态\n';
    pendingFiles.forEach(f => {
      const name = f.name.includes(',') ? `"${f.name}"` : f.name;
      csvContent += `${name},${f.downloadCount || 0},${f.uploadTime || '-'},${f.status}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zsxq_files_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  btnExportListJson.onclick = () => exportListJson('pdf');

  // 清空 & 导出管理
  btnClearFiles.onclick = async () => {
    if (confirm('确定清空当前文件列表？已下载历史会保留，之后重新扫描仍会跳过已下载文件。')) {
      await chrome.storage.local.set({ pendingFiles: [] });
      renderFromStorage();
    }
  };

  btnClearLogs.onclick = async () => {
    if (confirm('确定清空所有日志？')) {
      await chrome.storage.local.set({ logs: [] });
      renderFromStorage();
    }
  };

  btnExportLogs.onclick = async () => {
    const { logs = [] } = await chrome.storage.local.get('logs');
    const logStr = logs.map(l => `[${new Date(l.timestamp).toLocaleString()}] ${l.message}`).join('\n');
    const blob = new Blob([logStr], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `logs_${Date.now()}.txt`; a.click();
  };

  // 排序 & 筛选变化
  selectInst.onchange = () => renderFromStorage();
  selectSort.onchange = () => renderFromStorage();
  ['audio-upload-start-time', 'audio-upload-end-time'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => renderFromStorage());
  });
  audioSort?.addEventListener('change', () => renderFromStorage());

  // 6. 存储变化实时更新 UI
  chrome.storage.onChanged.addListener(() => renderFromStorage());

  function getStatusText(status) {
    if (status === 'done') return '完成';
    if (status === 'failed') return '失败';
    if (status === 'processing') return '处理';
    return status || '待处理';
  }

  async function renderFromStorage() {
    const data = await chrome.storage.local.get(['pendingFiles', 'pendingAudio', 'downloadedHistory', 'downloadedAudioHistory', 'logs', 'isDownloading', 'batchDownloadProgress']);
    let files = data.pendingFiles || [];
    const downloadedHistory = data.downloadedHistory || [];
    const downloadedAudioHistory = data.downloadedAudioHistory || [];
    const audioUploadStartMs = getDateTimeInputMs('audio-upload-start-time');
    const audioUploadEndMs = getDateTimeInputMs('audio-upload-end-time');
    let audioItems = (data.pendingAudio || []).filter(a => (
      isWithinUploadRange(a, audioUploadStartMs, audioUploadEndMs)
    ));
    const isDownloading = data.isDownloading || false;

    // 更新批量按钮状态
    btnStartBatch.style.display = isDownloading ? 'none' : 'inline-block';
    btnStopBatch.style.display = isDownloading ? 'inline-block' : 'none';
    btnRetryFailed.style.display = isDownloading ? 'none' : 'inline-block';
    if (btnBatchAudio && btnStopAudio) {
      btnBatchAudio.style.display = isDownloading ? 'none' : 'inline-block';
      btnStopAudio.style.display = isDownloading ? 'inline-block' : 'none';
      if (btnRetryFailedAudio) btnRetryFailedAudio.style.display = isDownloading ? 'none' : 'inline-block';
    }
    renderBatchProgress('file', data.batchDownloadProgress);
    renderBatchProgress('audio', data.batchDownloadProgress);

    // 1. 筛选
    const filterVal = selectInst.value;
    if (filterVal) {
      const keywords = filterVal.split('|');
      files = files.filter(f => keywords.some(k => f.name.toLowerCase().includes(k.toLowerCase())));
    }

    // 2. 排序
    const sortVal = selectSort.value;
    files.sort((a, b) => {
      if (sortVal === 'count_desc') return (b.downloadCount || 0) - (a.downloadCount || 0);
      if (sortVal === 'time_asc') return (a.uploadTime || '').localeCompare(b.uploadTime || '');
      return (b.uploadTime || '').localeCompare(a.uploadTime || ''); // time_desc
    });

    // 3. 渲染
    document.getElementById('count-found').innerText = files.length;
    document.getElementById('count-today').innerText = files.filter(isUploadedToday).length;
    document.getElementById('count-done').innerText = (data.pendingFiles || []).filter(f => f.status === 'done').length;

    fileListEl.innerHTML = files.length === 0 
      ? '<li class="empty-hint">无内容</li>'
      : files.map(f => {
        const isDownloaded = f.status === 'done' || downloadedHistory.includes(f.name);
        return `
        <li class="file-item ${f.downloadCount >= 30 ? 'download-tier-30' : f.downloadCount >= 25 ? 'download-tier-25' : ''} ${isDownloaded ? 'downloaded' : ''}">
          <span class="file-name" title="${f.name}">${f.name}</span>
          <span class="file-time">${f.uploadTime || '-'}</span>
          <span class="file-count ${f.downloadCount >= 30 ? 'count-high' : ''}">${f.downloadCount || 0}</span>
          <div class="col-status">
            ${isDownloaded ? '<span class="status-badge status-done">已下载</span>' : f.status === 'pending' ? `<button class="btn-single-dl" data-name="${f.name}">下载</button>` : `<span class="status-badge status-${f.status}">${getStatusText(f.status)}</span>`}
          </div>
        </li>
      `;
      }).join('');

    // 单个下载按钮绑定
    document.querySelectorAll('.btn-single-dl').forEach(btn => {
      btn.onclick = (e) => chrome.runtime.sendMessage({ type: 'START_SINGLE_DOWNLOAD', payload: { fileName: e.target.dataset.name } });
    });

    // 日志展示
    const logs = data.logs || [];
    logViewerEl.innerHTML = logs.map(l => `<div class="log-entry">[${new Date(l.timestamp).toLocaleTimeString()}] ${l.message}</div>`).reverse().join('');

    // 音频展示
    const audioFoundCountEl = document.getElementById('audio-found-count');
    if (audioFoundCountEl) audioFoundCountEl.innerText = audioItems.length;

    audioItems.sort((a, b) => audioSort.value === 'count_desc'
      ? (b.downloadCount || 0) - (a.downloadCount || 0)
      : (b.uploadTime || '').localeCompare(a.uploadTime || ''));

    if (audioListEl) {
      audioListEl.innerHTML = audioItems.length === 0 
        ? '<li class="empty-hint">进入音频搜索页后点击“扫描”</li>'
        : audioItems.map(a => {
          const isAudioDownloaded = a.status === 'done' || downloadedAudioHistory.includes(a.name);
          return `
          <li class="audio-item ${a.downloadCount >= 30 ? 'audio-tier-30' : a.downloadCount >= 20 ? 'audio-tier-20' : a.downloadCount >= 10 ? 'audio-tier-10' : ''} ${isAudioDownloaded ? 'downloaded' : ''}">
            <span class="file-name" title="${a.name}">${a.name}</span>
            <span class="file-time">${a.uploadTime || '-'}</span>
            <span class="file-count ${a.downloadCount >= 30 ? 'count-high' : ''}" style="text-align:center;">${a.downloadCount || 0}</span>
            <div class="col-status">
              ${isAudioDownloaded ? '<span class="status-badge status-done">已下载</span>' : a.status === 'pending' ? `<button class="btn-single-audio-dl" data-name="${a.name}">下载</button>` : `<span class="status-badge status-${a.status}">${getStatusText(a.status)}</span>`}
            </div>
          </li>
        `;
        }).join('');

      // 音频下载按钮绑定
      document.querySelectorAll('.btn-single-audio-dl').forEach(btn => {
        btn.onclick = (e) => chrome.runtime.sendMessage({ type: 'START_SINGLE_AUDIO_DOWNLOAD', payload: { fileName: e.target.dataset.name } });
      });

      // 点击文件名快速填入“截止到”
      document.querySelectorAll('#audio-list .file-name').forEach(el => {
        el.style.cursor = 'pointer';
        el.onclick = (e) => {
          const name = e.target.innerText;
          document.getElementById('audio-download-until').value = name;
          showLog(`已设置截止到: ${name.substring(0, 20)}...`);
        };
      });
    }
  }

  privateRemoteHistoryCredentials = await loadPrivateRemoteHistoryCredentials();
  const storedConfig = await chrome.storage.local.get(REMOTE_HISTORY_CONFIG_KEY);
  fillRemoteHistoryConfig(storedConfig[REMOTE_HISTORY_CONFIG_KEY]);
  renderFromStorage();
});
