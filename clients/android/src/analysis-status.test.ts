import { describe, expect, it } from 'vitest';
import { analysisStatus } from './analysis-status';
import type { AnalysisProgress } from './types';

const progress: AnalysisProgress = { phase: 'queued', attempts: 0, maxAttempts: 3, queuedAt: 1000, serverTime: 61000 };
describe('analysis waiting state', () => {
  it('uses server timing, distinguishes waiting and retry, and never invents an ETA', () => {
    expect(analysisStatus(progress)).toEqual({ label: '已加入队列，等待分析', elapsed: '1 分 0 秒' });
    expect(analysisStatus({ ...progress, phase: 'processing', attempts: 2 }).label).toContain('第 2 / 3 次');
    expect(analysisStatus({ ...progress, phase: 'retry_wait', attempts: 1, retryAt: 65000 }).label).toBe('上次未完成，4 秒后重试');
    expect(analysisStatus({ ...progress, phase: 'retry_wait', retryAt: 65000 }, 66000).label).toBe('等待重试');
    expect(analysisStatus({ ...progress, phase: 'paused' }).label).toContain('已暂停');
    expect(analysisStatus({ ...progress, phase: 'recovering' }).label).toContain('等待恢复');
    expect(analysisStatus(progress, 0).elapsed).toBe('0 秒');
  });
});
