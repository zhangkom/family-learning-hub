'use client';

import Link from 'next/link';
import { useEffect, useState, type SubmitEvent } from 'react';
import { appPath } from '@/lib/deployment';
import { children, parseBackup, type FamilyState } from '@/lib/family-state';
import {
  childLabel,
  currentFamily,
  familyRequest,
  importRecords,
  readLocal,
  setFamily,
  syncFamily,
  type FamilyUser,
} from '@/lib/family-client';
import { WorkbenchHeader } from '@/app/components/workbench-header';

const field = 'mt-1 min-h-11 w-full rounded-lg border bg-background px-3';
const button =
  'min-h-11 rounded-lg bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50';
export default function AccountPage() {
  const [user, setUser] = useState<FamilyUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<FamilyState | null>(null);
  const [passwordMode, setPasswordMode] = useState(false);
  useEffect(() => {
    void familyRequest('session')
      .then((s) => {
        setUser(s.user);
        setNeedsSetup(Boolean(s.needsSetup));
        setEnabled(Boolean(s.enabled));
      })
      .catch(() => {
        setUser(currentFamily());
        setMessage('暂时无法连接服务器，仍可导出本机记录。');
      });
  }, []);

  async function authenticate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await familyRequest(needsSetup ? 'setup' : 'login', {
        username: form.get('username'),
        password: form.get('password'),
        setupToken: form.get('setupToken'),
      });
      setFamily(data.user);
      window.location.assign(appPath('/account'));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await familyRequest('logout', {});
      setFamily(null);
      window.location.assign(appPath('/account'));
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }
  function exportData() {
    try {
      const data = {
        app: 'family-learning-hub',
        version: 1,
        exportedAt: new Date().toISOString(),
        records: readLocal(),
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `双宝学习备份-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已生成备份，请妥善保存下载的文件。');
    } catch (e) {
      setMessage(`导出失败：${(e as Error).message}`);
    }
  }
  async function selectFile(file?: File) {
    setPreview(null);
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('备份文件超过 8 MB');
      setPreview(parseBackup(JSON.parse(await file.text())));
      setMessage('请核对下面的记录数量，再确认合并。');
    } catch (e) {
      setMessage(`未导入：${(e as Error).message}`);
    }
  }
  async function changePassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await familyRequest('password', {
        currentPassword: form.get('currentPassword'),
        password: form.get('password'),
      });
      setPasswordMode(false);
      setMessage('密码已更新，其他设备需要重新登录。');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen">
      <WorkbenchHeader backHref="/" backLabel="家庭总览" />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <header>
          <p className="text-sm font-bold text-primary">家庭学习空间</p>
          <h1 className="mt-2 text-3xl font-bold">把学习记录带到每台设备</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            在电脑和手机上登录同一个家庭账号。大宝、小宝的错题和作答分别保存；离线练习会先留在本机，恢复连接后自动补传。
          </p>
        </header>
        {message && (
          <output className="block rounded-xl border bg-secondary/40 p-4 text-sm">
            {message}
          </output>
        )}
        {user ? (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="font-bold">已登录：{user.username}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link className={button} href="/xiaobao/study">
                小宝学习
              </Link>
              <Link className={button} href="/dabao/study">
                大宝学习
              </Link>
              <Link className={button} href="/family-review">
                家长复盘
              </Link>
              <Link className={button} href="/scans">
                扫描与整理
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <button
                onClick={() => {
                  void syncFamily();
                }}
                className="min-h-11 underline"
              >
                立即同步
              </button>
              <button
                className="min-h-11 underline"
                onClick={() => setPasswordMode(!passwordMode)}
              >
                修改密码
              </button>
              <button
                className="min-h-11 underline"
                disabled={busy}
                onClick={() => void logout()}
              >
                退出家庭账号
              </button>
            </div>
            {passwordMode && (
              <form onSubmit={changePassword} className="mt-3 space-y-3">
                <label className="block text-sm">
                  当前密码
                  <input
                    className={field}
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label className="block text-sm">
                  新密码（至少 12 位）
                  <input
                    className={field}
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <button disabled={busy} className={button}>
                  更新密码
                </button>
              </form>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-bold">
              {needsSetup ? '首次启用家庭账号' : '家庭登录'}
            </h2>
            {!enabled && (
              <p className="mt-2 text-sm text-muted-foreground">
                正在检查家庭服务。服务未启用时，可以继续本机练习和导出备份。
              </p>
            )}
            <form onSubmit={authenticate} className="mt-4 space-y-4">
              {needsSetup && (
                <label className="block text-sm">
                  家庭启用码
                  <input
                    className={field}
                    name="setupToken"
                    autoComplete="off"
                    required
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    启用码由网站维护者私下提供，只能创建一个家庭账号。
                  </span>
                </label>
              )}
              <label className="block text-sm">
                家庭账号
                <input
                  className={field}
                  name="username"
                  autoComplete="username"
                  pattern="[A-Za-z0-9_-]{3,32}"
                  minLength={3}
                  maxLength={32}
                  placeholder="例如 family2026"
                  required
                />
              </label>
              <label className="block text-sm">
                密码（至少 12 位）
                <input
                  className={field}
                  name="password"
                  type="password"
                  autoComplete={
                    needsSetup ? 'new-password' : 'current-password'
                  }
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <button className={button} disabled={busy || !enabled}>
                {busy ? '正在处理…' : needsSetup ? '创建家庭账号' : '登录'}
              </button>
            </form>
          </section>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-lg font-bold">备份与旧记录迁入</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            导入会合并记录，保留首次错误和后续作答。登录前的本机练习需要由你确认迁入；从另一台设备导出的备份也可在这里导入。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className={button} onClick={exportData}>
              导出学习备份
            </button>
            {user && (
              <button
                className="min-h-11 rounded-lg border px-4"
                onClick={() => {
                  try {
                    setPreview(readLocal(null));
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                查看本机登录前的旧记录
              </button>
            )}
          </div>
          <label className="mt-5 block text-sm font-bold">
            选择学习备份文件
            <input
              className="mt-2 block w-full text-sm"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void selectFile(e.target.files?.[0])}
            />
          </label>
          {preview && (
            <div className="mt-4 rounded-xl bg-muted p-4">
              <h3 className="font-bold">
                将合并到
                {user ? `家庭账号 ${user.username}` : '当前浏览器的未登录记录'}
              </h3>
              {children.map((child) => (
                <p key={child} className="mt-2 text-sm">
                  {childLabel(child)}：{preview[child].wrong.length} 道错题，
                  {preview[child].attempts.length} 次作答，
                  {preview[child].completed.length} 张已完成练习
                </p>
              ))}
              <div className="mt-4 flex gap-3">
                <button
                  className={button}
                  onClick={() => {
                    try {
                      importRecords(preview);
                      setPreview(null);
                      setMessage(
                        '已合并到本机。登录后会自动同步，请留意页顶状态。',
                      );
                      void syncFamily();
                    } catch (e) {
                      setMessage(`未完成导入：${(e as Error).message}`);
                    }
                  }}
                >
                  确认合并
                </button>
                <button
                  className="min-h-11 px-3"
                  onClick={() => setPreview(null)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
