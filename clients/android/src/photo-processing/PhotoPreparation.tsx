/* eslint-disable jsx-a11y/prefer-tag-over-role -- SVG corner handles cannot be HTML buttons. */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { fullPage, pointerToImage, preparePhoto, previewUrl, type OriginalPhoto, type PreparedPhoto, type Quad } from './index';
import { validateQuad } from './geometry';
import { displayToSource, rotatedPreview, sourceCorner, sourceToDisplay, type QuarterTurns } from './preview-geometry';
import { buildPhotoDelivery, savePhotoDelivery, type PhotoDelivery } from './delivery';
import './photo-preparation.css';

export type PreparationServices = {
  prepare: typeof preparePhoto; preview: typeof previewUrl; deliver: typeof buildPhotoDelivery; save: typeof savePhotoDelivery;
};
const defaults: PreparationServices = { prepare: preparePhoto, preview: previewUrl, deliver: buildPhotoDelivery, save: savePhotoDelivery };
export type PhotoPreparationProps = {
  owner: string; studentId: string; studentLabel?: string; original: OriginalPhoto;
  onConfirm: (delivery: PhotoDelivery) => void | Promise<void>; onCancel: () => void;
  /** For an isolated browser fixture. Production callers should omit. */
  services?: PreparationServices;
};
const cornerNames = ['左上', '右上', '右下', '左下'];
const tips = {
  'low-light': '照片偏暗，请检查细字和符号是否清楚。',
  'low-contrast-or-blank': '画面反差较低，请确认题目完整、文字可读。',
  'uneven-light-or-colored-background': '光线不均或纸张有底色，可尝试轻微提亮并对比原片。',
  'possible-blur': '照片可能模糊；看不清的字建议重新拍摄。',
  'small-output': '选区较小，请检查公式、角标和小字。',
};

export function PhotoPreparation(props: PhotoPreparationProps) {
  if (!props.owner.trim() || !props.studentId.trim() || props.original.studentId !== props.studentId)
    return <section className="photo-prep" role="alert">照片所属学生已变化，请重新选择原片。</section>;
  // Remount before paint on every scope change: old previews and callbacks cannot cross accounts/students.
  return <PreparationSession key={JSON.stringify([props.owner, props.studentId, props.original.originalId, props.original.sha256])} {...props} />;
}

