import assert from 'node:assert/strict';
import test from 'node:test';
import { appendApiRecord, groupFromPage, MAX_RECORDS, MAX_SESSION_BYTES, registerApiRecorder } from '../src/utils/api-recorder.mjs';

const session = () => ({ id: 'session-1', groupId: '123', tabId: 7, active: true, records: [], bytes: 0 });
const entry = () => ({ sessionId: 'session-1', pageUrl: 'https://wx.zsxq.com/group/123',
  url: 'https://api.zsxq.com/v2/groups/123/topics?count=20&token=private', method: 'POST',
  requestHeaders: { authorization: 'private', cookie: 'private', 'x-signature': 'private', 'Content-Type': 'application/json' },
  requestBody: '{"count":20,"secret":"private"}', status: 200,
  responseBody: '{"succeeded":true,"resp_data":{"topics":[{"topic_id":"999","token":"private"}]}}' });

test('records structured requests and responses while removing authentication fields', () => {
  const next = appendApiRecord(session(), entry());
  assert.equal(next.records.length, 1);
  const record = next.records[0];
  assert.equal(record.request.body.count, 20);
  assert.equal(record.response.body.resp_data.topics[0].topic_id, '999');
  assert.equal(record.request.headers['content-type'], 'application/json');
  assert.ok(!JSON.stringify(next).includes('private'));
  assert.ok(next.bytes > 0);
});

test('rejects other groups, other sessions and non-API hosts; retains HTTP errors', () => {
  const initial = session();
  for (const patch of [{ pageUrl: 'https://wx.zsxq.com/group/456' }, { sessionId: 'old' },
    { url: 'https://example.com/api' }, { pageUrl: 'https://fakezsxq.com/group/123' }]) {
    assert.equal(appendApiRecord(initial, { ...entry(), ...patch }), initial);
  }
  assert.equal(groupFromPage('https://wx.zsxq.com/group/123/'), '123');
  const failed = appendApiRecord(initial, { ...entry(), status: 500, responseBody: '{"error":"failed"}' });
  assert.equal(failed.records[0].response.status, 500);
});

test('limits session capacity without dropping previously collected samples', () => {
  const initial = session();
  initial.bytes = MAX_SESSION_BYTES - 1;
  const next = appendApiRecord(initial, entry());
  assert.equal(next.stopReason, 'capacity');
  assert.equal(next.active, false);
  assert.deepEqual(next.records, []);
  const nearlyFull = { ...session(), records: Array(MAX_RECORDS - 1).fill({}) };
  assert.equal(appendApiRecord(nearlyFull, entry()).active, false);
  const truncated = appendApiRecord(session(), { ...entry(), responseBody: '{"token":"private', responseBodyTruncated: true });
  assert.equal(truncated.records[0].response.bodyTruncated, true);
  assert.ok(!JSON.stringify(truncated).includes('private'));
});

test('serializes simultaneous responses and restores capture config after worker restart', async () => {
  const storage = {};
  const listeners = [];
  const api = {
    runtime: { onMessage: { addListener: fn => listeners.push(fn) }, getURL: () => 'chrome-extension://test/' },
    tabs: {
      query: async () => [{ id: 7, url: 'https://wx.zsxq.com/group/123' }],
      get: async () => ({ id: 7, url: 'https://wx.zsxq.com/group/123' })
    },
    storage: { local: {
      get: async key => structuredClone({ [key]: storage[key] }),
      set: async values => { Object.assign(storage, structuredClone(values)); }
    } }
  };
  registerApiRecorder(api);
  const ui = { url: 'chrome-extension://test/src/popup/index.html' };
  const page = { tab: { id: 7 }, url: 'https://wx.zsxq.com/group/123' };
  const send = (type, sender = ui, payload) => new Promise(resolve => listeners.at(-1)({ type, payload }, sender, resolve));
  assert.equal((await send('API_RECORDER_START')).success, true);
  const config = await send('API_RECORDER_CONFIG', page);
  assert.equal(config.config.active, true);
  const payload = { ...entry(), sessionId: config.config.id };
  // Chrome may keep the old group's document URL on messages after history.pushState.
  const oldDocumentSender = { ...page, url: 'https://wx.zsxq.com/group/456' };
  await send('API_RECORDER_ENTRY', oldDocumentSender, payload);
  assert.equal(storage.apiRecorderSession.records.length, 1);
  await Promise.all(Array.from({ length: 8 }, () => send('API_RECORDER_ENTRY', page, payload)));
  assert.equal(storage.apiRecorderSession.records.length, 9);
  await send('API_RECORDER_ENTRY', { ...page, tab: { id: 99 } }, payload);
  assert.equal(storage.apiRecorderSession.records.length, 9);
  api.tabs.get = async () => ({ id: 7, url: 'https://wx.zsxq.com/group/789' });
  await send('API_RECORDER_ENTRY', page, payload);
  assert.equal(storage.apiRecorderSession.records.length, 9);
  api.tabs.get = async () => ({ id: 7, url: 'https://wx.zsxq.com/group/123' });
  registerApiRecorder(api);
  assert.equal((await send('API_RECORDER_CONFIG', page)).config.id, config.config.id);
  assert.equal((await send('API_RECORDER_CLEAR', page)).success, false);
  await send('API_RECORDER_STOP');
  await send('API_RECORDER_ENTRY', page, payload);
  assert.equal(storage.apiRecorderSession.records.length, 9);
  assert.equal(storage.apiRecorderSession.active, false);
  await send('API_RECORDER_CLEAR');
  assert.equal(storage.apiRecorderSession, null);
});
