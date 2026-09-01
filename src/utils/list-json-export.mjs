const KNOWN_STATUSES = new Set(['done', 'pending', 'failed', 'processing']);

function toOptionalString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNullableNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return toNonNegativeNumber(value, null);
}

function getExportStatus(item, downloadedNames) {
  if (downloadedNames.has(String(item?.name || ''))) return 'done';
  const status = String(item?.status || 'pending');
  return KNOWN_STATUSES.has(status) ? status : 'pending';
}

export function buildListJsonExport({ kind, items = [], downloadedNames = [], exportedAt = new Date().toISOString() } = {}) {
  const historyNames = new Set(downloadedNames.map(name => String(name)));
  const normalizedItems = items.map((item) => ({
    name: String(item?.name || ''),
    uploadTime: String(item?.uploadTime || ''),
    downloadCount: toNonNegativeNumber(item?.downloadCount),
    status: getExportStatus(item, historyNames),
    fileId: toOptionalString(item?.fileId),
    topicId: toOptionalString(item?.topicId),
    groupName: toOptionalString(item?.groupName),
    fileSize: toNullableNonNegativeNumber(item?.fileSize),
    duration: toNullableNonNegativeNumber(item?.duration)
  }));
  const summary = {
    total: normalizedItems.length,
    downloaded: 0,
    pending: 0,
    failed: 0,
    processing: 0,
    totalDownloadCount: 0
  };

  for (const item of normalizedItems) {
    summary.totalDownloadCount += item.downloadCount;
    if (item.status === 'done') summary.downloaded++;
    else if (item.status === 'failed') summary.failed++;
    else if (item.status === 'processing') summary.processing++;
    else summary.pending++;
  }

  return {
    schema: 'zsxq-list-export/v1',
    kind: String(kind || ''),
    exportedAt: String(exportedAt),
    summary,
    items: normalizedItems
  };
}
