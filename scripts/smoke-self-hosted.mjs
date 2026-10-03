import assert from 'node:assert/strict';
const origin = process.argv[2] || 'http://127.0.0.1:3190';
const base = `${origin}/family-learning`;
const page = await fetch(`${base}/`);
assert.equal(page.status, 200);
assert.match(await page.text(), /知识棱镜AI/);
const response = await fetch(`${base}/web-client/manifest.json`);
assert.equal(response.status, 200);
const manifest = await response.json();
assert.ok(Object.values(manifest).some(entry => entry.isEntry));
const assets = new Set(Object.values(manifest).flatMap(entry => [entry.file, ...(entry.css || [])]));
for (const asset of assets) {
  assert.ok(asset.startsWith('assets/') && !asset.includes('..'));
  const response = await fetch(`${base}/web-client/${asset}`);
  assert.equal(response.status, 200, asset);
  assert.ok(!response.headers.get('content-type')?.includes('text/html'), asset);
  assert.ok((await response.arrayBuffer()).byteLength > 0, asset);
}
for (const path of ['/account', '/students', '/scans', '/family-review', '/dabao', '/xiaobao', '/dabao/wrong-book', '/xiaobao/practice']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) assert.ok(response.headers.get('location').includes('/family-learning/#/'), path);
  else { assert.equal(response.status, 200, path); assert.match(await response.text(), /family-learning\/(?:#|%23)/, path); }
}
for (const path of ['/api/family/workspace/session', '/api/family/workspace/students', '/api/family/workspace/scans?studentId=synthetic-missing', '/api/admin/session']) {
  const response = await fetch(base + path); assert.equal(response.status, 401, path);
}
const forbidden = await fetch(base + '/api/family/workspace/session/login', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(forbidden.status, 403, 'Cross-site cookie authentication rejected');
console.log(`Hosted web entry, ${assets.size} resources, legacy links and session boundaries verified.`);
