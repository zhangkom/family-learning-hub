import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Eye, EyeOff, X } from 'lucide-react';

export type AccountChange = 'username' | 'password';
export function AccountSettings({ kind, username, onClose, onSave }: {
  kind: AccountChange; username: string; onClose: () => void;
  onSave: (kind: AccountChange, value: string, currentPassword: string) => Promise<string>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(kind === 'username' ? username : ''), [currentPassword, setCurrentPassword] = useState('');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const title = kind === 'username' ? '修改用户名' : '修改密码';
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => { if (!busy) onClose(); });
    return () => { void listener.then((handle) => handle.remove()); };
  }, [busy, onClose]);
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="account-change-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="section-line"><h2 id="account-change-title">{title}</h2><button type="button" aria-label="关闭账号设置" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {done ? <><output>{done}</output><button type="button" className="primary full" onClick={onClose}>完成</button></> :
      <form onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError('');
        try {
          const warning = await onSave(kind, kind === 'username' ? value.trim() : value, currentPassword);
          setValue(''); setCurrentPassword(''); setVisible(false);
          setDone(warning || `${kind === 'username' ? '用户名' : '密码'}已修改，其他设备需重新登录。`);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '保存未完成，请稍后重试。'); }
        finally { setBusy(false); }
      }}>
        <label>{kind === 'username' ? '新用户名' : '新密码'}<input aria-label={kind === 'username' ? '新用户名' : '新密码'}
          type={kind === 'password' && !visible ? 'password' : 'text'} autoComplete={kind === 'username' ? 'username' : 'new-password'}
          autoCapitalize="none" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} required disabled={busy}
          minLength={kind === 'username' ? 3 : 6} maxLength={kind === 'username' ? 32 : 128}
          pattern={kind === 'username' ? '[A-Za-z0-9_-]{3,32}' : undefined} /></label>
        <p className="hint">{kind === 'username' ? '3–32 位字母、数字、下划线或短横线；用于登录。' : '6–128 位，支持数字或字母。'}</p>
        <label>当前密码<input aria-label="当前密码" type={visible ? 'text' : 'password'} autoComplete="current-password"
          value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required maxLength={128} disabled={busy} /></label>
        <button className="account-show-password" type="button" disabled={busy} aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}{visible ? '隐藏密码' : '显示密码'}</button>
        <p className="hint">学生和资料保持不变，保存后其他设备需重新登录。</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="button-row"><button className="primary" disabled={busy}>{busy ? '正在保存…' : '保存'}</button><button type="button" disabled={busy} onClick={onClose}>取消</button></div>
      </form>}
  </dialog>;
}
