(function () {
  const PAGE_SOURCE = 'ZSXQ_DOUBAO_AUDIO_PAGE';
  const CONTENT_SOURCE = 'ZSXQ_DOUBAO_AUDIO_CONTENT';
  const SAMPLE_RATE = 24000;

  if (window.__doubaoAudioDownloaderInstalled) {
    emitStatus();
    return;
  }

  window.__doubaoAudioDownloaderInstalled = true;
  window.__doubaoAudioChunks = window.__doubaoAudioChunks || [];
  window.__doubaoAudioSampleRate = SAMPLE_RATE;

  function getTotalSamples() {
    return (window.__doubaoAudioChunks || []).reduce((sum, chunk) => sum + chunk.length, 0);
  }

  function getStatus() {
    const chunks = window.__doubaoAudioChunks || [];
    const samples = getTotalSamples();
    return {
      success: true,
      installed: true,
      chunks: chunks.length,
      samples,
      seconds: samples / SAMPLE_RATE,
      sampleRate: SAMPLE_RATE
    };
  }

  function emitStatus() {
    window.postMessage({ source: PAGE_SOURCE, type: 'STATUS', payload: getStatus() }, '*');
    updatePanel();
  }

  function clearDoubaoAudio() {
    window.__doubaoAudioChunks = [];
    emitStatus();
    console.log('已清空豆包音频缓存');
    return getStatus();
  }

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  function buildWavBlob(sampleRate = SAMPLE_RATE) {
    const chunks = window.__doubaoAudioChunks || [];
    if (!chunks.length) return null;

    const totalLength = getTotalSamples();
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let pos = 44;
    for (let i = 0; i < samples.length; i++, pos += 2) {
      let sample = samples[i];
      if (!Number.isFinite(sample)) sample = 0;
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  }

  function buildFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `doubao朗读_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_`
      + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.wav`;
  }

  function downloadDoubaoWav() {
    const blob = buildWavBlob(SAMPLE_RATE);
    if (!blob) {
      alert('还没有捕获到音频。请先点击豆包朗读，等播放完成后再下载。');
      return { success: false, error: 'NO_AUDIO', ...getStatus() };
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildFilename();
    link.click();
    URL.revokeObjectURL(url);

    const status = getStatus();
    console.log('已下载豆包朗读音频', status);
    return status;
  }

  function copyAudioData(data) {
    if (data instanceof Float32Array) {
      const copied = new Float32Array(data.length);
      copied.set(data);
      return copied;
    }
    if (Array.isArray(data)) {
      return new Float32Array(data);
    }
    if (data instanceof ArrayBuffer && data.byteLength % 4 === 0) {
      return new Float32Array(data.slice(0));
    }
    return null;
  }

  window.clearDoubaoAudio = clearDoubaoAudio;
  window.downloadDoubaoWav = downloadDoubaoWav;

  if (!window.__doubaoOriginalPostMessageForCapture) {
    window.__doubaoOriginalPostMessageForCapture = MessagePort.prototype.postMessage;
  }

  MessagePort.prototype.postMessage = function (data, transfer) {
    try {
      if (data && data.message === 'dataIn' && data.data) {
        const copied = copyAudioData(data.data);
        if (copied && copied.length > 0) {
          window.__doubaoAudioChunks.push(copied);
          updatePanel();
          window.postMessage({ source: PAGE_SOURCE, type: 'STATUS', payload: getStatus() }, '*');
        }
      }
    } catch (err) {
      console.warn('保存豆包音频失败:', err);
    }

    return window.__doubaoOriginalPostMessageForCapture.call(this, data, transfer);
  };

  function updatePanel() {
    const status = getStatus();
    const button = document.getElementById('__doubao_audio_download_btn');
    const meta = document.getElementById('__doubao_audio_meta');
    if (button) {
      button.textContent = status.chunks > 0 ? `下载 WAV (${status.chunks})` : '等待朗读音频';
    }
    if (meta) {
      meta.textContent = status.chunks > 0
        ? `${status.seconds.toFixed(1)}s / ${status.sampleRate}Hz`
        : '24000Hz WAV';
    }
  }

  function createFloatingPanel() {
    if (document.getElementById('__doubao_audio_panel')) return;

    const panel = document.createElement('div');
    panel.id = '__doubao_audio_panel';
    panel.style.position = 'fixed';
    panel.style.right = '20px';
    panel.style.bottom = '80px';
    panel.style.zIndex = '999999';
    panel.style.background = 'rgba(0, 0, 0, 0.78)';
    panel.style.color = '#fff';
    panel.style.padding = '10px';
    panel.style.borderRadius = '10px';
    panel.style.fontSize = '13px';
    panel.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
    panel.style.display = 'flex';
    panel.style.gap = '8px';
    panel.style.alignItems = 'center';
    panel.style.fontFamily = 'Arial, sans-serif';

    const meta = document.createElement('span');
    meta.id = '__doubao_audio_meta';
    meta.textContent = '24000Hz WAV';
    meta.style.whiteSpace = 'nowrap';

    const downloadBtn = document.createElement('button');
    downloadBtn.id = '__doubao_audio_download_btn';
    downloadBtn.textContent = '等待朗读音频';
    downloadBtn.style.cursor = 'pointer';
    downloadBtn.style.border = 'none';
    downloadBtn.style.borderRadius = '6px';
    downloadBtn.style.padding = '8px 10px';
    downloadBtn.style.background = '#1677ff';
    downloadBtn.style.color = '#fff';
    downloadBtn.style.fontSize = '13px';
    downloadBtn.onclick = downloadDoubaoWav;

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cursor = 'pointer';
    clearBtn.style.border = 'none';
    clearBtn.style.borderRadius = '6px';
    clearBtn.style.padding = '8px 10px';
    clearBtn.style.background = '#666';
    clearBtn.style.color = '#fff';
    clearBtn.style.fontSize = '13px';
    clearBtn.onclick = clearDoubaoAudio;

    panel.appendChild(meta);
    panel.appendChild(downloadBtn);
    panel.appendChild(clearBtn);
    document.body.appendChild(panel);
    updatePanel();
  }

  function waitBodyAndCreatePanel() {
    if (document.body) {
      createFloatingPanel();
    } else {
      setTimeout(waitBodyAndCreatePanel, 300);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== CONTENT_SOURCE || data.type !== 'COMMAND') return;

    let payload;
    if (data.command === 'GET_STATUS') payload = getStatus();
    else if (data.command === 'CLEAR') payload = clearDoubaoAudio();
    else if (data.command === 'DOWNLOAD') payload = downloadDoubaoWav();
    else payload = { success: false, error: 'UNKNOWN_COMMAND' };

    window.postMessage({ source: PAGE_SOURCE, type: 'RESPONSE', requestId: data.requestId, payload }, '*');
  });

  waitBodyAndCreatePanel();
  console.log('豆包音频下载器安装完成，采样率固定为 24000Hz');
})();
