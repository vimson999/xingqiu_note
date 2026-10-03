import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { requestRemoteHistory } from '../src/utils/remote-history-request.mjs';

const config = {
  endpoint: 'https://history.example/api/v1/zsxq/browser-import/history',
  appId: 'test-app-id', appSecret: 'test-secret', days: 3,
  groupId: 'group', pdfTabId: 'pdf-tab', mp3TabId: 'mp3-tab'
};

test('signs the exact UTF-8 body sent with epoch seconds and the path, for both kinds', async () => {
  for (const kind of ['mp3', 'pdf']) {
    const responseBody = { success: true, data: { kind, complete: true, files: [] } };
    const result = await requestRemoteHistory({ ...config, appId: ' test-app-id ', appSecret: ' test-secret ' }, kind, {
      fetchImpl: async (url, options) => {
        assert.equal(url, config.endpoint);
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), {
          kind, days: 3, group_id: 'group', tab_id: `${kind === 'pdf' ? 'pdf' : 'mp3'}-tab`
        });
        const timestamp = options.headers['X-Timestamp'];
        assert.ok(Math.abs(Number(timestamp) - Date.now() / 1000) < 2);
        const signingText = [config.appId, timestamp, 'POST', new URL(url).pathname,
          createHash('sha256').update(options.body, 'utf8').digest('hex')].join('\n');
        assert.equal(options.headers['X-Signature'], createHmac('sha256', config.appSecret).update(signingText).digest('hex'));
        return Response.json(responseBody);
      }
    });
    assert.deepEqual(result, { success: true, body: responseBody });
  }
});

test('preserves HTTP 500 for JSON and HTML errors, without exposing credentials', async () => {
  const json = await requestRemoteHistory(config, 'pdf', {
    fetchImpl: async (_, options) => Response.json({
      error: { message: `database unavailable ${config.appId} ${config.appSecret} ${options.headers['X-Signature']}` }
    }, { status: 500 })
  });
  assert.equal(json.error, 'REMOTE_HISTORY_HTTP_500');
  assert.ok(json.message.includes(config.endpoint));
  assert.match(json.message, /database unavailable \[redacted\] \[redacted\] \[redacted\]/);
  const html = await requestRemoteHistory(config, 'pdf', {
    fetchImpl: async () => new Response('<html>proxy error</html>', { status: 500 })
  });
  assert.equal(html.error, 'REMOTE_HISTORY_HTTP_500');
  assert.ok(!html.message.includes('<html>'));
});

test('distinguishes invalid JSON, application failure and network failure', async () => {
  const invalid = await requestRemoteHistory(config, 'mp3', { fetchImpl: async () => new Response('invalid') });
  assert.equal(invalid.error, 'REMOTE_HISTORY_INVALID_RESPONSE');
  const rejected = await requestRemoteHistory(config, 'mp3', {
    fetchImpl: async () => Response.json({ success: false, message: 'bad parameters' })
  });
  assert.equal(rejected.error, 'REMOTE_HISTORY_REQUEST_FAILED');
  assert.match(rejected.message, /bad parameters/);
  const offline = await requestRemoteHistory(config, 'mp3', { fetchImpl: async () => { throw new Error('Failed to fetch'); } });
  assert.equal(offline.error, 'REMOTE_HISTORY_NETWORK_ERROR');
});

test('times out and aborts while awaiting either response headers or body', async () => {
  for (const stalledAt of ['headers', 'body']) {
    let signal;
    const result = await requestRemoteHistory(config, 'mp3', {
      timeoutMs: 10,
      fetchImpl: async (_, options) => {
        signal = options.signal;
        const stalled = () => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return stalledAt === 'headers' ? stalled() : { ok: true, text: stalled };
      }
    });
    assert.equal(result.error, 'REMOTE_HISTORY_TIMEOUT');
    assert.equal(signal.aborted, true);
  }
});
