import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const MAIN_SOURCE_URL = new URL('../src/content/audio-network-capture-main.js', import.meta.url);

test('captures the configured audio topic fetch response from the page', async () => {
  const postedMessages = [];
  const rawResponse = '{"succeeded":true,"resp_data":{"topics":[]}}';
  const sourceUrl = 'https://api.zsxq.com/v2/hashtags/88844545452542/topics?count=20';
  const fakeWindow = {
    location: {
      href: 'https://wx.zsxq.com/group/28888112822211',
      origin: 'https://wx.zsxq.com'
    },
    fetch: async () => ({
      ok: true,
      clone() {
        return { text: async () => rawResponse };
      }
    }),
    postMessage(message, targetOrigin) {
      postedMessages.push({ message, targetOrigin });
    }
  };
  class FakeXMLHttpRequest {
    addEventListener() {}
  }
  FakeXMLHttpRequest.prototype.open = function () {};

  const source = await readFile(MAIN_SOURCE_URL, 'utf8');
  vm.runInNewContext(source, {
    URL,
    Promise,
    window: fakeWindow,
    XMLHttpRequest: FakeXMLHttpRequest
  });

  await fakeWindow.fetch(sourceUrl);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].targetOrigin, fakeWindow.location.origin);
  assert.equal(postedMessages[0].message.captureKind, 'audio');
  assert.equal(postedMessages[0].message.sourceUrl, sourceUrl);
  assert.equal(postedMessages[0].message.rawResponse, rawResponse);
});
