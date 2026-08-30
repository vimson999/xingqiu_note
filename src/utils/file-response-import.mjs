import { normalizeDownloadFilename } from './download-match.mjs';

const PDF_EXTENSION_PATTERN = /\.pdf$/i;

function toOptionalString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function toNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatImportedUploadTime(value) {
  const text = String(value || '').trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (matched) return `${matched[1]} ${matched[2]}`;
  return text || '未知';
}

function normalizeFileItem(topic, file) {
  const name = String(file?.name || '').trim();
  if (!name || !PDF_EXTENSION_PATTERN.test(name)) return null;

  const topicUid = toOptionalString(topic?.topic_uid);
  return {
    fileId: toOptionalString(file.file_id),
    name,
    uploadTime: formatImportedUploadTime(file.create_time || topic?.create_time),
    downloadCount: toNonNegativeNumber(file.download_count),
    fileHash: toOptionalString(file.hash),
    fileSize: toNonNegativeNumber(file.size),
    duration: toNonNegativeNumber(file.duration),
    // topic_id may exceed JavaScript's safe integer range; topic_uid preserves its exact value.
    topicId: topicUid || toOptionalString(topic?.topic_id),
    topicUid,
    groupId: toOptionalString(topic?.group?.group_id),
    groupName: toOptionalString(topic?.group?.name),
    source: 'api-import'
  };
}

function getItemIndexForImport(items, importedItem) {
  if (importedItem.fileId) {
    const byFileId = items.findIndex(item => toOptionalString(item.fileId) === importedItem.fileId);
    if (byFileId !== -1) return byFileId;
  }

  const importedName = normalizeDownloadFilename(importedItem.name);
  if (!importedName) return -1;

  return items.findIndex((item) => {
    // Name matching only bridges entries collected before an API import assigned a file ID.
    if (importedItem.fileId && toOptionalString(item.fileId)) return false;
    return normalizeDownloadFilename(item.name) === importedName;
  });
}

export function parseFileSearchResponse(rawResponse) {
  let response;
  try {
    response = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
  } catch {
    throw new Error('FILE_IMPORT_JSON_INVALID');
  }

  if (!response || response.succeeded !== true) {
    throw new Error('FILE_IMPORT_RESPONSE_NOT_SUCCEEDED');
  }
  if (!Array.isArray(response.resp_data?.topics)) {
    throw new Error('FILE_IMPORT_TOPICS_MISSING');
  }

  const topics = response.resp_data.topics;
  const sourceFiles = topics.flatMap(topic => (
    Array.isArray(topic?.talk?.files) ? topic.talk.files.map(file => ({ topic, file })) : []
  ));
  const items = sourceFiles
    .map(({ topic, file }) => normalizeFileItem(topic, file))
    .filter(Boolean);

  return {
    items,
    sourceTopicCount: topics.length,
    sourceFileCount: sourceFiles.length,
    skippedCount: sourceFiles.length - items.length
  };
}

export function mergeImportedFileItems(existingItems = [], importedItems = [], downloadedHistory = []) {
  const items = existingItems.map(item => ({ ...item }));
  const downloadedNames = new Set(
    downloadedHistory
      .map(name => normalizeDownloadFilename(name))
      .filter(Boolean)
  );
  let addedCount = 0;
  let updatedCount = 0;

  for (const importedItem of importedItems) {
    const existingIndex = getItemIndexForImport(items, importedItem);
    if (existingIndex === -1) {
      const isDownloaded = downloadedNames.has(normalizeDownloadFilename(importedItem.name));
      items.push({
        ...importedItem,
        status: isDownloaded ? 'done' : 'pending'
      });
      addedCount++;
      continue;
    }

    const existingItem = items[existingIndex];
    items[existingIndex] = {
      ...existingItem,
      ...importedItem,
      status: existingItem.status || 'pending'
    };
    updatedCount++;
  }

  return { items, addedCount, updatedCount };
}
