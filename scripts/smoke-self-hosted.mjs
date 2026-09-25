import assert from 'node:assert/strict';

const origin = process.argv[2] || 'http://127.0.0.1:3190';
const base = `${origin}/family-learning`;
const paths = [
  '/',
  '/xiaobao',
  '/dabao',
  '/xiaobao/study',
  '/dabao/study',
  '/xiaobao/practice',
  '/dabao/practice',
  '/xiaobao/wrong-book',
  '/dabao/review',
  '/xiaobao/practice/method-xb-geo-lines',
  '/xiaobao/practice/method-xb-abs-box',
  '/dabao/practice/method-db-equilibrium',
];
let exerciseCount = 0;
for (const path of paths) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="zh-CN"/, `Chinese document: ${path}`);
  if (path === '/') assert.match(html, /大宝逐梦名校，小宝冲刺深圳四大/);
  if (path.endsWith('/practice')) {
    const links = [
      ...new Set(
        [
          ...html.matchAll(
            /href="(\/family-learning\/(?:xiaobao|dabao)\/practice\/[^"?#]+)"/g,
          ),
        ].map((m) => m[1]),
      ),
    ];
    assert.ok(links.length > 0, `Printable worksheet links: ${path}`);
    for (const link of links.slice(0, 2)) {
      const worksheet = await fetch(`${origin}${link}`);
      assert.equal(worksheet.status, 200, link);
      assert.match(await worksheet.text(), /打印|答题/);
      exerciseCount++;
    }
  }
  const assets = [
    ...new Set(
      [
        ...html.matchAll(
          /(?:src|href)="(\/family-learning\/_next\/static\/[^"?#]+)"/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  assert.ok(assets.length > 0, `Prefixed assets: ${path}`);
  for (const asset of assets.slice(0, 2)) {
    const result = await fetch(`${origin}${asset}`);
    assert.equal(result.status, 200, asset);
    assert.ok(
      !result.headers.get('content-type')?.includes('text/html'),
      asset,
    );
    assert.ok(
      (await result.arrayBuffer()).byteLength > 0,
      `Complete asset body: ${asset}`,
    );
  }
  console.log(`OK ${path}`);
}
for (const path of [
  '/api/scans',
  '/api/wrong-questions?child=xiaobao',
  '/api/scans/test/file',
]) {
  for (const method of path.endsWith('/file') ? ['GET'] : ['GET', 'POST']) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'oai-authenticated-user-id': 'spoofed',
        'oai-authenticated-user-email': 'spoofed@example.invalid',
      },
    });
    assert.equal(response.status, 401, `Unauthenticated ${method} ${path}`);
    await response.text();
  }
}
console.log(
  `Verified ${paths.length} pages, ${exerciseCount} worksheets, assets and API identity rejection.`,
);
