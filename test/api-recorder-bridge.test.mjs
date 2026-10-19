import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('recorder bridge handles startup ordering, active tab config and stop notifications', async () => {
  let receive;
  let storageChanged;
  let initialReply;
  const posted = [];
  const forwarded = [];
  const window = {
    location: { origin: 'https://wx.zsxq.com' },
    addEventListener: (_, listener) => { receive = listener; },
    postMessage: message => posted.push(message)
  };
  vm.runInNewContext(await readFile(new URL('../src/content/api-recorder-bridge.js', import.meta.url), 'utf8'), {
    window,
    chrome: {
      storage: { onChanged: { addListener: listener => { storageChanged = listener; } } },
      runtime: { sendMessage(message, callback) {
        if (message.type === 'API_RECORDER_CONFIG') initialReply = callback;
        else { forwarded.push(message); callback({ success: true }); }
      } }
    }
  });
  const emit = (type, payload) => receive({ source: window, origin: window.location.origin,
    data: { source: 'ZSXQ_ASSISTANT_API_RECORDER', type, payload } });
  emit('READY');
  assert.equal(posted.length, 0);
  initialReply({ tabId: 7, config: { id: 's', active: true, groupId: '123' } });
  emit('ENTRY', { sessionId: 's', responseBody: '{}' });
  assert.equal(forwarded.length, 1);
  emit('ENTRY', { sessionId: 'old', responseBody: '{}' });
  assert.equal(forwarded.length, 1);
  storageChanged({ apiRecorderSession: { newValue: { id: 's', tabId: 7, active: false, groupId: '123' } } }, 'local');
  assert.equal(posted.at(-1).config.active, false);
  emit('ENTRY', { sessionId: 's', responseBody: '{}' });
  assert.equal(forwarded.length, 1);
});
