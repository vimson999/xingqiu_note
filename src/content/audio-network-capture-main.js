(() => {
  const INSTALL_MARKER = '__ZSXQ_ASSISTANT_SEARCH_CAPTURE_INSTALLED__';
  const EVENT_SOURCE = 'ZSXQ_ASSISTANT_SEARCH_CAPTURE';
  const EVENT_TYPE = 'SEARCH_RESPONSE';
  const MAX_RESPONSE_LENGTH = 2_000_000;

  if (window[INSTALL_MARKER]) return;
  window[INSTALL_MARKER] = true;

  function toAbsoluteUrl(value) {
    try {
      if (typeof value === 'string') return new URL(value, window.location.href).href;
      if (value && typeof value.url === 'string') return new URL(value.url, window.location.href).href;
    } catch {
      return '';
    }
    return '';
  }

  function getCaptureKind(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const keyword = String(url.searchParams.get('keyword') || '').toLowerCase();
      if (url.origin !== 'https://api.zsxq.com') return null;
      if (url.pathname === '/v2/search/files' && keyword.includes('mp3')) return 'audio';
      if (url.pathname === '/v2/hashtags/51184248544214/topics') return 'pdf';
      return null;
    } catch {
      return null;
    }
  }

  function emitResponse(captureKind, sourceUrl, rawResponse) {
    if (!captureKind || typeof rawResponse !== 'string' || rawResponse.length > MAX_RESPONSE_LENGTH) return;
    window.postMessage({
      source: EVENT_SOURCE,
      type: EVENT_TYPE,
      captureKind,
      sourceUrl,
      rawResponse
    }, window.location.origin);
  }

  function captureFetchResponse(sourceUrl, response) {
    const captureKind = getCaptureKind(sourceUrl);
    if (!captureKind || !response?.ok) return;
    response.clone().text()
      .then(rawResponse => emitResponse(captureKind, sourceUrl, rawResponse))
      .catch(() => {});
  }

  function installFetchCapture() {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    window.fetch = function (...args) {
      const sourceUrl = toAbsoluteUrl(args[0]);
      const result = originalFetch.apply(this, args);
      Promise.resolve(result)
        .then(response => captureFetchResponse(sourceUrl, response))
        .catch(() => {});
      return result;
    };
  }

  function getXhrResponseText(xhr) {
    try {
      if (typeof xhr.responseText === 'string') return xhr.responseText;
    } catch {
      // responseType may not allow responseText access.
    }
    if (typeof xhr.response === 'string') return xhr.response;
    if (xhr.response && typeof xhr.response === 'object') {
      try {
        return JSON.stringify(xhr.response);
      } catch {
        return '';
      }
    }
    return '';
  }

  function installXhrCapture() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const requestStates = new WeakMap();

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      let state = requestStates.get(this);
      if (!state) {
        state = { sourceUrl: '', captureKind: null };
        requestStates.set(this, state);
        this.addEventListener('loadend', () => {
          if (!state.captureKind || this.status < 200 || this.status >= 300) return;
          emitResponse(state.captureKind, state.sourceUrl, getXhrResponseText(this));
        });
      }
      state.sourceUrl = toAbsoluteUrl(url);
      state.captureKind = getCaptureKind(state.sourceUrl);
      return originalOpen.call(this, method, url, ...rest);
    };
  }

  try {
    installFetchCapture();
    installXhrCapture();
  } catch {
    // The page must keep working even if it prevents one interception path.
  }
})();
