import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MANIFEST_URL = new URL('../manifest.json', import.meta.url);

test('allows the service worker to call the configured remote history host', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_URL, 'utf8'));

  assert.ok(manifest.host_permissions.includes('https://xiaoshanqing.tech/*'));
});
