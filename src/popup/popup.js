/**
 * Popup 控制逻辑 v0.4.4 - 知识星球助手
 * 默认排序：按下载量从高到低 (count_desc)
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

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 按钮 & 元素定义
  const btnScan = document.getElementById('btn-scan');
  const btnDeepScan = document.getElementById('btn-deep-scan');
  const btnStopDeep = document.getElementById('btn-stop-deep');
  const btnStartBatch = document.getElementById('btn-start-batch');
  const btnStopBatch = document.getElementById('btn-stop-batch');
  const btnExportList = document.getElementById('btn-export-list');
  const btnClearFiles = document.getElementById('btn-clear-files');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const btnExportLogs = document.getElementById('btn-export-logs');

  // 音频 tab 按钮
  const btnGoAudio = document.getElementById('btn-go-audio');
  const btnScanAudio = document.getElementById('btn-scan-audio');
  const btnDeepScanAudio = document.getElementById('btn-deep-scan-audio');
  const btnBatchAudio = document.getElementById('btn-batch-audio');
  const btnExportAudio = document.getElementById('btn-export-audio');
  const btnClearAudio = document.getElementById('btn-clear-audio');
  const audioListEl = document.getElementById('audio-list');
  
  const selectInst = document.getElementById('select-institution');
  const selectSort = document.getElementById('select-sort');
  const fileListEl = document.getElementById('file-list');
  const logViewerEl = document.getElementById('log-viewer');

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

  // --- 5. 核心操作绑定 ---

  // 音频采集
  btnGoAudio.onclick = () => {
    chrome.tabs.create({ url: 'https://wx.zsxq.com/search/mp3?groupId=28888112822211&searchUid=0.8761816833421697' });
  };

  btnScanAudio.onclick = async () => {
    btnScanAudio.innerText = '扫描中...';
    await safeSendMessage({ type: 'SCAN_AUDIO' });
    btnScanAudio.innerText = '2. 扫描当前列表';
    renderFromStorage();
  };

  btnDeepScanAudio.onclick = async () => {
    btnDeepScanAudio.innerText = '获取中...';
    await safeSendMessage({ type: 'DEEP_SCAN_AUDIO' });
    btnDeepScanAudio.innerText = '3. 获取下载量 (Deep Scan)';
    renderFromStorage();
  };

  btnBatchAudio.onclick = async () => {
    if (confirm('是否开始批量下载音频？')) {
      chrome.runtime.sendMessage({ type: 'START_BATCH_AUDIO_DOWNLOAD' });
    }
  };

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
        `"${item.time || ''}"`,
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

  btnClearAudio.onclick = async () => {
    if (confirm('确定清空音频列表并重置下载历史？')) {
      await chrome.storage.local.set({ pendingAudio: [], downloadedHistory: [] });
      renderFromStorage();
    }
  };

  // 刷新当前页
  btnScan.onclick = async () => {
    btnScan.innerText = '刷新中...';
    await safeSendMessage({ type: 'SCAN_FILES' });
    btnScan.innerText = '刷新当前页';
    renderFromStorage();
  };

  // 深度扫描获取下载量
  btnDeepScan.onclick = async () => {
    btnDeepScan.style.display = 'none';
    btnStopDeep.style.display = 'inline-block';
    await safeSendMessage({ type: 'DEEP_SCAN' });
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
    const data = await chrome.storage.local.get(['pendingFiles']);
    const currentFilter = selectInst.value;
    
    // 应用当前筛选
    let filesToDownload = data.pendingFiles || [];
    if (currentFilter) {
      const keywords = currentFilter.split('|');
      filesToDownload = filesToDownload.filter(f => keywords.some(k => f.name.toLowerCase().includes(k.toLowerCase())));
    }

    chrome.runtime.sendMessage({ 
      type: 'START_BATCH_DOWNLOAD', 
      payload: { limit, minCount, filterNames: filesToDownload.map(f => f.name) } 
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

  // 清空 & 导出管理
  btnClearFiles.onclick = async () => {
    if (confirm('确定清空文件列表并重置下载历史？')) {
      await chrome.storage.local.set({ pendingFiles: [], downloadedHistory: [] });
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

  // 6. 存储变化实时更新 UI
  chrome.storage.onChanged.addListener(() => renderFromStorage());

  function getStatusText(status) {
    if (status === 'done') return '完成';
    if (status === 'failed') return '失败';
    if (status === 'processing') return '处理';
    return status || '待处理';
  }

  async function renderFromStorage() {
    const data = await chrome.storage.local.get(['pendingFiles', 'pendingAudio', 'logs', 'isDownloading']);
    let files = data.pendingFiles || [];
    const audioItems = data.pendingAudio || [];
    const isDownloading = data.isDownloading || false;

    // 更新批量按钮状态
    btnStartBatch.style.display = isDownloading ? 'none' : 'inline-block';
    btnStopBatch.style.display = isDownloading ? 'inline-block' : 'none';

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
    document.getElementById('count-done').innerText = (data.pendingFiles || []).filter(f => f.status === 'done').length;

    fileListEl.innerHTML = files.length === 0 
      ? '<li class="empty-hint">无内容</li>'
      : files.map(f => `
        <li class="file-item">
          <span class="file-name" title="${f.name}">${f.name}</span>
          <span class="file-time">${f.uploadTime || '-'}</span>
          <span class="file-count ${f.downloadCount > 30 ? 'count-high' : ''}">${f.downloadCount || 0}</span>
          <div class="col-status">
            ${f.status === 'pending' ? `<button class="btn-single-dl" data-name="${f.name}">下载</button>` : `<span class="status-badge status-${f.status}">${getStatusText(f.status)}</span>`}
          </div>
        </li>
      `).join('');

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

    // 默认按下载量排序 (如果已经 Deep Scan)
    audioItems.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));

    if (audioListEl) {
      audioListEl.innerHTML = audioItems.length === 0 
        ? '<li class="empty-hint">进入音频搜索页后点击“扫描”</li>'
        : audioItems.map(a => `
          <li class="audio-item">
            <span class="file-name" title="${a.name}">${a.name}</span>
            <span class="file-time">${a.uploadTime || '-'}</span>
            <span class="file-count ${a.downloadCount > 30 ? 'count-high' : ''}" style="text-align:center;">${a.downloadCount || 0}</span>
            <div class="col-status">
              ${a.status === 'pending' ? `<button class="btn-single-audio-dl" data-name="${a.name}">下载</button>` : `<span class="status-badge status-${a.status}">${a.status === 'done' ? '完成' : '处理'}</span>`}
            </div>
          </li>
        `).join('');

      // 音频下载按钮绑定
      document.querySelectorAll('.btn-single-audio-dl').forEach(btn => {
        btn.onclick = (e) => chrome.runtime.sendMessage({ type: 'START_SINGLE_AUDIO_DOWNLOAD', payload: { fileName: e.target.dataset.name } });
      });
    }
  }

  renderFromStorage();
});
