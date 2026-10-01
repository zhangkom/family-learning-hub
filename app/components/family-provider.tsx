'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import {
  currentFamily,
  initializeFamily,
  pendingEvent,
  syncEvent,
  syncFamily,
  syncStatus,
} from '@/lib/family-client';

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [spaceKey, setSpaceKey] = useState('initial');
  const [message, setMessage] = useState('正在连接家庭学习空间…');
  useEffect(() => {
    let alive = true;
    const initialOwner = currentFamily()?.id;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (alive) setMessage(syncStatus());
    };
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncFamily(), 800);
    };
    const visibility = () => {
      if (!document.hidden) queue();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'family-learning:active') window.location.reload();
      else queue();
    };
    window.addEventListener(syncEvent, refresh);
    window.addEventListener(pendingEvent, queue);
    window.addEventListener('online', queue);
    window.addEventListener('focus', queue);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    const interval = setInterval(queue, 30000);
    void initializeFamily()
      .then(() => {
        if (alive) {
          if (initialOwner !== currentFamily()?.id)
            setSpaceKey(currentFamily()?.id || 'guest');
          setReady(true);
          refresh();
          queue();
        }
      })
      .catch(() => {
        if (alive) {
          setReady(true);
          setMessage('浏览器存储不可用，请检查权限');
        }
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(syncEvent, refresh);
      window.removeEventListener(pendingEvent, queue);
      window.removeEventListener('online', queue);
      window.removeEventListener('focus', queue);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return (
    <>
      <div className="no-print border-b bg-secondary/50 px-4 py-2 text-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <output>{message}</output>
          <Link
            href="/account"
            className="min-h-9 inline-flex items-center font-bold text-primary"
          >
            {ready && currentFamily() ? '家庭账号与备份' : '家庭登录 / 启用'}
          </Link>
        </div>
      </div>
      <Fragment key={spaceKey}>{children}</Fragment>
    </>
  );
}
