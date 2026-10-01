import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { sharp } from './server/sharp.ts';
import { FamilyStore } from './server/family-store.ts';
import {
  readStoredScan,
  writeStoredScan,
  scanDirectory,
} from './server/scan-files.ts';
import { reviewMobileScan, mobileScan } from './server/mobile-service.ts';
import { enqueueExplanation, runNextJob } from './server/scan-jobs.ts';
import { handleMobile } from './server/mobile-backend.ts';

// Copied to a unique old-source checkout and bundled into its built/ directory.
const directory = resolve(fileURLToPath(new URL('../data', import.meta.url)));
mkdirSync(directory, { recursive: true });
Object.assign(process.env, {
  FAMILY_DATA_DIR: directory,
  FAMILY_PUBLIC_ORIGIN: 'https://synthetic.invalid',
  FAMILY_AI_API_KEY: 'synthetic-key-only',
  OPENAI_API_KEY: '',
  FAMILY_AI_BASE_URL: 'https://synthetic-model.invalid/v1',
  FAMILY_AI_MODEL: 'synthetic-model',
  FAMILY_RECOGNITION_ENABLED: 'true',
});
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://synthetic-model.invalid/v1/chat/completions');
  const body = JSON.parse(options.body),
    data = body.messages[1].content[1].image_url.url;
  assert(data.startsWith('data:image/jpeg;base64,'));
  const crop = await sharp(
    Buffer.from(data.split(',')[1], 'base64'),
  ).metadata();
  assert.equal(crop.width, 256);
  assert.equal(crop.height, 256);
  calls++;
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              questions: [
                {
                  transcribedPrompt: 'synthetic',
                  referenceAnswer: 'synthetic',
                  explanation: 'synthetic',
                  answerEvidence: [],
                  errorHypotheses: [],
                  uncertainties: [],
                },
              ],
            }),
          },
        },
      ],
    }),
  );
};
const store = new FamilyStore(join(directory, 'family.sqlite'));
try {
  store.db
    .prepare('INSERT OR IGNORE INTO accounts VALUES (?,?,?,?)')
    .run('synthetic', 'synthetic', 'unusable', Date.now());
  const student = store.addStudent('synthetic', 'synthetic child').id;
  const id = randomUUID(),
    owner = store.scanOwner('synthetic');
  const bytes = await sharp({
    create: { width: 256, height: 256, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  const processing = {
    schemaVersion: 1,
    algorithmVersion: 'android-photo-v1',
    originalId: randomUUID(),
    outputId: randomUUID(),
    studentId: student,
    sourceSha256: 'a'.repeat(64),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mime: 'image/jpeg',
    width: 256,
    height: 256,
    sourceWidth: 256,
    sourceHeight: 256,
    exifOrientation: 1,
    decodedWidth: 256,
    decodedHeight: 256,
    sourceSpace: 'exif-upright-normalized-edges',
    outputSpace: 'normalized-edges',
    corners: [0, 0, 1, 0, 1, 1, 0, 1],
    quarterTurns: 0,
    enhancement: 'none',
    jpegQuality: 94,
    maxEdge: 1024,
    sourceToOutput: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    outputToSource: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    quality: {
      advisoryOnly: true,
      warnings: ['small-output'],
      laplacianVariance: 0,
      darkFraction: 0,
      backgroundRange: 0,
      percentile10: 255,
      percentile90: 255,
    },
    createdAt: Date.now(),
  };
  const q = {
    id: 'q1',
    subject: '物理',
    number: '1',
    prompt: '',
    diagram: '',
    knowledgePoints: [],
    uncertainties: [],
    confirmed: false,
    answerSteps: [],
    regions: [{ id: 'r1', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }],
  };
  const record = {
    id,
    studentId: student,
    sourceKind: 'processed-photo',
    processing,
    subject: '待选择',
    source: 'synthetic',
    originalName: 'synthetic.jpg',
    mimeType: 'image/jpeg',
    size: bytes.length,
    status: 'needs_review',
    createdAt: new Date().toISOString(),
    fileUrl: 'synthetic',
    revision: 0,
    structuredQuestions: [q],
    questions: [],
  };
  writeStoredScan(store, owner, record, 'synthetic-new-record');
  const scanDir = scanDirectory(owner, id);
  mkdirSync(scanDir, { recursive: true });
  writeFileSync(join(scanDir, 'original'), bytes);
  let reviewed = await reviewMobileScan(store, 'synthetic', id, {
    revision: 0,
    questions: [{ ...q, prompt: 'Synthetic edit' }],
  });
  assert.deepEqual(readStoredScan(store, owner, id).processing, processing);
  reviewed = enqueueExplanation(
    store,
    'synthetic',
    id,
    'q1',
    reviewed.revision,
  );
  await runNextJob(store);
  const completed = readStoredScan(store, owner, id);
  assert.deepEqual(completed.processing, processing);
  assert.equal(completed.sourceKind, 'processed-photo');
  assert.equal(
    completed.structuredQuestions[0].tutoring.status,
    'needs_review',
  );
  assert.equal(mobileScan(completed).processing, undefined);
  const setup = await handleMobile(
    new Request(
      'https://synthetic.invalid/family-learning/api/mobile/v1/setup',
    ),
    ['setup'],
    store,
  );
  const capability = await setup.json();
  assert.equal(capability.processedPhotoMetadataVersion, undefined);
  const report = {
    syntheticOnly: true,
    oldCommit: '9bf75159fa20fa4520b2f7c4d35d03f509c3370d',
    realModelCalls: 0,
    stubCalls: calls,
    reviewPreservesProcessing: true,
    workerPreservesProcessing: true,
    legacyResponseOmitsProcessing: true,
    legacySetupDoesNotAdvertiseCapability: true,
    oldWorkerActualJpegCrop: true,
    oldGatewayStubHttp: true,
    productionDataRead: false,
  };
  writeFileSync(
    'work/rollback-028-compatibility.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  store.close();
}
