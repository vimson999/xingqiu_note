import { buildRemoteHistorySigningText, hmacSha256Hex, sha256Hex } from './remote-history.mjs';

function responseDetail(body) {
  const candidates = [body?.message, body?.error?.message, body?.error, body?.errors?.[0]];
  return candidates.find(value => typeof value === 'string' && value.trim()) || '';
}

export async function requestRemoteHistory(config, kind, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const endpoint = new URL(config.endpoint);
  const appId = config.appId.trim();
  const secret = config.appSecret.trim();
  const body = JSON.stringify({
    kind, days: config.days, group_id: config.groupId,
    tab_id: kind === 'pdf' ? config.pdfTabId : config.mp3TabId
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacSha256Hex(secret, buildRemoteHistorySigningText({
    appId, timestamp, path: endpoint.pathname, bodySha256: await sha256Hex(body)
  }));
  const sanitize = value => {
    let text = String(value);
    for (const credential of [secret, signature, appId]) {
      if (credential) text = text.replaceAll(credential, '[redacted]');
    }
    return text.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 300);
  };
  const failure = (error, detail = '') => ({
    success: false, error,
    message: `${kind.toUpperCase()} 历史同步失败：${error}\n接口：${endpoint.origin}${endpoint.pathname}${detail ? `\n说明：${sanitize(detail)}` : ''}`
  });

  const controller = new AbortController();
  let timedOut = false;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('REMOTE_HISTORY_TIMEOUT'));
      }, timeoutMs);
    });
    // Keep the deadline active until the body is read, not just until headers arrive.
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(endpoint.href, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json', 'X-App-Id': appId,
          'X-Timestamp': timestamp, 'X-Signature': signature
        },
        body
      });
      let responseBody;
      try {
        responseBody = JSON.parse(await response.text());
      } catch {
        if (controller.signal.aborted) throw new Error('REMOTE_HISTORY_TIMEOUT');
        return failure(response.ok ? 'REMOTE_HISTORY_INVALID_RESPONSE' : `REMOTE_HISTORY_HTTP_${response.status}`,
          '服务端未返回有效 JSON。');
      }
      if (!response.ok) return failure(`REMOTE_HISTORY_HTTP_${response.status}`, responseDetail(responseBody));
      if (responseBody?.success !== true) return failure('REMOTE_HISTORY_REQUEST_FAILED', responseDetail(responseBody));
      return { success: true, body: responseBody };
    })()]);
  } catch (error) {
    return timedOut
      ? failure('REMOTE_HISTORY_TIMEOUT', `请求超过 ${timeoutMs / 1000} 秒，未修改本地历史。`)
      : failure('REMOTE_HISTORY_NETWORK_ERROR', error.message);
  } finally {
    clearTimeout(timer);
  }
}
