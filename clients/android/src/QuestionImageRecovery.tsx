import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scan } from './types';
import type { QuestionImages } from './question-images';

type Progress = { phase: 'idle' | 'running' | 'stopping' | 'stopped' | 'done'; total: number; checked: number; ready: number; failures: { name: string; message: string }[] };
const initial: Progress = { phase: 'idle', total: 0, checked: 0, ready: 0, failures: [] };

/** User-triggered recovery only; one original page is shared by all its questions. */
export function QuestionImageRecovery({ studentId, records, images }: {
  studentId: string; records: Scan[]; images: QuestionImages;
}) {
  const scans = useMemo(() => [...new Map(records.filter(scan => scan.studentId === studentId &&
    scan.questions.some(q => q.wrongBook && q.regions.length)).map(scan => [scan.id, scan])).values()], [records, studentId]);
  const controller = useRef<AbortController | null>(null), live = useRef(true);
  const [progress, setProgress] = useState(initial);
  const [failureCount, setFailureCount] = useState(0);
  useEffect(() => images.watchFailures(setFailureCount), [images]);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; controller.current?.abort(); };
  }, []);
  const busy = progress.phase === 'running' || progress.phase === 'stopping';
  async function recover() {
    if (controller.current || !scans.length) return;
    const abort = new AbortController(); controller.current = abort;
    let next: Progress = { ...initial, phase: 'running', total: scans.length, failures: [] };
    setProgress(next);
    try {
      for (const scan of scans) {
        if (abort.signal.aborted) break;
        try {
          await images.recover(scan, abort.signal);
          abort.signal.throwIfAborted();
          next = { ...next, checked: next.checked + 1, ready: next.ready + 1 };
        } catch (error) {
          if (abort.signal.aborted) break;
          next = { ...next, checked: next.checked + 1, failures: [...next.failures, {
            name: scan.originalName || '原文件名未记录', message: error instanceof Error ? error.message : '恢复失败，请重试',
          }] };
        }
        if (live.current) setProgress(next);
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (live.current) setProgress({ ...next, phase: abort.signal.aborted ? 'stopped' : 'done' });
      }
    }
  }
  if (!scans.length || (!failureCount && progress.phase === 'idle')) return null;
  return <section className="question-image-recovery" aria-label="本机题图恢复">
    <div><strong>{failureCount ? `${failureCount} 张题图未恢复` : '本机题图恢复'}</strong><button type="button" disabled={busy} onClick={() => void recover()}>
      {busy ? '正在检查与恢复…' : progress.phase === 'idle' ? '重试恢复全部题图' : '重新检查与恢复'}</button></div>
    <p>自动恢复未完成时可在这里重试。当前学生共 {scans.length} 张来源照片；本机已有的直接读取，不重复下载。</p>
    {progress.phase !== 'idle' && <output aria-live="polite">{progress.phase === 'stopping' ? '正在停止' : progress.phase === 'stopped' ? '已停止' : progress.phase === 'done' ? '检查完成' : '处理中'}：已检查 {progress.checked}/{progress.total} 张，可用 {progress.ready} 张{progress.failures.length > 0 ? `，未完成 ${progress.failures.length} 张` : ''}</output>}
    {busy && <button type="button" disabled={progress.phase === 'stopping'} onClick={() => { controller.current?.abort(); setProgress(p => ({ ...p, phase: 'stopping' })); }}>停止恢复</button>}
    {progress.failures.length > 0 && <details><summary>查看未完成原因</summary><ul>{progress.failures.map((failure, i) => <li key={i}>{failure.name}：{failure.message}</li>)}</ul></details>}
  </section>;
}
