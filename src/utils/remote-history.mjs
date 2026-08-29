const CHROME_DUPLICATE_SUFFIX = /\s*\(\d+\)(?=\.[^.]+$)/;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function remoteRecordTimestamp(record) {
  const value = record?.last_seen_at || record?.downloaded_at || record?.published_at_canonical || record?.published_at;
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function preferNewestRecord(current, candidate) {
  if (!current || remoteRecordTimestamp(candidate) >= remoteRecordTimestamp(current)) return candidate;
  return current;
}

export function normalizeRemoteFilename(value = '') {
  return String(value)
    .trim()
    .replace(CHROME_DUPLICATE_SUFFIX, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function buildRemoteHistorySigningText({ appId, timestamp, method = 'POST', path, bodySha256 }) {
  return [appId, timestamp, method.toUpperCase(), path, bodySha256].join('\n');
}

export function getTrustedRemoteFiles(files = []) {
  return files.filter(file => (
    file?.success === true
    && typeof file.filename === 'string'
    && file.filename.trim().length > 0
  ));
}

export function mergeRemoteHistoryRecords(existingFiles = [], incomingFiles = []) {
  const byDedupeKey = new Map();
  [...existingFiles, ...incomingFiles].forEach(file => {
    if (!getTrustedRemoteFiles([file]).length) return;
    const dedupeKey = typeof file.dedupe_key === 'string' ? file.dedupe_key.trim() : '';
    const key = dedupeKey || `filename:${normalizeRemoteFilename(file.normalized_filename || file.filename)}`;
    byDedupeKey.set(key, preferNewestRecord(byDedupeKey.get(key), file));
  });

  return [...byDedupeKey.values()].sort((left, right) => (
    remoteRecordTimestamp(right) - remoteRecordTimestamp(left)
  ));
}

export function getRemoteHistoryNames(files = []) {
  const names = new Set();
  getTrustedRemoteFiles(files).forEach(file => {
    [file.filename, file.normalized_filename].forEach(name => {
      if (typeof name === 'string' && name.trim()) names.add(name.trim());
    });
  });
  return [...names];
}

export function applyRemoteHistory(items = [], remoteFiles = []) {
  const byDedupeKey = new Map();
  const byFilename = new Map();

  getTrustedRemoteFiles(remoteFiles).forEach(file => {
    const dedupeKey = typeof file.dedupe_key === 'string' ? file.dedupe_key.trim() : '';
    if (dedupeKey) byDedupeKey.set(dedupeKey, preferNewestRecord(byDedupeKey.get(dedupeKey), file));

    const filename = normalizeRemoteFilename(file.normalized_filename || file.filename);
    if (filename) byFilename.set(filename, preferNewestRecord(byFilename.get(filename), file));
  });

  const historyNames = [];
  const updatedItems = items.map(item => {
    const itemDedupeKey = item?.remoteDedupeKey || item?.dedupeKey;
    const matchingRecord = itemDedupeKey
      ? byDedupeKey.get(itemDedupeKey)
      : byFilename.get(normalizeRemoteFilename(item?.name));

    if (!matchingRecord) return item;

    const latestDownloadCount = toNumber(matchingRecord.latest_download_count);
    historyNames.push(item.name);
    return {
      ...item,
      status: 'done',
      remoteDedupeKey: matchingRecord.dedupe_key || null,
      remoteDownloadedAt: matchingRecord.downloaded_at || null,
      remoteSourceUrl: matchingRecord.source_url || null,
      downloadCount: latestDownloadCount ?? item.downloadCount ?? 0
    };
  });

  return {
    items: updatedItems,
    historyNames: [...new Set(historyNames)],
    matchedCount: historyNames.length
  };
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export async function hmacSha256Hex(secret, value) {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    bytes.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, bytes.encode(value)));
}
