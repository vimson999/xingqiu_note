export const RECORDER_KEY = 'apiRecorderSession';
export const MAX_RECORDS = 200;
export const MAX_SESSION_BYTES = 6_000_000;
const MAX_TEXT_LENGTH = 2_000_000;
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-signature|x-app-id|x-timestamp|password|passwd|secret|app_secret|appSecret|access_token|refresh_token|token|signature)$/i;

export function groupFromPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)zsxq\.com$/.test(url.hostname)
      ? url.pathname.match(/^\/group\/(\d+)(?:\/|$)/)?.[1] || null : null;
  } catch { return null; }
}

function redact(value, depth = 0) {
  if (depth > 40) return '[depth limit]';
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => (
    [key, SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)]
  )));
  return value;
}

function bodyValue(raw, truncated) {
  if (raw == null) return null;
  const text = String(raw).slice(0, MAX_TEXT_LENGTH);
  if (truncated || String(raw).length > MAX_TEXT_LENGTH) return '[body truncated; content omitted]';
  try { return redact(JSON.parse(text)); } catch {
    // Form parameters can carry credentials too; binary and unstructured bodies are omitted.
    if (/^[^=&\s]+=[^]*$/.test(text)) return redact(Object.fromEntries(new URLSearchParams(text)));
    return text ? '[non-JSON body omitted]' : '';
  }
}

export function normalizeApiRecord(payload, session) {
  if (!payload || payload.sessionId !== session.id || groupFromPage(payload.pageUrl) !== session.groupId) return null;
  let url;
  try { url = new URL(payload.url); } catch { return null; }
  if (url.origin !== 'https://api.zsxq.com' || url.href.length > 16000) return null;
  for (const key of [...url.searchParams.keys()]) if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[redacted]');
  const headers = {};
  for (const [key, value] of Object.entries(payload.requestHeaders || {})) {
    if (['accept', 'content-type', 'x-version'].includes(key.toLowerCase())) headers[key.toLowerCase()] = String(value).slice(0, 200);
  }
  return {
    recordedAt: new Date().toISOString(),
    pageUrl: new URL(payload.pageUrl).origin + new URL(payload.pageUrl).pathname,
    groupId: session.groupId,
    transport: payload.transport === 'xhr' ? 'xhr' : 'fetch',
    startedAt: Number.isFinite(payload.startedAt) ? payload.startedAt : null,
    durationMs: Math.max(0, Number(payload.durationMs) || 0),
    request: {
      url: url.href, method: String(payload.method || 'GET').slice(0, 16).toUpperCase(),
      query: [...url.searchParams.entries()], headers,
      body: bodyValue(payload.requestBody, payload.requestBodyTruncated),
      bodyTruncated: Boolean(payload.requestBodyTruncated)
    },
    response: {
      status: Number(payload.status) || 0,
      contentType: String(payload.contentType || '').slice(0, 200),
      body: bodyValue(payload.responseBody, payload.responseBodyTruncated),
      bodyTruncated: Boolean(payload.responseBodyTruncated),
      error: payload.error ? String(payload.error).slice(0, 200) : null
    }
  };
}

export function appendApiRecord(session, payload) {
  if (!session?.active) return session;
  const record = normalizeApiRecord(payload, session);
  if (!record) return session;
  const size = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  if (session.records.length >= MAX_RECORDS || session.bytes + size > MAX_SESSION_BYTES) {
    return { ...session, active: false, stoppedAt: Date.now(), stopReason: 'capacity' };
  }
  const records = [...session.records, record];
  return { ...session, records, bytes: session.bytes + size,
    ...(records.length >= MAX_RECORDS ? { active: false, stoppedAt: Date.now(), stopReason: 'capacity' } : {}) };
}

export function registerApiRecorder(chromeApi) {
  let queue = Promise.resolve();
  const enqueue = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['API_RECORDER_START', 'API_RECORDER_STOP', 'API_RECORDER_CLEAR', 'API_RECORDER_CONFIG', 'API_RECORDER_ENTRY'].includes(message.type)) return;
    enqueue(async () => {
      const { [RECORDER_KEY]: session } = await chromeApi.storage.local.get(RECORDER_KEY);
      if (message.type === 'API_RECORDER_CONFIG') {
        return { success: true, tabId: sender.tab?.id, config: session && session.tabId === sender.tab?.id
          ? { active: session.active, id: session.id, groupId: session.groupId } : null };
      }
      if (message.type === 'API_RECORDER_ENTRY') {
        if (!session?.active || sender.tab?.id !== session.tabId || (sender.frameId ?? 0) !== 0) return { success: false };
        // sender.url can retain the original document URL after a SPA switches groups.
        const currentTab = await chromeApi.tabs.get(session.tabId);
        if (groupFromPage(currentTab.url) !== session.groupId) return { success: false };
        const next = appendApiRecord(session, message.payload);
        if (next !== session) {
          try { await chromeApi.storage.local.set({ [RECORDER_KEY]: next }); } catch (error) {
            await chromeApi.storage.local.set({ [RECORDER_KEY]: { ...session, active: false,
              stoppedAt: Date.now(), stopReason: 'storage-error' } });
            throw error;
          }
        }
        return { success: true };
      }
      // Only the extension UI may start, clear or stop a session.
      if (!sender.url?.startsWith(chromeApi.runtime.getURL(''))) return { success: false, error: 'RECORDER_UI_ONLY' };
      let next;
      if (message.type === 'API_RECORDER_START') {
        const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        const groupId = groupFromPage(tab?.url);
        if (!groupId || !tab?.id) return { success: false, error: '请先打开要记录的星球首页。' };
        next = { id: crypto.randomUUID(), tabId: tab.id, groupId, pageUrl: tab.url,
          active: true, startedAt: Date.now(), records: [], bytes: 0, stopReason: null };
      } else if (message.type === 'API_RECORDER_CLEAR') {
        next = null;
      } else {
        next = session ? { ...session, active: false, stoppedAt: Date.now(), stopReason: 'manual' } : null;
      }
      await chromeApi.storage.local.set({ [RECORDER_KEY]: next });
      return { success: true };
    }).then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  });
}
