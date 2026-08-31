const AUDIO_SEARCH_ORIGIN = 'https://api.zsxq.com';
const AUDIO_SEARCH_PATH = '/v2/search/files';
const FILE_TOPIC_PATH = '/v2/hashtags/51184248544214/topics';

export function isAudioSearchRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const keyword = String(url.searchParams.get('keyword') || '').toLowerCase();
    return url.origin === AUDIO_SEARCH_ORIGIN
      && url.pathname === AUDIO_SEARCH_PATH
      && keyword.includes('mp3');
  } catch {
    return false;
  }
}

export function isFileTopicRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === AUDIO_SEARCH_ORIGIN && url.pathname === FILE_TOPIC_PATH;
  } catch {
    return false;
  }
}
