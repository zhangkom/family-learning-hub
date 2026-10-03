import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { FamilyApi } from './api';
import type { WrongQuestion } from './wrong-book-order';
import type { WorksheetExportInput, WorksheetPreview } from '../../../lib/worksheet';
import { questionDifficultyStars } from '../../../lib/question-difficulty';
import { saveWorksheet, verifiedWorksheetPreview } from './worksheet-save';
import { useNativeBack } from './native-back';

const keyOf = (row: WrongQuestion) => `${row.scan.id}/${row.question.id}`;
export function WorksheetExport({ api, studentId, rows, onClose, onOpen }: { api: FamilyApi; studentId: string; rows: WrongQuestion[]; onClose: () => void; onOpen: (row: WrongQuestion) => void }) {
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), exportAbort = useRef<AbortController | undefined>(undefined);
  const [selected, setSelected] = useState(() => new Set(rows.map(keyOf))), [includeAnswers, setIncludeAnswers] = useState(false);
  const [preview, setPreview] = useState<{ key: string; value?: WorksheetPreview; error?: string }>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [exporting, setExporting] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true);
  const input: WorksheetExportInput = useMemo(() => ({ studentId, includeAnswers, selections: rows.filter(row => selected.has(keyOf(row))).map(row => ({ scanId: row.scan.id, questionId: row.question.id, revision: row.scan.revision })) }), [studentId, includeAnswers, rows, selected]);
  const requestKey = JSON.stringify(input), ready = preview?.key === requestKey ? preview : undefined;
  const items = new Map(ready?.value?.items.map(item => [`${item.scanId}/${item.questionId}`, item]));
  const allReady = !!ready?.value && ready.value.totalCount > 0 && ready.value.readyCount === ready.value.totalCount;
  function close() { exportAbort.current?.abort(); onClose(); }
  useNativeBack(close, 90);
  useEffect(() => {
    alive.current = true; const node = dialog.current; node?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { alive.current = false; exportAbort.current?.abort(); node?.close(); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); if (!input.selections.length) return;
    void api.worksheetPreview(input, abort.signal).then(value => { if (!abort.signal.aborted) setPreview({ key: requestKey, value: verifiedWorksheetPreview(input, value) }); }).catch(error => { if (!abort.signal.aborted) setPreview({ key: requestKey, error: error instanceof Error ? error.message : '打印检查失败，请重试' }); });
    return () => abort.abort();
  }, [api, input, requestKey, previewAttempt]);
  async function download() {
    if (!allReady || exporting || exportAbort.current) return;
    const abort = new AbortController(); exportAbort.current = abort; setExporting(true); setError(''); setNotice('');
    const timer = setTimeout(() => abort.abort(new DOMException('导出超时，请重新检查后重试', 'TimeoutError')), 180000);
    try { const result = await saveWorksheet(api, input, abort.signal); if (alive.current) setNotice(result === 'saved' ? 'Word 已保存到所选位置' : result === 'cancelled' ? '已取消保存，可以重新选择保存位置' : '已开始下载 Word，请在浏览器下载列表查看'); }
    catch (e) { if (alive.current) setError(abort.signal.aborted ? abort.signal.reason?.name === 'TimeoutError' ? '导出超时，请重试' : '已取消导出' : (e as Error).message); }
    finally { clearTimeout(timer); if (exportAbort.current === abort) exportAbort.current = undefined; if (alive.current) setExporting(false); }
  }
  return <dialog ref={dialog} className="worksheet-export-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
    <header><h2 id={titleId}>导出 Word 练习卷</h2><button type="button" aria-label="关闭 Word 导出" onClick={close}><X size={20} /></button></header>
    <div className="worksheet-export-body">
      <p className="hint">默认选中当前筛选的题目，顺序与列表一致。题目卷保留正式题干、公式、配图与答题空间。</p>
      <div className="worksheet-selection-tools"><strong>已选 {input.selections.length} / {rows.length} 道</strong><button type="button" disabled={exporting} onClick={() => setSelected(new Set(rows.map(keyOf)))}>全选</button><button type="button" disabled={exporting} onClick={() => setSelected(new Set())}>清空选择</button></div>
      <label className="confirm-check"><input type="checkbox" checked={includeAnswers} disabled={exporting} onChange={event => { setIncludeAnswers(event.target.checked); setNotice(''); }} />另附参考答案与解析</label>
      {input.selections.length > 0 && !ready && <output aria-live="polite">正在检查打印内容…</output>}
      {ready?.error && <output className="error" role="alert">{ready.error}</output>}
      {(ready?.error || error) && <button type="button" disabled={exporting} onClick={() => { setPreview(undefined); setError(''); setPreviewAttempt(value => value + 1); }}>重新检查打印内容</button>}
      {ready?.value && <p className="hint">{ready.value.readyCount} / {ready.value.totalCount} 道已可导出{!allReady && '，请处理待核对题目，或取消这些题的勾选'}。</p>}
      {ready?.value && ready.value.readyCount > 0 && !allReady && <button type="button" disabled={exporting} onClick={() => { const available = ready.value!.items.filter(item => item.ready); setSelected(new Set(available.map(item => `${item.scanId}/${item.questionId}`))); setError(''); setNotice(`已选择 ${available.length} 道可导出题目，其余题目已取消勾选`); }}>仅选可导出题目（{ready.value.readyCount} 道）</button>}
      <ul className="worksheet-question-list">{rows.map(row => {
        const key = keyOf(row), item = items.get(key);
        return <li key={key}><label aria-label={`选择第 ${row.question.number || '待核对'} 题`}><input aria-label={`选择第 ${row.question.number || '待核对'} 题`} type="checkbox" checked={selected.has(key)} disabled={exporting} onChange={event => { setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; }); setNotice(''); }} /><span><strong>{(row.question.sourcePage || row.scan.sourcePage)?.title || row.scan.source || '试卷名称待补充'}</strong><small>{row.question.subject || '待选科目'} · {row.question.number ? `第 ${row.question.number} 题` : '题号待核对'} · {questionDifficultyStars(row.question)} 星</small></span></label>
          {item && <p className={item.ready ? 'worksheet-ready' : 'worksheet-unready'}>{item.ready ? '可导出' : item.reasons.join('；')}</p>}
          {item && !item.ready && <button type="button" disabled={exporting} onClick={() => { close(); onOpen(row); }}>查看原题并核对</button>}
        </li>;
      })}</ul>
    </div>
    <footer>{error && <output role="alert">{error}</output>}{notice && <output aria-live="polite">{notice}</output>}<button className="primary" type="button" disabled={!allReady || exporting} onClick={() => void download()}><Download size={18} />{exporting ? '正在生成或保存…' : '保存 Word'}</button>{exporting && <button type="button" onClick={() => exportAbort.current?.abort()}>取消导出</button>}</footer>
  </dialog>;
}
