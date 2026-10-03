'use client';

import { useEffect, useRef, useState } from 'react';
import { appPath } from '@/lib/deployment';

export function HostedLearning() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, unmount: (() => void) | undefined;
    const controller = new AbortController();
    void (async () => {
      const base = appPath('/web-client/');
      const response = await fetch(`${base}manifest.json`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('网页文件暂未加载完成');
      const manifest = await response.json() as Record<string, { file: string; css?: string[]; isEntry?: boolean }>;
      const entry = Object.values(manifest).find(item => item.isEntry);
      const safeAsset = (path: string) => /^assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path);
      if (!entry || !safeAsset(entry.file) || (entry.css || []).some(path => !safeAsset(path))) throw new Error('网页版本信息无效');
      await Promise.all((entry.css || []).map(path => new Promise<void>((resolve, reject) => {
        const href = new URL(base + path, location.origin).href;
        if ([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some(link => link.href === href && link.sheet)) { resolve(); return; }
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
        link.onload = () => resolve(); link.onerror = () => { link.remove(); reject(new Error('网页样式未能加载')); };
        document.head.appendChild(link);
      })));
      const client = await import(/* @vite-ignore */ base + entry.file) as { mountHostedApp: (node: HTMLElement) => () => void };
      if (!alive || !container.current) return;
      unmount = client.mountHostedApp(container.current); setReady(true);
    })().catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : '网页暂时无法打开'); });
    return () => { alive = false; controller.abort(); unmount?.(); };
  }, [attempt]);
  return <><div ref={container} />{!ready && <main style={{ maxWidth: 600, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
    <h1>知识棱镜AI</h1><p role={error ? 'alert' : 'status'}>{error || '正在打开学习空间…'}</p>
    {error && <button onClick={() => { setError(''); setAttempt(value => value + 1); }}>重新加载</button>}
    <noscript>请启用浏览器 JavaScript，以使用错题本、图片云盘和学习功能。</noscript>
  </main>}</>;
}
