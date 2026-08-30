import { normalizeDownloadFilename } from './download-match.mjs';

const AUDIO_EXTENSION_PATTERN = /\.(?:mp3|m4a|wav)$/i;

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

function normalizeAudioItem(rawItem) {
  const file = rawItem?.file;
  const name = String(file?.name || '').trim();
  if (!name || !AUDIO_EXTENSION_PATTERN.test(name)) return null;

  return {
    fileId: toOptionalString(file.file_id),
    name,
    uploadTime: formatImportedUploadTime(file.create_time),
    downloadCount: toNonNegativeNumber(file.download_count),
    fileHash: toOptionalString(file.hash),
    fileSize: toNonNegativeNumber(file.size),
    duration: toNonNegativeNumber(file.duration),
    // topic_id may exceed JavaScript's safe integer range; topic_uid preserves its exact value.
    topicId: toOptionalString(rawItem.topic_uid || rawItem.topic_id),
    topicUid: toOptionalString(rawItem.topic_uid),
    groupId: toOptionalString(rawItem.group?.group_id),
    groupName: toOptionalString(rawItem.group?.name),
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

export function parseAudioSearchResponse(rawResponse) {
  let response;
  try {
    response = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
  } catch {
    throw new Error('AUDIO_IMPORT_JSON_INVALID');
  }

  if (!response || response.succeeded !== true) {
    throw new Error('AUDIO_IMPORT_RESPONSE_NOT_SUCCEEDED');
  }
  if (!Array.isArray(response.resp_data?.files)) {
    throw new Error('AUDIO_IMPORT_FILES_MISSING');
  }

  const sourceFiles = response.resp_data.files;
  const items = sourceFiles.map(normalizeAudioItem).filter(Boolean);
  return {
    items,
    nextIndex: Number.isFinite(Number(response.resp_data.index))
      ? Number(response.resp_data.index)
      : null,
    sourceCount: sourceFiles.length,
    skippedCount: sourceFiles.length - items.length
  };
}

export function mergeImportedAudioItems(existingItems = [], importedItems = [], downloadedAudioHistory = []) {
  const items = existingItems.map(item => ({ ...item }));
  const downloadedNames = new Set(
    downloadedAudioHistory
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
