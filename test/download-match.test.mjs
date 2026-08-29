import assert from 'node:assert/strict';
import test from 'node:test';

import {
  downloadNamesEqual,
  downloadNamesMatch,
  findExactDownloadMatches,
  normalizeDownloadFilename
} from '../src/utils/download-match.mjs';

test('matches an audio file renamed by Chrome for a duplicate download', () => {
  assert.equal(
    downloadNamesMatch('/Users/test/Downloads/行业晨报 (1).mp3', '行业晨报.mp3'),
    true
  );
});

test('normalizes supported download extensions and duplicate suffixes', () => {
  assert.equal(normalizeDownloadFilename('  研究报告 (2).PDF  '), '研究报告');
  assert.equal(normalizeDownloadFilename('市场解读 (3).m4a'), '市场解读');
});

test('does not match unrelated downloads from the same batch', () => {
  assert.equal(
    downloadNamesMatch('/Users/test/Downloads/另一份音频.mp3', '行业晨报.mp3'),
    false
  );
});

test('reconciles prior audio rows only against exact normalized browser downloads', () => {
  const matches = findExactDownloadMatches(
    ['行业晨报.mp3', '另一份音频.mp3'],
    [
      { id: 10, filename: '/Users/test/Downloads/行业晨报 (1).mp3' },
      { id: 11, filename: '/Users/test/Downloads/相似但不同的音频.mp3' }
    ]
  );

  assert.equal(matches.get('行业晨报.mp3')?.id, 10);
  assert.equal(matches.has('另一份音频.mp3'), false);
  assert.equal(downloadNamesEqual('行业晨报 (1).mp3', '行业晨报.mp3'), true);
  assert.equal(downloadNamesEqual('行业晨报摘要.mp3', '行业晨报.mp3'), false);
});
