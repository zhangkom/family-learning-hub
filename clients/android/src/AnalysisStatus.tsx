import { useEffect, useState } from 'react';
import type { AnalysisProgress } from './types';
import { analysisStatus } from './analysis-status';

export function AnalysisStatus({ progress }: { progress: AnalysisProgress }) {
  const [clock, setClock] = useState(progress.serverTime);
  useEffect(() => {
    const received = Date.now();
    setClock(progress.serverTime);
    const timer = setInterval(() => setClock(progress.serverTime + Date.now() - received), 1000);
    return () => clearInterval(timer);
  }, [progress.serverTime]);
  const text = analysisStatus(progress, clock);
  return <div className="analysis-progress"><output>{text.label}</output><small>提交至今 {text.elapsed} · 可以返回，稍后查看结果</small></div>;
}
