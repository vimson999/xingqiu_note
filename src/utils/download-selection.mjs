export function parseUploadTimeValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(/\//g, '-');
  const withYear = /^\d{2}-\d{2}/.test(normalized)
    ? `${new Date().getFullYear()}-${normalized}`
    : normalized;
  const time = Date.parse(withYear.replace(' ', 'T'));
  return Number.isFinite(time) ? time : null;
}

export function isWithinUploadRange(item, startMs, endMs) {
  const hasStart = Number.isFinite(startMs);
  const hasEnd = Number.isFinite(endMs);
  if (!hasStart && !hasEnd) return true;
  const time = parseUploadTimeValue(item.uploadTime);
  return time !== null && (!hasStart || time >= startMs) && (!hasEnd || time <= endMs);
}

export function compareDownloadItems(left, right, sort = 'time_desc') {
  if (sort === 'count_desc') return (right.downloadCount || 0) - (left.downloadCount || 0);
  const leftTime = parseUploadTimeValue(left.uploadTime);
  const rightTime = parseUploadTimeValue(right.uploadTime);
  if (leftTime === null) return rightTime === null ? 0 : 1;
  if (rightTime === null) return -1;
  return sort === 'time_asc' ? leftTime - rightTime : rightTime - leftTime;
}

export function selectBatchTasks(items, {
  statuses = ['pending'], downloadedNames = [], filterNames, minCount = 0,
  uploadStartMs = null, uploadEndMs = null, sort = 'time_desc', limit = 0
} = {}) {
  const downloaded = new Set(downloadedNames);
  // An omitted selection is unrestricted; an explicit empty selection is not.
  const selected = filterNames === undefined ? null : new Set(Array.isArray(filterNames) ? filterNames : []);
  const tasks = items.filter(item => (
    statuses.includes(item.status)
    && !downloaded.has(item.name)
    && (!selected || selected.has(item.name))
    && (minCount <= 0 || (item.downloadCount || 0) >= minCount)
    && isWithinUploadRange(item, uploadStartMs, uploadEndMs)
  ));
  tasks.sort((left, right) => compareDownloadItems(left, right, sort));
  return limit > 0 ? tasks.slice(0, limit) : tasks;
}
