import { useState } from 'react';
import { RegionEditor } from './RegionEditor';
import { candidateLimit, mergeCandidates, overlapsExisting } from './candidates';
import { emptyQuestion } from './regions';
import { subjects, type Question, type Region, type Subject } from './types';
import './candidates.css';

type Props = {
  image: string;
  suggestions: Question[];
  existing: Question[];
  defaultSubject?: Subject;
  onAdopt: (questions: Question[], subject: Subject) => boolean;
  onCancel: () => void;
};
export function CandidatePicker({ image, suggestions, existing, defaultSubject, onAdopt, onCancel }: Props) {
  const [items, setItems] = useState(suggestions);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [subject, setSubject] = useState<Subject | ''>(defaultSubject || '');
  const [history, setHistory] = useState<Array<{ items: Question[]; selected: string[]; active: string }>>([]);
  const current = items.find((q) => q.id === active);
  const chosen = items.filter((q) => selected.includes(q.id));
  function remember() { setHistory((steps) => [...steps.slice(-19), { items, selected, active }]); }
  function focus(id: string) {
    if (!items.some((q) => q.id === id)) return;
    setActive(id);
    setSelected((ids) => ids.includes(id) ? ids : [...ids, id]);
  }
  function add(region: Region) {
    if (items.length >= candidateLimit) return;
    remember();
    const q = { ...emptyQuestion(`建议 ${items.length + 1}`), regions: [region] };
    setItems([...items, q]); setActive(q.id); setSelected([...selected, q.id]);
  }
  function split(axis: 'horizontal' | 'vertical') {
    if (!current || items.length >= candidateLimit) return;
    const r = current.regions[0];
    const half = axis === 'horizontal' ? r.height / 2 : r.width / 2;
    if (half < 0.006) return;
    remember();
    const regions = axis === 'horizontal'
      ? [{ ...r, height: half }, { ...r, y: r.y + half, height: half }]
      : [{ ...r, width: half }, { ...r, x: r.x + half, width: half }];
    const pieces = regions.map((region, i) => ({ ...emptyQuestion(`${current.number}·${i + 1}`),
      regions: [{ ...region, id: crypto.randomUUID() }] }));
    setItems(items.flatMap((q) => q.id === current.id ? pieces : [q]));
    setSelected([...selected.filter((id) => id !== current.id), ...pieces.map((q) => q.id)]);
    setActive(pieces[0].id);
  }
  return <section className="candidate-picker" aria-label="核对建议题框">
    <div className="candidate-heading"><strong>还有 {items.length} 个建议题框，请核对</strong>
      <button onClick={onCancel}>{items.length ? '放弃本轮剩余建议' : '返回题目校对'}</button></div>
    <p className="hint">虚线框是建议，可能漏掉配图或作答。点选需要的题框，再调整、拆分或合并。原有题框保留。</p>
    <RegionEditor image={image} questions={[...existing, ...items]} selectedId={active}
      activeRegion={current?.regions[0]?.id || ''} candidateIds={items.map((q) => q.id)}
      readOnlyIds={existing.map((q) => q.id)} showExtraRegions={false} allowCreate={items.length < candidateLimit}
      onSelect={focus} onToggleCandidate={(id) => {
        setActive(id); setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
      }}
      onChange={(id, region) => { remember(); setItems(items.map((q) => q.id === id ? { ...q, regions: [region] } : q)); }}
      onAdd={add} onCreate={add}>
      <div className="candidate-options">
        <div className="candidate-heading"><strong>选择要采用的题框</strong>
          <button disabled={!selected.length} onClick={() => setSelected([])}>取消全选</button></div>
        {items.length === 0 && <p className="hint">建议框已移除，可手动补框或返回。</p>}
        <div className="candidate-list">{items.map((q) => <label key={q.id}>
          <input type="checkbox" checked={selected.includes(q.id)} onChange={(e) => {
            setSelected(e.target.checked ? [...selected, q.id] : selected.filter((id) => id !== q.id));
            if (e.target.checked) setActive(q.id);
          }} />{q.number}{overlapsExisting(q, existing) && <span>与已有框重叠，请核对</span>}
        </label>)}</div>
        {current && <p className="hint">当前活动框：{current.number}。调整与拆分操作作用于这个框。</p>}
        <div className="button-row candidate-tools">
          <button disabled={!selected.length} onClick={() => {
            remember();
            setItems(items.filter((q) => !selected.includes(q.id))); setSelected([]); setActive('');
          }}>移除所选建议</button>
          <button disabled={chosen.length < 2} onClick={() => {
            remember();
            const next = mergeCandidates(items, selected), merged = next.find((q) => !items.some((old) => old.id === q.id));
            setItems(next); setSelected(merged ? [merged.id] : []); setActive(merged?.id || '');
          }}>合并所选建议</button>
          <button disabled={!current || items.length >= candidateLimit} onClick={() => split('horizontal')}>当前框上下拆分</button>
          <button disabled={!current || items.length >= candidateLimit} onClick={() => split('vertical')}>当前框左右拆分</button>
          <button disabled={!history.length} onClick={() => {
            const last = history[history.length - 1];
            setItems(last.items); setSelected(last.selected); setActive(last.active); setHistory(history.slice(0, -1));
          }}>撤销上次调整</button>
        </div>
        <label className="candidate-subject">所选新题的科目（之后可逐题修改）
          <select value={subject} onChange={(e) => setSubject(e.target.value as Subject | '')}>
            <option value="">请选择科目</option>{subjects.map((s) => <option key={s}>{s}</option>)}
          </select></label>
        <p className="hint">采用后先加入待保存题目；保存错题或请求分析仍由你操作。</p>
        {existing.length + chosen.length > 100 && <p className="hint">这张照片最多保存 100 道题，请减少所选题框。</p>}
        <button className="primary" disabled={!chosen.length || !subject || existing.length + chosen.length > 100}
          onClick={() => {
            if (subject && onAdopt(chosen, subject)) {
              setItems(items.filter((q) => !selected.includes(q.id))); setSelected([]); setActive(''); setHistory([]);
            }
          }}>采用所选 {chosen.length} 个题框</button>
      </div>
    </RegionEditor>
  </section>;
}
