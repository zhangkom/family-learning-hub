// Isolated browser fixture: synthetic images and bridge responses only. Never a native/photo-quality acceptance test.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoPreparation, type PreparationServices } from '../src/photo-processing/PhotoPreparation';
import { OriginalPhotoLibrary, type LibraryServices } from '../src/photo-processing/OriginalPhotoLibrary';
import { fullPage, type OriginalPhoto, type PreparedPhoto } from '../src/photo-processing';
import { savePhotoDelivery } from '../src/photo-processing/delivery';
const rotations = [[1,0,0,0,1,0,0,0,1], [0,-1,1,1,0,0,0,0,1], [-1,0,1,0,-1,1,0,0,1], [0,1,0,-1,0,1,0,0,1]] as const;
let delay = 0, confirmDelay = 0, failure = false, handoffFailure = false, holdPreview = false, ordinal = 2;
const log: { prepares: unknown[]; confirms: unknown[]; cancels: number; resumes: string[]; lists: unknown[] } = { prepares: [], confirms: [], cancels: 0, resumes: [], lists: [] };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function original(studentId: string): OriginalPhoto {
  return { schemaVersion: 1, originalId: '11111111-1111-1111-1111-111111111111', studentId, sha256: 'a'.repeat(64), bytes: 1024,
    mime: 'image/jpeg', width: 900, height: 1200, orientation: 1, uprightWidth: 900, uprightHeight: 1200,
    originalUri: 'file:///fixture/original', previewUri: 'file:///fixture/preview.jpg', createdAt: 1790863800000 };
}
function preview(photo: OriginalPhoto | PreparedPhoto) {
  const processed = 'outputId' in photo;
  if (processed && holdPreview) return `${location.origin}/photo-preview-held.svg?output=${photo.outputId}`;
  // Only simulates orientation; this fixture does not implement native perspective or PhotoLight.
  const turns = processed ? photo.quarterTurns : 0, width = turns % 2 ? 1200 : 900, height = turns % 2 ? 900 : 1200;
  const transform = ['matrix(1 0 0 1 0 0)', 'matrix(0 1 -1 0 1200 0)', 'matrix(-1 0 0 -1 900 1200)', 'matrix(0 -1 1 0 0 900)'][turns];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="${transform}"><rect width="900" height="1200" fill="${processed && photo.enhancement === 'light' ? '#fffdf1' : '#e6e4d8'}"/><text x="90" y="130" font-size="42" fill="#334c40">数学练习 · ${photo.studentId}</text><text x="90" y="230" font-size="30">1. 计算：x² + 2x + 1 = 0</text><text x="90" y="370" font-size="30">2. 若 a = 3，求 √(a² + 16)</text><path d="M95 430L350 430M95 500L630 500M95 570L630 570" stroke="#9caaa1" stroke-width="2"/><text x="110" y="470" font-size="28" fill="#b34942">保留批注与作答痕迹</text><rect x="95" y="680" width="420" height="260" fill="none" stroke="#4d6f60" stroke-width="4"/><path d="M95 940L515 680" stroke="#4d6f60" stroke-width="3"/><text x="95" y="1090" font-size="24">合成图片 · ${processed ? '处理预览模拟' : '原片模拟'}</text></g></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const services: PreparationServices = {
  preview,
  async prepare(owner, photo, options = {}) {
    log.prepares.push({ owner, studentId: photo.studentId, options }); await sleep(delay);
    if (failure) throw new Error('合成测试：模拟处理失败');
    const turns = options.quarterTurns || 0;
    return { schemaVersion: 1, algorithmVersion: 'android-photo-v1', originalId: photo.originalId, studentId: photo.studentId,
      outputId: `22222222-2222-2222-2222-${String(ordinal++).padStart(12, '0')}`, sourceSha256: photo.sha256, sha256: 'b'.repeat(64), bytes: 512,
      mime: 'image/jpeg', width: turns % 2 ? 1200 : 900, height: turns % 2 ? 900 : 1200, sourceWidth: 900, sourceHeight: 1200, exifOrientation: 1,
      decodedWidth: 900, decodedHeight: 1200, sourceSpace: 'exif-upright-normalized-edges', outputSpace: 'normalized-edges',
      corners: options.corners || fullPage, quarterTurns: options.quarterTurns || 0, enhancement: options.enhancement || 'none', maxEdge: 3072, jpegQuality: 94,
      sourceToOutput: rotations[turns], outputToSource: rotations[(4 - turns) % 4], createdAt: Date.now(), uri: 'file:///fixture/processed.jpg',
      quality: { advisoryOnly: true, warnings: ['possible-blur'], laplacianVariance: 20, darkFraction: .01, backgroundRange: 30, percentile10: 150, percentile90: 230 } };
  },
  async deliver(owner, photo, prepared, confirmed, signal) {
    if (!confirmed) throw new Error('Needs confirmation');
    await sleep(confirmDelay); signal?.throwIfAborted();
    const { uri: _uri, ...processing } = prepared;
    return { record: { version: 1, id: prepared.outputId, owner, studentId: photo.studentId, confirmedAt: Date.now(), policy: 'processed-only', original: photo, prepared },
      upload: { file: new Blob(['synthetic']), name: 'synthetic.jpg', processing, sourceKind: 'processed-photo' } };
  }, save: savePhotoDelivery,
};
let currentStudent = '学生甲';
const library: LibraryServices = { preview, read: async () => { throw new Error('No export destination configured'); },
  async list(owner, offset, limit, studentId) { log.lists.push({ owner, offset, limit, studentId }); await sleep(delay); return { originals: [original(studentId!)], total: 1 }; },
  async get() { const student = currentStudent; await sleep(delay); return original(student); },
};
function Fixture() {
  const [scope, setScope] = useState({ owner: '账号甲', studentId: '学生甲' }), [mode, setMode] = useState('prepare');
  currentStudent = scope.studentId;
  Object.assign(window, { photoFixture: {
    log, configure: (value: { delay?: number; confirmDelay?: number; failure?: boolean; handoffFailure?: boolean; holdPreview?: boolean }) => { delay = value.delay || 0; confirmDelay = value.confirmDelay || 0; failure = value.failure || false; handoffFailure = value.handoffFailure || false; holdPreview = value.holdPreview || false; },
    switchScope: (owner: string, studentId: string) => setScope({ owner, studentId }), library: () => setMode('library'),
  } });
  return <main style={{ padding: '12px' }}><p style={{fontSize:12,color:'#4b6054'}}>浏览器合成验收 · 未连接相机或服务器</p>
    {mode === 'library' ? <OriginalPhotoLibrary {...scope} studentLabel={scope.studentId} services={library} onResume={photo => { log.resumes.push(photo.studentId); setMode('prepare'); }} /> :
      <PhotoPreparation {...scope} studentLabel={scope.studentId} original={original(scope.studentId)} services={services}
        onConfirm={async delivery => { if (handoffFailure) { await sleep(20); throw new Error('合成测试：宿主接手未完成'); }
          log.confirms.push({ owner: delivery.record.owner, studentId: delivery.record.studentId }); }} onCancel={() => { log.cancels++; setMode('library'); }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
