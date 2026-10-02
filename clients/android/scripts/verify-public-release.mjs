import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPermissions } from './audit-apk-permissions.mjs';

// Read-only public verification. Signing keys and production credentials are never needed.
const [version, batch, javaHome, publishedDeltasPath] = process.argv.slice(2);
assert.match(version || '', /^\d+\.\d+\.\d+$/);
assert.ok(batch && javaHome, 'Usage: node verify-public-release.mjs VERSION BATCH_DIRECTORY JAVA_HOME [PUBLISHED_DELTAS_JSON]');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, 'outputs/android/download-check', version);
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const expected = json(join(root, 'outputs/android', `apk-verification-${version}.json`));
const frozenDeltaManifest = json(join(resolve(batch), 'deltas.json'));
const selectedDeltaManifest = publishedDeltasPath ? json(resolve(publishedDeltasPath)) : frozenDeltaManifest;
assert.deepEqual(selectedDeltaManifest.target, frozenDeltaManifest.target);
const privateDeltas = selectedDeltaManifest.deltas;
assert.ok(Array.isArray(privateDeltas) && privateDeltas.length >= 1 && privateDeltas.length <= 4,
  'Published updates must honor the existing clients\' four-delta limit');
assert.equal(new Set(privateDeltas.map(item => item.fromVersionCode)).size, privateDeltas.length);
for (const delta of privateDeltas) {
  assert.deepEqual(delta, frozenDeltaManifest.deltas.find(item => item.fromVersionCode === delta.fromVersionCode),
    'Publication selection must match frozen evidence exactly');
}
const base = 'https://123.207.232.151/family-learning/';
const downloads = base + 'downloads/android/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', windowsHide: true });
const sdk = join(root, 'work/android-sdk/build-tools/36.0.0');
mkdirSync(output, { recursive: true });
async function downloadExact(url, size, digest, mime) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.ok(response.headers.get('content-type')?.startsWith(mime));
  const pieces = []; let length = 0;
  for await (const piece of response.body) {
    length += piece.length; assert.ok(length <= size, 'Download exceeds expected size'); pieces.push(piece);
  }
  const bytes = Buffer.concat(pieces);
  assert.equal(bytes.length, size); assert.equal(sha(bytes), digest.toLowerCase());
  return bytes;
}
const metadata = await fetch(downloads + 'latest.json', {
  headers: { Origin: 'https://localhost', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000),
});
assert.equal(metadata.status, 200);
assert.equal(metadata.headers.get('access-control-allow-origin'), 'https://localhost');
assert.match(metadata.headers.get('cache-control') || '', /no-store/);
const manifest = await metadata.json();
assert.equal(manifest.app, '知识棱镜AI');
for (const key of ['version', 'versionCode', 'bytes', 'commit']) assert.equal(manifest[key], expected[key], key);
assert.equal(manifest.sha256.toLowerCase(), expected.sha256.toLowerCase());
const name = `family-learning-${version}-release-${expected.commit.slice(0, 7)}.apk`;
assert.equal(manifest.fileName, name);
assert.equal(manifest.downloadUrl, downloads + name);
const latest = await fetch(downloads + 'latest.apk', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
assert.ok([301, 302, 303, 307, 308].includes(latest.status));
assert.equal(new URL(latest.headers.get('location'), downloads).href, manifest.downloadUrl);
await latest.body?.cancel();
const bytes = await downloadExact(manifest.downloadUrl, expected.bytes, expected.sha256, 'application/vnd.android.package-archive');
const apk = join(output, name); writeFileSync(apk, bytes);
const permissions = auditPermissions(run(join(sdk, 'aapt.exe'), ['dump', 'permissions', apk]));
const badging = run(join(sdk, 'aapt.exe'), ['dump', 'badging', apk]);
assert.match(badging, /package: name='cn\.familylearning\.study'/);
assert.ok(badging.includes(`versionCode='${expected.versionCode}'`));
assert.ok(badging.includes(`versionName='${version}'`));
assert.ok(badging.includes("application-label:'知识棱镜AI'"));
const java = join(javaHome, 'bin/java.exe');
const signer = run(java, ['-jar', join(sdk, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', apk]);
assert.ok(signer.toLowerCase().includes(expected.certificateSha256.toLowerCase()));
writeFileSync(join(output, 'signature.txt'), signer);
const baselines = readdirSync(join(root, 'outputs/android'))
  .filter(file => /^apk-verification-\d+\.\d+\.\d+\.json$/.test(file))
  .map(file => json(join(root, 'outputs/android', file)));
assert.equal(manifest.deltas.length, privateDeltas.length);
assert.equal(new Set(manifest.deltas.map(d => d.fromVersionCode)).size, privateDeltas.length);
const deltas = [];
const classes = join(output, 'java'); mkdirSync(classes, { recursive: true });
run(join(javaHome, 'bin/javac.exe'), ['-d', classes,
  join(root, 'clients/android/android/app/src/main/java/cn/familylearning/study/DeltaApplier.java'),
  join(root, 'clients/android/scripts/java/cn/familylearning/study/DeltaApplierTest.java')]);
for (const delta of manifest.deltas) {
  const local = privateDeltas.find(item => item.fromVersionCode === delta.fromVersionCode); assert.ok(local);
  for (const key of ['format', 'fromVersionCode', 'baseBytes', 'baseSha256', 'bytes', 'sha256']) assert.equal(delta[key], local[key], key);
  assert.equal(basename(local.fileName), local.fileName);
  assert.equal(delta.downloadUrl, downloads + local.fileName);
  const patch = join(output, local.fileName);
  writeFileSync(patch, await downloadExact(delta.downloadUrl, delta.bytes, delta.sha256, 'application/octet-stream'));
  const baseline = baselines.find(item => item.versionCode === delta.fromVersionCode); assert.ok(baseline);
  const baselinePath = join(root, 'outputs/android', `family-learning-${baseline.version}-release.apk`);
  const before = readFileSync(baselinePath);
  assert.equal(before.length, delta.baseBytes); assert.equal(sha(before), delta.baseSha256);
  const result = run(java, [`-Djava.io.tmpdir=${output}`, '-cp', classes,
    'cn.familylearning.study.DeltaApplierTest', baselinePath, patch, apk]);
  assert.match(result, /byte-for-byte reconstruction passed/);
  writeFileSync(join(output, `java-${delta.fromVersionCode}-to-${expected.versionCode}.txt`), result);
  deltas.push({ ...delta, tlsVerified: true, noExtraContentEncoding: true,
    javaByteExactRebuild: true, savingsPercent: 100 * (1 - delta.bytes / bytes.length) });
}
const setupResponse = await fetch(base + 'api/mobile/v1/setup', { signal: AbortSignal.timeout(20000) });
assert.equal(setupResponse.status, 200);
const setup = await setupResponse.json(); assert.equal(setup.enabled, true); assert.equal(setup.registrationEnabled, true);
assert.equal(setup.processedPhotoMetadataVersion, 1);
if (expected.versionCode >= 19) assert.equal(setup.learningSessionVersion, 1);
if (expected.versionCode >= 14) assert.equal(setup.questionReviewVersion, 1);
if (expected.versionCode >= 12) {
  assert.equal(setup.cloudPhotos?.version, 1);
  assert.equal(setup.cloudPhotos.maxBatchItems, expected.versionCode >= 17 ? Number.MAX_SAFE_INTEGER : expected.versionCode >= 13 ? 200 : 100);
  if (expected.versionCode >= 17) assert.equal(setup.cloudPhotos.nameConflictVersion, 1);
  assert.equal(setup.cloudPhotos.maxFileBytes, 32 * 1024 * 1024);
}
const account = await fetch(base + 'account', { signal: AbortSignal.timeout(20000) }); assert.equal(account.status, 200);
const result = { version, versionCode: expected.versionCode, commit: expected.commit, app: manifest.app,
  resolvedUrl: manifest.downloadUrl, bytes: bytes.length, sha256: sha(bytes), certificateSha256: expected.certificateSha256,
  tlsVerified: true, signatureVerified: true, actualPackageVersionVerified: true, updateCorsVerified: true, metadataNoStore: true,
  setupStatus: setupResponse.status, processedPhotoMetadataVersion: setup.processedPhotoMetadataVersion, questionReviewVersion: setup.questionReviewVersion, learningSessionVersion: setup.learningSessionVersion, cloudPhotos: setup.cloudPhotos, websiteStatus: account.status,
  checkedAt: new Date().toISOString(), productionWrites: false, nativeDeviceTested: false, deltas, ...permissions };
writeFileSync(join(output, 'verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