function PreparationSession({ owner, studentId, studentLabel, original, onConfirm, onCancel, services = defaults }: PhotoPreparationProps) {
  const [manual, setManual] = useState(false), [corners, setCorners] = useState<Quad>(fullPage), [corner, setCorner] = useState(0);
  const [turns, setTurns] = useState<QuarterTurns>(0), [light, setLight] = useState(false);
  const w = original.uprightWidth, h = original.uprightHeight, display = rotatedPreview(w, h, turns);
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null), [view, setView] = useState<'original' | 'prepared'>('original');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [seen, setSeen] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const stage = useRef<SVGSVGElement>(null), dragging = useRef<number | null>(null);
  const [scale, setScale] = useState(1);
  const lifecycle = useRef({ live: true, sequence: 0, abort: new AbortController() });
  const cancelRef = useRef<() => void>(() => {}); cancelRef.current = cancel;
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Cancel immediately inside the native event, before React's unmount can be deferred.
    const listener = NativeApp.addListener('backButton', () => cancelRef.current());
    return () => { void listener.then(handle => handle.remove()); };
  }, []);
  useLayoutEffect(() => {
    const life = lifecycle.current; life.live = true; life.abort = new AbortController();
    return () => { life.live = false; life.sequence++; life.abort.abort(); };
  }, []);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => { const r = element.getBoundingClientRect(); setScale(Math.max(.001, Math.min(r.width / display.width, r.height / display.height))); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [display.width, display.height, view]);
  function invalidate() { lifecycle.current.sequence++; setPrepared(null); setSeen(false); setHandedOff(false); setView('original'); setError(''); }
  function changeCorner(index: number, point: readonly [number, number]) {
    const next = [...corners]; next[index * 2] = point[0]; next[index * 2 + 1] = point[1];
    try { validateQuad(next); invalidate(); setCorners(next); }
    catch { setError('四角不能交叉或过于接近，请向题目边缘移动。'); }
  }
  function pointer(event: PointerEvent<SVGSVGElement>, index: number) {
    if (!manual || busy) return;
    const point = pointerToImage(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(),
      { width: display.width, height: display.height });
    if (point) changeCorner(index, displayToSource(point, turns));
  }
  async function process(enhancement: 'none' | 'light' = light ? 'light' : 'none') {
    const life = lifecycle.current, ticket = ++life.sequence;
    setBusy(true); setError(''); setPrepared(null); setSeen(false); setHandedOff(false); setView('original');
    try {
      const result = await services.prepare(owner, original, { corners: manual ? corners : fullPage, quarterTurns: turns, enhancement });
      if (!life.live || ticket !== life.sequence) return;
      if (result.studentId !== studentId || result.originalId !== original.originalId || result.sourceSha256 !== original.sha256)
        throw new Error('处理结果与当前学生的原片不匹配');
      setPrepared(result); setView('prepared');
    } catch (e) { if (life.live && ticket === life.sequence) setError(e instanceof Error ? e.message : '处理未完成，请重试。'); }
    finally { if (life.live && ticket === life.sequence) setBusy(false); }
  }
  async function confirm() {
    if (!prepared || !seen || busy || handedOff) return;
    const life = lifecycle.current, ticket = ++life.sequence;
    setBusy(true); setError('');
    try {
      const delivery = await services.deliver(owner, original, prepared, true, life.abort.signal);
      if (!life.live || ticket !== life.sequence) return;
      services.save(delivery);
      if (life.live && ticket === life.sequence) await onConfirm(delivery);
      if (life.live && ticket === life.sequence) setHandedOff(true);
    } catch (e) { if (life.live && ticket === life.sequence) setError(e instanceof Error ? e.message : '保存未完成；原片仍保留在本机。'); }
    finally { if (life.live && ticket === life.sequence) setBusy(false); }
  }
  function cancel() { const life = lifecycle.current; life.live = false; life.sequence++; life.abort.abort(); onCancel(); }
  return <section className="photo-prep" aria-labelledby="photo-prep-title">
    <header><div><p className="photo-prep-kicker">上传前整理</p><h2 id="photo-prep-title">把题目拍清楚</h2></div><span className="photo-prep-student">{studentLabel || '当前学生'}</span></header>
    <p className="photo-prep-intro">保留题干、选项、公式和作答痕迹。先看效果，再确认使用。</p>
    <div className="photo-prep-row photo-prep-tabs"><button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>查看原片</button>
      <button type="button" disabled={!prepared} aria-pressed={view === 'prepared'} onClick={() => setView('prepared')}>查看处理结果</button></div>
    <p className="photo-prep-hint photo-prep-preview-caption">{view === 'prepared' && prepared ? '处理图预览 · 请检查文字和边缘' :
      `原片预览 · ${turns ? `顺时针 ${turns * 90}°` : '原方向'}${prepared ? '' : ' · 生成处理图后可确认'}`}</p>
    <div className="photo-prep-stage">
      {view === 'prepared' && prepared ? <img key={prepared.outputId} src={services.preview(prepared)} alt="处理后的题目照片"
        onLoad={() => setSeen(true)} onError={() => { setSeen(false); setError('预览加载失败，请重新生成。'); }} /> :
        <svg ref={stage} viewBox={`0 0 ${display.width} ${display.height}`} preserveAspectRatio="xMidYMid meet" aria-label="原片四角调整区域"
          className={manual ? 'photo-prep-editable' : ''}
          onPointerDown={e => { if (!manual || busy) return; dragging.current = corner; e.currentTarget.setPointerCapture(e.pointerId); pointer(e, corner); }}
          onPointerMove={e => { if (dragging.current !== null) pointer(e, dragging.current); }}
          onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
          <g className="photo-prep-source" transform={display.transform}><image href={services.preview(original)} width={w} height={h} />
          {manual && <><polygon points={[0,1,2,3].map(i => `${corners[2*i]*w},${corners[2*i+1]*h}`).join(' ')} fill="rgba(27,113,97,.08)" stroke="#0a715e" strokeWidth={2/scale} />
            {[0,1,2,3].map(i => <g key={i} role="button" tabIndex={busy ? -1 : 0} aria-label={`移动${cornerNames[(i + turns) % 4]}角`} aria-disabled={busy}
              onPointerDown={e => { if (busy) return; e.stopPropagation(); setCorner(i); dragging.current = i; stage.current?.setPointerCapture(e.pointerId); }}
              onKeyDown={e => { if (busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault();
                const dx = e.key === 'ArrowLeft' ? -.005 : e.key === 'ArrowRight' ? .005 : 0;
                const dy = e.key === 'ArrowUp' ? -.005 : e.key === 'ArrowDown' ? .005 : 0;
                const point = sourceToDisplay([corners[i*2], corners[i*2+1]], turns);
                changeCorner(i, displayToSource([Math.max(0, Math.min(1, point[0]+dx)), Math.max(0, Math.min(1, point[1]+dy))], turns)); }}>
              <circle cx={corners[2*i]*w} cy={corners[2*i+1]*h} r={22/scale} fill="transparent" />
              <circle cx={corners[2*i]*w} cy={corners[2*i+1]*h} r={(i === corner ? 9 : 7)/scale} fill="white" stroke="#0a715e" strokeWidth={3/scale} />
            </g>)}</>}</g>
        </svg>}
    </div>
    <fieldset disabled={busy} className="photo-prep-tools"><legend>照片调整</legend>
      <div className="photo-prep-row photo-prep-toolstrip"><button type="button" aria-label="整张照片" aria-pressed={!manual} onClick={() => { invalidate(); setManual(false); }}><span>整张</span><span>照片</span></button>
        <button type="button" aria-label="调整四角" aria-pressed={manual} onClick={() => { invalidate(); setManual(true); }}><span>调整</span><span>四角</span></button>
        <button type="button" aria-label="顺时针转 90°" onClick={() => { invalidate(); setTurns(((turns + 1) % 4) as QuarterTurns); }}><span>旋转</span><span>90°</span></button>
        <button type="button" aria-label="提亮阴影" aria-pressed={light} onClick={() => { const next = !light; invalidate(); setLight(next); void process(next ? 'light' : 'none'); }}><span>提亮</span><span>阴影</span></button></div>
      <p className="photo-prep-hint">{busy ? '正在生成真实处理预览…' : light ? '提亮已开启；请对比细字和彩色批注。' : '提亮已关闭。'}原片文件始终保留。</p>
    </fieldset>
    <details className="photo-prep-detail" key={`${view}:${prepared?.outputId || 'original'}`}><summary>放大检查细节</summary><div>
      {view === 'prepared' && prepared ? <img src={services.preview(prepared)} alt="可滑动查看的放大照片" /> :
        <svg width={display.width} height={display.height} viewBox={`0 0 ${display.width} ${display.height}`} role="img" aria-label="可滑动查看的放大照片">
          <g transform={display.transform}><image href={services.preview(original)} width={w} height={h} /></g>
        </svg>}
    </div><p className="photo-prep-hint">在照片上滑动，检查文字、公式和四周边缘。</p></details>
    {manual && view === 'original' && <div className="photo-prep-corners"><p>选一个角，再在原片上点选或拖动；保留题目四周的空白。</p>
      <div className="photo-prep-row">{cornerNames.map((name, i) => <button key={name} type="button" disabled={busy} aria-pressed={corner === sourceCorner(i, turns)} onClick={() => setCorner(sourceCorner(i, turns))}>{name}</button>)}</div></div>}
    {prepared && <div className="photo-prep-quality" role="status"><p>请放大检查小字、根号、角标和批注，确认没有裁掉内容。</p>
      {prepared.quality.warnings.map(code => <p key={code}>{tips[code]}</p>)}</div>}
    {error && <p className="photo-prep-error" role="alert">{error}</p>}
    <div className="photo-prep-actions"><button className="photo-prep-primary" type="button" disabled={busy} onClick={() => void process()}>{busy ? '正在处理…' : prepared ? '重新生成预览' : '生成预览'}</button>
      <button className="photo-prep-primary" type="button" disabled={busy || !prepared || !seen || handedOff} onClick={() => void confirm()}>确认使用处理图</button>
      <button type="button" onClick={cancel}>取消，保留原片</button></div>
    <p className="photo-prep-footnote">原片保存在这台手机。确认后加入待上传，上传时只发送处理图；卸载应用或清除应用数据会删除本机照片。</p>
  </section>;
}
