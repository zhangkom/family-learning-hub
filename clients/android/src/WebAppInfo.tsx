import { useEffect, useState } from 'react';
import { appName } from './release';
import { hostedAppPath } from './hosted-web';

export function WebAppInfo({ admin = false }: { admin?: boolean }) {
  const [apk, setApk] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetch(hostedAppPath('/downloads/android/latest.json'), { cache: 'no-store', signal: abort.signal })
      .then(async response => {
        if (!response.ok) return;
        const value = await response.json();
        const url = new URL(value.downloadUrl, location.origin);
        if (url.origin === location.origin && url.pathname.startsWith(hostedAppPath('/downloads/android/')) && url.pathname.endsWith('.apk') && !url.search && !url.hash && !abort.signal.aborted) setApk(url.href);
      }).catch(() => {});
    return () => abort.abort();
  }, []);
  return <div className="family-links web-app-info"><span>{appName} · 网页版</span><div className="button-row">
    {admin && <a href={hostedAppPath('/admin')}>管理后台</a>}
    {apk && <a href={apk}>下载安卓应用</a>}
  </div></div>;
}
