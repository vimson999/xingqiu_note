export const LEGACY_GROUP_ID = '28888112822211';

export function pageGroupId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)zsxq\.com$/.test(url.hostname)) return null;
    const id = url.pathname.match(/^\/group\/(\d+)(?:\/|$)/)?.[1] || url.searchParams.get('groupId');
    return /^\d+$/.test(id || '') ? id : null;
  } catch { return null; }
}

export const itemGroupId = item => String(item?.groupId || LEGACY_GROUP_ID);
export const inGroup = (item, groupId) => itemGroupId(item) === String(groupId);
export const sameGroup = (left, right) => itemGroupId(left) === itemGroupId(right);
export const historyKey = item => itemGroupId(item) === LEGACY_GROUP_ID ? item.name : `group:${itemGroupId(item)}:${item.name}`;
export function wasDownloaded(history, item) {
  const has = value => history instanceof Set ? history.has(value) : history.includes(value);
  return has(historyKey(item)) || (itemGroupId(item) === LEGACY_GROUP_ID && has(item.name));
}
export function historyInGroup(key, groupId) {
  return key.startsWith('group:') ? key.startsWith(`group:${groupId}:`) : String(groupId) === LEGACY_GROUP_ID;
}
