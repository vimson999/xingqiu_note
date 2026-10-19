import { RECORDER_KEY, MAX_RECORDS } from '../utils/api-recorder.mjs';

export function initApiRecorderPanel(sendMessage, downloadJson) {
  const status = document.getElementById('recorder-status');
  const list = document.getElementById('recorder-list');
  const detail = document.getElementById('recorder-detail');
  const start = document.getElementById('btn-recorder-start');
  const stop = document.getElementById('btn-recorder-stop');
  const clear = document.getElementById('btn-recorder-clear');
  const exportButton = document.getElementById('btn-recorder-export');
  let current = null;
  let selected = -1;

  function render(session) {
    const changedSession = current?.id !== session?.id;
    current = session;
    if (changedSession) selected = -1;
    const records = session?.records || [];
    start.disabled = Boolean(session?.active);
    stop.disabled = !session?.active;
    clear.disabled = !session;
    exportButton.disabled = !records.length;
    const phase = session?.active ? '记录中' : session?.stopReason === 'capacity' ? '容量已满，已停止'
      : session?.stopReason === 'storage-error' ? '存储失败，已停止' : '已停止';
    status.textContent = session
      ? `${phase} · 星球 ${session.groupId} · ${records.length}/${MAX_RECORDS} 条 · ${(session.bytes / 1000000).toFixed(2)} MB`
      : '尚未开始记录';
    list.replaceChildren();
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index];
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'recorder-row';
      button.dataset.index = String(index);
      button.title = record.request.url;
      for (const value of [new Date(record.startedAt || record.recordedAt).toLocaleTimeString(),
        record.request.method, String(record.response.status || 'ERR'),
        new URL(record.request.url).pathname + new URL(record.request.url).search]) {
        const span = document.createElement('span');
        span.textContent = value;
        button.appendChild(span);
      }
      row.appendChild(button);
      list.appendChild(row);
    }
    if (!records.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-hint';
      empty.textContent = session?.active ? '等待当前星球的接口请求…' : '暂无记录';
      list.appendChild(empty);
    }
    if (selected < 0 && records.length) selected = records.length - 1;
    detail.value = selected >= 0 && records[selected] ? JSON.stringify(records[selected], null, 2) : '';
  }

  async function command(type) {
    try {
      const result = await sendMessage({ type });
      if (!result?.success) alert(result?.error || '接口记录操作失败。');
      const data = await chrome.storage.local.get(RECORDER_KEY);
      render(data[RECORDER_KEY]);
    } catch (error) { alert(`接口记录操作失败：${error.message}`); }
  }
  start.onclick = () => {
    if (current?.records?.length && !confirm('开始新记录会替换现有接口记录，是否继续？')) return;
    command('API_RECORDER_START');
  };
  stop.onclick = () => command('API_RECORDER_STOP');
  clear.onclick = () => {
    if (confirm('是否停止并清空接口记录？')) command('API_RECORDER_CLEAR');
  };
  exportButton.onclick = async () => {
    const data = await chrome.storage.local.get(RECORDER_KEY);
    const session = data[RECORDER_KEY];
    if (!session?.records.length) return;
    downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(),
      scope: 'current-tab-and-group', limits: { maxRecords: MAX_RECORDS, maxResponseCharacters: 2000000, maxSessionBytes: 6000000 },
      ...session }, `zsxq-api-${session.groupId}-${Date.now()}.json`);
  };
  list.onclick = event => {
    const button = event.target.closest('[data-index]');
    if (!button) return;
    selected = Number(button.dataset.index);
    detail.value = JSON.stringify(current.records[selected], null, 2);
  };
  let revision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[RECORDER_KEY]) return;
    revision++;
    render(changes[RECORDER_KEY].newValue);
  });
  const initialRevision = revision;
  chrome.storage.local.get(RECORDER_KEY).then(data => {
    if (revision === initialRevision) render(data[RECORDER_KEY]);
  });
}
