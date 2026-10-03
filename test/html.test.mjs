import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeHtml } from '../src/utils/html.mjs';

test('escapes filenames, attributes and remote error text without changing ordinary text', () => {
  assert.equal(escapeHtml('研究 "A&B" <2026>\'s.mp3'), '研究 &quot;A&amp;B&quot; &lt;2026&gt;&#39;s.mp3');
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml('研究报告.mp3'), '研究报告.mp3');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});
