const DOWNLOAD_EXTENSION_PATTERN = /\.(?:pdf|mp3|m4a|wav)$/i;
const CHROME_DUPLICATE_SUFFIX_PATTERN = /\s*\(\d+\)$/;

export function normalizeDownloadFilename(text = '') {
  const basename = String(text).split(/[\\/]/).pop() || '';
  return basename
    .trim()
    .replace(DOWNLOAD_EXTENSION_PATTERN, '')
    .replace(CHROME_DUPLICATE_SUFFIX_PATTERN, '')
    .replace(/\.{3}|…/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function downloadNamesMatch(downloadFilename, expectedName) {
  const expected = normalizeDownloadFilename(expectedName);
  const filename = normalizeDownloadFilename(downloadFilename);
  if (!expected || !filename) return false;
  if (filename.includes(expected) || expected.includes(filename)) return true;

  const tokens = expected
    .split(/[-_：:；;，,（）()\[\]\s]+/)
    .filter(token => token.length >= 2)
    .slice(0, 5);
  if (tokens.length === 0) return false;

  const hits = tokens.filter(token => filename.includes(token)).length;
  return hits >= Math.min(3, tokens.length);
}

export function downloadNamesEqual(downloadFilename, expectedName) {
  const expected = normalizeDownloadFilename(expectedName);
  const filename = normalizeDownloadFilename(downloadFilename);
  return Boolean(expected && filename && expected === filename);
}

export function findExactDownloadMatches(expectedNames = [], downloadItems = []) {
  const matches = new Map();
  for (const expectedName of expectedNames) {
    const match = downloadItems.find(item => downloadNamesEqual(item?.filename, expectedName));
    if (match) matches.set(expectedName, match);
  }
  return matches;
}
