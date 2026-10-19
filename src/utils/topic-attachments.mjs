export function topicAttachments(data) {
  if (Array.isArray(data?.files)) return data.files.map(item => ({
    file: item.file, topic: item.topic || item,
    audioSource: item.topic?.content_voice?.file_id === item.file?.file_id ? 'content_voice' : 'attachment'
  }));
  return (data?.topics || []).flatMap(topic => [
    ...(Array.isArray(topic?.talk?.files) ? topic.talk.files : []).map(file => ({ topic, file, audioSource: 'attachment' })),
    ...(topic?.content_voice ? [{ topic, file: topic.content_voice, audioSource: 'content_voice' }] : [])
  ]);
}
