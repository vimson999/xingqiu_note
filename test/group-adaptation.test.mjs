import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudioSearchResponse, mergeImportedAudioItems } from '../src/utils/audio-response-import.mjs';
import { parseFileSearchResponse, mergeImportedFileItems } from '../src/utils/file-response-import.mjs';
import { groupCaptureId } from '../src/utils/audio-network-capture.mjs';
import { LEGACY_GROUP_ID, historyKey, wasDownloaded, inGroup, pageGroupId } from '../src/utils/group-scope.mjs';
import { appendApiRecord } from '../src/utils/api-recorder.mjs';

const group = { group_id: '88885882121542', name: 'Hong Hao' };
const voice = { file_id: '214848145212111', name: 'outlook.mp3', duration: 75, download_count: 155, create_time: '2026-10-17T18:08:30.306+0800' };
const pdf = { file_id: '584141815822124', name: 'recap.pdf', download_count: 2382 };
const topic = { topic_uid: '82258242485284482', group, content_voice: voice, talk: { files: [pdf, voice] } };

test('extracts content_voice and nested topic file metadata without duplicating MP3 rows', () => {
  const response = { succeeded: true, resp_data: { topics: [topic] } };
  const audio = parseAudioSearchResponse(response).items;
  assert.equal(audio.length, 1);
  assert.equal(audio[0].audioSource, 'content_voice');
  assert.equal(audio[0].groupId, group.group_id);
  assert.equal(audio[0].topicId, topic.topic_uid);
  assert.equal(audio[0].downloadCount, 155);
  const filesResponse = { succeeded: true, resp_data: { files: [{ file: voice, topic }, { file: pdf, topic }] } };
  assert.equal(parseAudioSearchResponse(filesResponse).items[0].topicId, topic.topic_uid);
  const fileItems = parseFileSearchResponse(filesResponse).items;
  assert.equal(fileItems.length, 1);
  assert.equal(fileItems[0].groupId, group.group_id);
  assert.equal(fileItems[0].downloadCount, 2382);
});

test('keeps matching names and download histories separate across groups', () => {
  for (const merge of [mergeImportedAudioItems, mergeImportedFileItems]) {
    const result = merge([{ name: 'same.mp3', status: 'done', groupId: LEGACY_GROUP_ID }], [
      { name: 'same.mp3', groupId: group.group_id, fileId: 'different' }
    ], ['same.mp3']);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[1].status, 'pending');
    assert.equal(wasDownloaded(['same.mp3'], result.items[1]), false);
    assert.equal(wasDownloaded([historyKey(result.items[1])], result.items[1]), true);
    assert.equal(inGroup(result.items[0], group.group_id), false);
  }
});

test('recognizes group feed, sticky and files endpoints, excluding unrelated APIs', () => {
  for (const suffix of ['topics?scope=all&count=20', 'topics/sticky?count=3', 'files?count=20']) {
    assert.equal(groupCaptureId(`https://api.zsxq.com/v2/groups/${group.group_id}/${suffix}`), group.group_id);
  }
  assert.equal(groupCaptureId(`https://api.zsxq.com/v2/groups/${group.group_id}/members`), null);
  assert.equal(pageGroupId(`https://wx.zsxq.com/search/mp3?groupId=${group.group_id}`), group.group_id);
});

test('retains complete JSON bodies larger than the previous 250000-character limit', () => {
  const raw = JSON.stringify({ succeeded: true, resp_data: { text: 'x'.repeat(300000) } });
  const session = { id: 's', groupId: group.group_id, active: true, records: [], bytes: 0 };
  const next = appendApiRecord(session, { sessionId: 's', pageUrl: `https://wx.zsxq.com/group/${group.group_id}`,
    url: `https://api.zsxq.com/v2/groups/${group.group_id}/topics?count=20`, responseBody: raw, status: 200 });
  assert.equal(next.records[0].response.body.resp_data.text.length, 300000);
  assert.equal(next.records[0].response.bodyTruncated, false);
});

test('background serializes concurrent group imports and DOM scans without mixing legacy rows', async t => {
  const originalChrome = globalThis.chrome;
  const storage = { pendingFiles: [{ name: 'recap.pdf', status: 'done' }], pendingAudio: [] };
  let listener;
  globalThis.chrome = {
    runtime: { onMessage: { addListener(fn) { listener ||= fn; } } },
    alarms: { onAlarm: { addListener() {} } },
    storage: { local: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, storage[key]]))); },
      async set(values) { Object.assign(storage, structuredClone(values)); }
    } }
  };
  t.after(() => { globalThis.chrome = originalChrome; });
  await import(`../src/background/main.js?group-adaptation=${Date.now()}`);
  const send = (type, payload) => new Promise(resolve => listener({ type, payload }, {}, resolve));
  const payload = { sourceUrl: `https://api.zsxq.com/v2/groups/${group.group_id}/topics?scope=all`,
    rawResponse: JSON.stringify({ succeeded: true, resp_data: { topics: [topic] } }) };
  await Promise.all([send('AUTO_IMPORT_GROUP_RESPONSE', payload), send('AUTO_IMPORT_GROUP_RESPONSE', payload)]);
  assert.equal(storage.pendingFiles.length, 2);
  assert.equal(storage.pendingFiles[0].status, 'done');
  assert.equal(storage.pendingFiles[1].status, 'pending');
  assert.equal(storage.pendingAudio.length, 1);
  await send('MERGE_SCANNED_ITEMS', { kind: 'audio', groupId: group.group_id,
    items: [{ name: voice.name, uploadTime: '2026-10-17 18:08', status: 'pending', downloadCount: 0 }] });
  assert.equal(storage.pendingAudio.length, 1);
  assert.equal(storage.pendingAudio[0].downloadCount, 155);
});
