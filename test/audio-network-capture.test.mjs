import assert from 'node:assert/strict';
import test from 'node:test';

const captureModule = import('../src/utils/audio-network-capture.mjs').catch(() => ({}));

test('only accepts the ZSXQ MP3 search endpoint for automatic capture', async () => {
  const { isAudioSearchRequest } = await captureModule;

  assert.equal(typeof isAudioSearchRequest, 'function');
  assert.equal(
    isAudioSearchRequest('https://api.zsxq.com/v2/search/files?keyword=mp3&count=20&index=100&order_by=time'),
    true
  );
  assert.equal(
    isAudioSearchRequest('https://api.zsxq.com/v2/search/files?keyword=PDF&count=20'),
    false
  );
  assert.equal(
    isAudioSearchRequest('https://example.com/v2/search/files?keyword=mp3'),
    false
  );
});

test('accepts the configured audio topic endpoint as a second audio import source', async () => {
  const { isAudioImportRequest, isAudioTopicRequest } = await captureModule;

  assert.equal(typeof isAudioTopicRequest, 'function');
  assert.equal(typeof isAudioImportRequest, 'function');
  assert.equal(
    isAudioTopicRequest('https://api.zsxq.com/v2/hashtags/88844545452542/topics?count=20&end_time=2026-09-11T20%3A51%3A31.352%2B0800'),
    true
  );
  assert.equal(
    isAudioTopicRequest('https://api.zsxq.com/v2/hashtags/51184248544214/topics?count=20'),
    false
  );
  assert.equal(
    isAudioImportRequest('https://api.zsxq.com/v2/search/files?keyword=mp3&count=20'),
    true
  );
  assert.equal(
    isAudioImportRequest('https://api.zsxq.com/v2/hashtags/88844545452542/topics?count=20'),
    true
  );
  assert.equal(
    isAudioImportRequest('https://api.zsxq.com/v2/hashtags/51184248544214/topics?count=20'),
    false
  );
});

test('only accepts the configured ZSXQ PDF topic endpoint for automatic capture', async () => {
  const { isFileTopicRequest } = await captureModule;

  assert.equal(typeof isFileTopicRequest, 'function');
  assert.equal(
    isFileTopicRequest('https://api.zsxq.com/v2/hashtags/51184248544214/topics?count=20'),
    true
  );
  assert.equal(
    isFileTopicRequest('https://api.zsxq.com/v2/hashtags/51184248544215/topics?count=20'),
    false
  );
  assert.equal(
    isFileTopicRequest('https://api.zsxq.com/v2/search/files?keyword=pdf'),
    false
  );
});
