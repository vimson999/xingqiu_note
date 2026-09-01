(() => {
  const EVENT_SOURCE = 'ZSXQ_ASSISTANT_SEARCH_CAPTURE';
  const EVENT_TYPE = 'SEARCH_RESPONSE';
  const MAX_RESPONSE_LENGTH = 2_000_000;

  function isContextInvalidated(error) {
    return String(error?.message || error).includes('Extension context invalidated');
  }

  function forwardCapturedResponse(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        try {
          void chrome.runtime.lastError;
        } catch (error) {
          if (!isContextInvalidated(error)) throw error;
        }
      });
    } catch (error) {
      // A page can retain this old script after the extension has been reloaded.
      if (!isContextInvalidated(error)) throw error;
    }
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

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.source !== EVENT_SOURCE || data.type !== EVENT_TYPE) return;
    const captureKind = getCaptureKind(data.sourceUrl);
    if (!captureKind || data.captureKind !== captureKind) return;
    if (typeof data.rawResponse !== 'string' || data.rawResponse.length > MAX_RESPONSE_LENGTH) return;

    forwardCapturedResponse({
      type: captureKind === 'audio' ? 'AUTO_IMPORT_AUDIO_RESPONSE' : 'AUTO_IMPORT_FILE_RESPONSE',
      payload: {
        sourceUrl: data.sourceUrl,
        rawResponse: data.rawResponse
      }
    });
  });
})();
