import { useEffect, useRef, useState } from 'react';
import type { NameCheck, NameChoice } from './types';

export function NameConflictDialog({ check, onChoose, onCancel }: { check: NameCheck; onChoose: (choice: NameChoice) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const extension = /\.(?:jpe?g|png|webp)$/i.exec(check.name)?.[0] || '';
  const [editing, setEditing] = useState(false), [stem, setStem] = useState(extension ? check.name.slice(0, -extension.length) : check.name);
  const name = stem.trim() + extension;
  const valid = !!stem.trim() && name.length <= 255 && !/[\\/]/.test(name) && !Array.from(name).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="cloud-name-dialog" aria-labelledby="cloud-name-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h3 id="cloud-name-title">发现同名图片</h3>
    <p className="cloud-name-file">{check.name}</p>
    <p className="cloud-hint">{check.conflicts > 1 ? `当前学生的云盘中有 ${check.conflicts} 张同名图片。` : '当前学生的云盘中已有这个名称的图片。'}</p>
    {editing ? <form onSubmit={event => { event.preventDefault(); if (valid) onChoose({ action: 'rename', name }); }}>
      <label htmlFor="cloud-edited-name">新文件名</label><div className="cloud-name-input"><input id="cloud-edited-name" autoFocus value={stem} maxLength={255 - extension.length} onChange={event => setStem(event.target.value)} /><span>{extension}</span></div>
      {!valid && <p role="alert" className="cloud-hint">名称不能为空，也不能包含斜杠。</p>}
      <div className="cloud-actions"><button type="submit" className="cloud-primary" disabled={!valid}>确认名称</button><button type="button" onClick={() => setEditing(false)}>返回选择</button></div>
    </form> : <div className="cloud-name-options">
      <button type="button" onClick={() => onChoose({ action: 'replace' })}>覆盖{check.conflicts > 1 ? `这 ${check.conflicts} 张同名图片` : ''}</button>
      <button type="button" onClick={() => onChoose({ action: 'rename', name: check.suggestedName })}>自动加后缀<span>{check.suggestedName}</span></button>
      <button type="button" onClick={() => setEditing(true)}>自己编辑名称</button>
    </div>}
    <button type="button" className="cloud-name-cancel" onClick={onCancel}>暂停上传</button>
  </dialog>;
}
