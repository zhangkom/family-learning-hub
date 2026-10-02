import type { AnalysisProgress } from './types';

export function analysisStatus(progress: AnalysisProgress, now = progress.serverTime) {
  const elapsedSeconds = Math.max(0, Math.floor((now - progress.queuedAt) / 1000));
  const elapsed = elapsedSeconds < 60 ? `${elapsedSeconds} 秒` : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
  const retry = Math.max(0, Math.ceil(((progress.retryAt || now) - now) / 1000));
  const label = progress.phase === 'processing' ? `模型正在分析 · 第 ${progress.attempts} / ${progress.maxAttempts} 次尝试`
    : progress.phase === 'retry_wait' ? retry ? `上次未完成，${retry} 秒后重试` : '等待重试'
    : progress.phase === 'recovering' ? '上次分析中断，等待恢复'
    : progress.phase === 'paused' ? 'AI 服务已暂停，题目和任务仍保留'
    : progress.attempts ? '等待下一次尝试' : '已加入队列，等待分析';
  return { label, elapsed };
}
