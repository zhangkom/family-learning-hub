import { resolve, relative } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FamilyStore } from '../server/family-store';
import { provisionAdmin } from '../server/admin-service';
import { hashPassword } from '../server/family-backend';
import { saveScan } from '../server/scan-files';
import { sharp } from '../server/sharp';
import type { Question } from '../lib/mobile';

const directory = resolve(process.argv[2] || ''),
  parent = resolve('work/qa-admin');
if (
  !relative(parent, directory) ||
  relative(parent, directory).startsWith('..')
)
  throw new Error('Synthetic fixtures must be created beneath work/qa-admin');
await mkdir(directory, { recursive: true });
process.env.FAMILY_DATA_DIR = directory;
const store = new FamilyStore(resolve(directory, 'family.sqlite'));
if (store.db.prepare('SELECT 1 FROM accounts').get())
  throw new Error('Refusing to replace existing fixtures');
const password = 'Synthetic-test-only-4387';
try {
  const administrator = await provisionAdmin(store, password),
    hash = await hashPassword(password);
  for (const [id, name] of [
    ['synthetic-family-a', 'test_family_a'],
    ['synthetic-family-b', 'test_family_b'],
  ])
    store.db
      .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
      .run(id, name, hash, Date.now());
  const student = store.addStudent('synthetic-family-a', '合成学生', '高二');
  const id = randomUUID(),
    q = (number: string, y: number): Question => ({
      id: 'q' + number,
      number,
      subject: '数学',
      prompt:
        number === '1' ? '已知 x + 1 = 2，求 x。' : '已知 y - 3 = 2，求 y。',
      diagram: '',
      knowledgePoints: ['一元一次方程'],
      regions: [
        { id: 'r' + number, kind: 'stem', x: 0, y, width: 1, height: 0.4 },
      ],
      answerSteps: [],
      uncertainties: [],
      confirmed: true,
      wrongBook: { savedAt: new Date().toISOString() },
      referenceAnswer: '旧答案待修正',
      explanation: '合成旧解析',
    });
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="600"><rect width="700" height="600" fill="white"/><g font-size="30" fill="black"><text x="30" y="70">1. x + 1 = 2. Find x.</text><text x="30" y="365">2. y - 3 = 2. Find y.</text></g></svg>',
    ),
  )
    .png()
    .toBuffer();
  await saveScan(
    'synthetic-family-a',
    {
      id,
      studentId: student.id,
      subject: '数学',
      source: '仅合成测试',
      originalName: 'synthetic-math.png',
      mimeType: 'image/png',
      size: image.length,
      status: 'ready',
      createdAt: new Date().toISOString(),
      fileUrl: '',
      revision: 1,
      structuredQuestions: [q('1', 0), q('2', 0.5)],
    },
    image,
    store,
  );
  await writeFile(
    resolve(directory, 'fixture.json'),
    JSON.stringify(
      {
        administrator,
        username: 'admin',
        password,
        accountId: 'synthetic-family-a',
        studentId: student.id,
        scanId: id,
        questionIds: ['q1', 'q2'],
      },
      null,
      2,
    ),
  );
  console.log(
    'Synthetic admin fixtures created. No production writes or model calls.',
  );
} finally {
  store.close();
}
