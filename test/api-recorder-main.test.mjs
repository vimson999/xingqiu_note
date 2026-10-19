import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('fetch capture is opt-in, bounded, group scoped and leaves the original response readable', async () => {
  const posted = [];
  let receive;
  const response = Response.json({ succeeded: true, resp_data: { topics: [{ topic_id: '999' }] } });
  let pending = Promise.resolve(response);
  const window = {
    location: { href: 'https://wx.zsxq.com/group/123', origin: 'https://wx.zsxq.com' },
    fetch: () => pending,
    addEventListener: (_, listener) => { receive = listener; },
    postMessage: message => posted.push(message)
  };
  class Xhr {}
  Xhr.prototype.open = Xhr.prototype.send = Xhr.prototype.setRequestHeader = () => {};
  vm.runInNewContext(await readFile(new URL('../src/content/api-recorder-main.js', import.meta.url), 'utf8'), {
    window, XMLHttpRequest: Xhr, URL, URLSearchParams, Headers, TextDecoder, Date
  });
  const configure = active => receive({ source: window, origin: window.location.origin,
    data: { source: 'ZSXQ_ASSISTANT_API_RECORDER', type: 'CONFIG', config: { active, id: 's', groupId: '123' } } });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 1));
  };
  await window.fetch('https://api.zsxq.com/v2/groups/123/topics');
  await flush();
  assert.equal(posted.filter(item => item.type === 'ENTRY').length, 0);
  configure(true);
  const originalPromise = pending;
  assert.equal(window.fetch('https://api.zsxq.com/v2/groups/123/topics', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': 'private' }, body: '{"count":20}'
  }), originalPromise);
  await flush();
  const captured = posted.find(item => item.type === 'ENTRY').payload;
  assert.equal(captured.method, 'POST');
  assert.equal(captured.requestBody, '{"count":20}');
  assert.equal(captured.requestHeaders['x-signature'], undefined);
  assert.equal(JSON.parse(captured.responseBody).resp_data.topics[0].topic_id, '999');
  assert.equal((await response.json()).succeeded, true);
  window.location.href = 'https://wx.zsxq.com/group/456';
  pending = Promise.resolve(Response.json({}));
  await window.fetch('https://api.zsxq.com/v2/groups/456/topics');
  await flush();
  assert.equal(posted.filter(item => item.type === 'ENTRY').length, 1);
  window.location.href = 'https://wx.zsxq.com/group/123';
  pending = Promise.resolve(new Response('x'.repeat(2000100), { status: 500 }));
  await window.fetch('https://api.zsxq.com/v2/groups/123/topics');
  await flush();
  assert.equal(posted.at(-1).payload.responseBodyTruncated, true);
  assert.equal(posted.at(-1).payload.status, 500);
  configure(false);
  pending = Promise.resolve(Response.json({}));
  await window.fetch('https://api.zsxq.com/v2/groups/123/topics');
  await flush();
  assert.equal(posted.filter(item => item.type === 'ENTRY').length, 2);
});
