const PHASE_LABELS = {
  idle: '等待开始',
  running: '下载中',
  waiting: '等待下一项',
  completed: '下载完成',
  stopped: '已停止'
};

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createBatchProgress({ kind, label = '', total = 0 } = {}) {
  return {
    kind,
    label,
    total: toNonNegativeInteger(total),
    current: 0,
    success: 0,
    failed: 0,
    currentName: '',
    phase: 'idle',
    updatedAt: Date.now()
  };
}

export function updateBatchProgress(progress = {}, patch = {}) {
  const total = toNonNegativeInteger(patch.total ?? progress.total);
  const current = Math.min(toNonNegativeInteger(patch.current ?? progress.current), total);
  return {
    ...progress,
    ...patch,
    total,
    current,
    success: toNonNegativeInteger(patch.success ?? progress.success),
    failed: toNonNegativeInteger(patch.failed ?? progress.failed),
    currentName: String(patch.currentName ?? progress.currentName ?? ''),
    phase: PHASE_LABELS[patch.phase ?? progress.phase] ? (patch.phase ?? progress.phase) : 'idle',
    updatedAt: Date.now()
  };
}

export function formatBatchProgress(progress = {}) {
  const normalized = updateBatchProgress(progress);
  const phaseLabel = PHASE_LABELS[normalized.phase] || PHASE_LABELS.idle;
  const isFinished = normalized.phase === 'completed' || normalized.phase === 'stopped';
  return {
    summary: `${phaseLabel} ${normalized.current} / ${normalized.total} · 成功 ${normalized.success} · 失败 ${normalized.failed}`,
    currentName: isFinished ? '' : normalized.currentName
  };
}
