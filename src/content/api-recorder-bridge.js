(() => {
  const SOURCE = 'ZSXQ_ASSISTANT_API_RECORDER';
  let tabId;
  let session = null;
  function configure() {
    if (tabId === undefined) return;
    window.postMessage({ source: SOURCE, type: 'CONFIG', config: session && session.tabId === tabId
      ? { active: session.active, id: session.id, groupId: session.groupId } : null }, window.location.origin);
  }
  function send(message, callback) {
    try {
      chrome.runtime.sendMessage(message, response => {
        try { if (!chrome.runtime.lastError) callback?.(response); } catch { /* Old extension context. */ }
      });
    } catch { /* A refreshed extension needs a refreshed page. */ }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== SOURCE) return;
    if (event.data.type === 'READY') return configure();
    if (event.data.type !== 'ENTRY' || !session?.active || session.tabId !== tabId) return;
    const payload = event.data.payload;
    if (!payload || payload.sessionId !== session.id) return;
    if (typeof payload.responseBody === 'string' && payload.responseBody.length > 2000000) return;
    if (typeof payload.requestBody === 'string' && payload.requestBody.length > 2000000) return;
    send({ type: 'API_RECORDER_ENTRY', payload });
  });
  let revision = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.apiRecorderSession) return;
    revision++;
    session = changes.apiRecorderSession.newValue;
    configure();
  });
  const initialRevision = revision;
  send({ type: 'API_RECORDER_CONFIG' }, response => {
    tabId = response?.tabId;
    if (revision === initialRevision) session = response?.config ? { ...response.config, tabId } : null;
    configure();
  });
})();
