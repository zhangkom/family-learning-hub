import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || 'playwright',
);
const base = process.argv[2] || 'http://127.0.0.1:3191/family-learning';
const ids = ['focus', 'junior', 'senior'].flatMap((file) =>
  [
    ...readFileSync(`lib/study-content/${file}.ts`, 'utf8').matchAll(
      /id: '(\w+-[\w-]+)'/g,
    ),
  ].map((match) => match[1]),
);
assert.equal(ids.length, 28);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const id of ids) {
    await page.emulateMedia({ media: 'screen' });
    const child = id.startsWith('xb-') ? 'xiaobao' : 'dabao';
    const response = await page.goto(`${base}/${child}/practice/method-${id}`);
    assert.equal(response.status(), 200, id);
    await page.getByLabel('打印版本').waitFor();
    for (const version of ['student', 'answers']) {
      await page.emulateMedia({ media: 'screen' });
      await page.getByLabel('打印版本').selectOption(version);
      assert.equal(
        await page.locator('.worksheet-solution').count(),
        version === 'student' ? 0 : 4,
      );
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      const info = execFileSync('pdfinfo', ['-'], {
        input: pdf,
        encoding: 'utf8',
      });
      assert.match(
        info,
        /Pages:\s+1\b/,
        `${id} ${version}: must fit one A4 page`,
      );
      const content = execFileSync(
        process.env.PDF_PYTHON || 'python',
        [
          '-c',
          'import sys,io; from pypdf import PdfReader; print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))',
        ],
        {
          input: pdf,
          encoding: 'utf8',
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        },
      );
      assert.ok(
        content.includes(`method-${id}`),
        `${id}: footer must be present`,
      );
      if (version === 'student')
        assert.ok(!content.includes('答案：'), `${id}: answers leaked`);
    }
  }
  console.log(
    `PASS: ${ids.length} worksheets, student + answer versions (56 PDFs), each one A4 page, no student answer leakage.`,
  );
} finally {
  await browser.close();
}
