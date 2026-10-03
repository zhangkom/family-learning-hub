import { Camera, ChevronRight, Images } from 'lucide-react';
import { isHostedWeb } from './hosted-web';

export function CaptureEntries({ disabled = false, onRecord, onBatch }: { disabled?: boolean; onRecord: () => void; onBatch: () => void }) {
  return <section className="capture-entry-grid" aria-label="错题录入主入口">
    <button className="capture-entry capture-entry-record" disabled={disabled} onClick={onRecord} aria-label="录错题">
      <span className="capture-entry-icon"><Camera size={32} /><ChevronRight size={19} /></span>
      <strong>录错题</strong><small>{isHostedWeb ? '选图框题 · 保留原题' : '拍照框题 · 留下原题'}</small>
    </button>
    <button className="capture-entry capture-entry-batch" disabled={disabled} onClick={onBatch} aria-label="批量错题上传">
      <span className="capture-entry-icon"><Images size={32} /><ChevronRight size={19} /></span>
      <strong>批量错题<span>上传</span></strong><small>{isHostedWeb ? '多选图片 · 集中整理' : '相册多选 · 集中整理'}</small>
    </button>
  </section>;
}
