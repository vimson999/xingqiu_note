(() => {
  const SOURCE = 'ZSXQ_ASSISTANT_API_RECORDER';
  const LIMIT = 2000000;
  if (window.__ZSXQ_API_RECORDER__) return;
  window.__ZSXQ_API_RECORDER__ = true;
  let config = null;
  try { config = JSON.parse(window.sessionStorage.getItem(SOURCE)); } catch {}
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === window.location.origin
      && event.data?.source === SOURCE && event.data.type === 'CONFIG') {
      config = event.data.config;
      try { window.sessionStorage.setItem(SOURCE, JSON.stringify(config)); } catch {}
    }
  });
  const post = (type, payload) => window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  const clipped = value => {
    const text = typeof value === 'string' ? value : '';
    return { text: text.slice(0, LIMIT), truncated: text.length > LIMIT };
  };
  function begin(rawUrl, method, transport) {
    try {
      const url = new URL(rawUrl, window.location.href);
      const groupId = new URL(window.location.href).pathname.match(/^\/group\/(\d+)(?:\/|$)/)?.[1];
      if (!config?.active || groupId !== config.groupId || url.origin !== 'https://api.zsxq.com') return null;
      return { sessionId: config.id, pageUrl: window.location.href, url: url.href,
        method: method || 'GET', transport, startedAt: Date.now() };
    } catch { return null; }
  }
  function emit(state, result) {
    post('ENTRY', { ...state, ...result, durationMs: Date.now() - state.startedAt });
  }
  async function readResponse(response) {
    const reader = response.body?.getReader?.();
    if (!reader) return clipped(await response.text());
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return clipped(text + decoder.decode());
        text += decoder.decode(value, { stream: true });
        if (text.length > LIMIT) {
          reader.cancel().catch(() => {});
          return { text: text.slice(0, LIMIT), truncated: true };
        }
      }
    } finally { reader.releaseLock(); }
  }
  function requestDetails(input, init) {
    const headers = {};
    new Headers(init?.headers ?? input?.headers).forEach((value, key) => {
      if (['accept', 'content-type', 'x-version'].includes(key)) headers[key] = value;
    });
    const body = init?.body;
    if (typeof body === 'string' || body instanceof URLSearchParams) {
      return Promise.resolve({ headers, ...clipped(String(body)) });
    }
    if (body != null) return Promise.resolve({ headers, text: '[binary body omitted]', truncated: false });
    if (typeof input?.clone === 'function' && !['GET', 'HEAD'].includes(input.method)) {
      return readResponse(input.clone()).then(value => ({ headers, ...value }));
    }
    return Promise.resolve({ headers, text: '', truncated: false });
  }
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') window.fetch = function (input, init) {
    const state = begin(typeof input === 'string' || input instanceof URL ? String(input) : input?.url,
      init?.method || input?.method, 'fetch');
    let details;
    if (state) { try { details = requestDetails(input, init).catch(() => ({ text: '', headers: {} })); } catch {} }
    const result = originalFetch.apply(this, arguments);
    if (state) Promise.resolve(result).then(async response => {
      const body = await readResponse(response.clone());
      const request = await details || {};
      emit(state, { requestHeaders: request.headers, requestBody: request.text, requestBodyTruncated: request.truncated,
        status: response.status, contentType: response.headers.get('content-type'),
        responseBody: body.text, responseBodyTruncated: body.truncated });
    }, async error => {
      const request = await details || {};
      emit(state, { status: 0, error: String(error?.message || error), requestHeaders: request.headers,
        requestBody: request.text, requestBodyTruncated: request.truncated });
    }).catch(() => {});
    return result;
  };
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalHeader = proto.setRequestHeader;
  const states = new WeakMap();
  proto.open = function (method, url, ...rest) {
    const result = originalOpen.call(this, method, url, ...rest);
    states.set(this, { method, url, headers: {} });
    return result;
  };
  proto.setRequestHeader = function (key, value) {
    const result = originalHeader.call(this, key, value);
    const state = states.get(this);
    if (state && ['accept', 'content-type', 'x-version'].includes(String(key).toLowerCase())) state.headers[String(key).toLowerCase()] = value;
    return result;
  };
  proto.send = function (body) {
    const info = states.get(this);
    const state = info && begin(info.url, info.method, 'xhr');
    if (state) {
      const request = clipped(typeof body === 'string' || body instanceof URLSearchParams ? String(body) : '');
      this.addEventListener('loadend', () => {
        try {
          let raw = '';
          if (this.responseType === 'json') raw = JSON.stringify(this.response);
          else if (!this.responseType || this.responseType === 'text') raw = this.responseText;
          const response = clipped(raw);
          emit(state, { requestHeaders: info.headers, requestBody: request.text, requestBodyTruncated: request.truncated,
            status: this.status, contentType: this.getResponseHeader('content-type'),
            responseBody: response.text, responseBodyTruncated: response.truncated,
            error: this.status === 0 ? 'XHR_NETWORK_ERROR_OR_ABORT' : null });
        } catch {}
      }, { once: true });
    }
    return originalSend.apply(this, arguments);
  };
  post('READY');
})();
