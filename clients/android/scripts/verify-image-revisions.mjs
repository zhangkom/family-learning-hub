import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installSyntheticPhotoBridge } from './synthetic-photo-bridge.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), out = resolve(process.env.FAMILY_IMAGE_REVISION_QA_DIR || resolve(root, '../../work/qa-comprehensive-20261003/image-revisions'));
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'), sharp = require('sharp');
const raw = await Promise.all(['#237eb1', '#f09821'].map(background => sharp({ create: { width: 800, height: 1200, channels: 3, background } }).jpeg().toBuffer()));
const length = Math.max(...raw.map(x => x.length));
const files = raw.map(bytes => { const result = Buffer.alloc(length); bytes.copy(result); return { base64: result.toString('base64'), sha256: createHash('sha256').update(result).digest('hex') }; });
assert.notEqual(files[0].sha256, files[1].sha256);
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 3336, strictPort: true, hmr: false, watch: null } }); await vite.listen();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext(); await context.addInitScript(installSyntheticPhotoBridge, { api: 'https://synthetic.invalid', initialToken: 'test', initialUserId: 'test' });
const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== 'http://127.0.0.1:3336') { errors.push('Unexpected external network'); return route.abort(); } if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body>Private cache revision regression with synthetic files</body></html>' }); return route.continue(); });
try {
  await page.goto('http://127.0.0.1:3336');
  const result = await page.evaluate(async ({ files, length }) => {
    const { recoveredImages } = await import('/src/photo-processing/recovered-image.ts');
    const { loadReviewImage } = await import('/src/photo-processing/review-image.ts');
    const { questionImageIdentity } = await import('/src/question-image-identity.ts');
    const [oldFile, newFile] = files.map(item => new Blob([Uint8Array.from(atob(item.base64), c => c.charCodeAt(0))], { type: 'image/jpeg' }));
    const owner = 'synthetic-family', signal = new AbortController().signal, oldScan = { id: 'same-scan', studentId: 'a', sourceKind: 'original', size: length, mimeType: 'image/jpeg', sourcePage: { scanSha256: files[0].sha256 } };
    const next = { ...oldScan, sourcePage: { scanSha256: files[1].sha256 } }; let requests = 0, response = newFile;
    const api = { image: async () => { requests++; return response; } };
    const check = (pass, message) => { if (!pass) throw new Error(message); return message; }, checks = [];
    await recoveredImages.save(owner, oldScan, oldFile, signal);
    checks.push(check(await recoveredImages.read(owner, next, signal) === undefined, 'Equal-size different-hash cache is a miss, not a locked failure.'));
    const loaded = await loadReviewImage(api, owner, next, true, signal);
    checks.push(check(await recoveredImages.verify(next, loaded.file, signal) === files[1].sha256 && requests === 1, 'Visible revised question automatically restores exactly the new digest.'));
    await loadReviewImage(api, owner, next, true, signal); checks.push(check(requests === 1, 'Reopening restored revision uses local bytes without a second download.'));
    checks.push(check(questionImageIdentity(next) === questionImageIdentity({ ...next, revision: 900 }), 'Text revisions do not invalidate the image.'));
    const corrupt = { ...next, id: 'corrupt-scan' }; response = oldFile;
    let rejected = false; try { await loadReviewImage(api, owner, corrupt, true, signal); } catch (error) { rejected = error.message.includes('题图校验失败'); }
    checks.push(check(rejected && await recoveredImages.read(owner, corrupt, signal) === undefined, 'Same-size wrong cloud bytes are rejected and never cached.'));
    response = newFile; await loadReviewImage(api, owner, corrupt, true, signal);
    const processed = { ...next, id: 'processed', sourceKind: 'processed-photo', processing: { studentId: 'a', sha256: files[0].sha256 } };
    checks.push(check(await recoveredImages.verify(processed, (await loadReviewImage(api, owner, processed, true, signal)).file, signal) === files[1].sha256, 'Old native processing hash cannot display old bytes over revised regions.'));
    // A previous APK stored no source hash in the fingerprint, but did save the actual digest.
    await new Promise((resolve, reject) => { const open = indexedDB.open('family-learning-recovered-question-images', 1); open.onsuccess = () => { const db = open.result, tx = db.transaction('images', 'readwrite'); tx.objectStore('images').put({ key: JSON.stringify([owner, 'a', 'legacy']), schemaVersion: 1, fingerprint: JSON.stringify([length, 'image/jpeg', null]), sha256: files[1].sha256, file: newFile }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; }; open.onerror = reject; });
    const before = requests; await loadReviewImage(api, owner, { ...next, id: 'legacy' }, true, signal);
    checks.push(check(requests === before, 'Matching legacy cache remains readable without redownloading existing images.'));
    const historic = { ...next, id: 'legacy', sourcePage: undefined, imageRevision: 0 };
    checks.push(check(await recoveredImages.read(owner, historic, signal) === undefined, 'Hashless historical snapshots never reuse an unversioned current cache.'));
    let selectedRevision; const historyApi = { image: async (_id, _signal, _hash, revision) => { selectedRevision = revision; return oldFile; } };
    const historyFile = await loadReviewImage(historyApi, owner, historic, true, signal);
    checks.push(check(selectedRevision === 0 && await historyFile.file.text() === await oldFile.text(), 'Legacy snapshot selects explicit scan revision zero instead of current image.'));
    return { checks, requests, sameBytes: oldFile.size === newFile.size, nativeDeviceTested: false };
  }, { files, length });
  assert.deepEqual(errors, []); writeFileSync(resolve(out, 'result.json'), JSON.stringify({ status: 'passed', syntheticOnly: true, productionWrites: 0, ...result }, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); await vite.close(); }
