(function () {
  const PAGE_SOURCE = 'ZSXQ_DOUBAO_AUDIO_PAGE';
  const CONTENT_SOURCE = 'ZSXQ_DOUBAO_AUDIO_CONTENT';

  function injectPageScript() {
    const root = document.documentElement || document.head || document.body;
    if (!root) {
      setTimeout(injectPageScript, 50);
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/doubao/injected.js');
    script.onload = function () { this.remove(); };
    root.appendChild(script);
  }

  function sendPageCommand(command) {
    const requestId = `doubao-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ success: false, error: 'TIMEOUT' });
      }, 3000);

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== PAGE_SOURCE || data.type !== 'RESPONSE' || data.requestId !== requestId) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(data.payload || { success: true });
      }

      window.addEventListener('message', onMessage);
      window.postMessage({ source: CONTENT_SOURCE, type: 'COMMAND', command, requestId }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'DOUBAO_AUDIO_COMMAND') return false;
    sendPageCommand(message.command)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  });

  injectPageScript();
})();
