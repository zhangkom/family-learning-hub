import { Buffer } from 'node:buffer';
import { getFamilyStore } from './family-store';
import { repairHomeworkImages } from './homework-image-repair';

// Reviewed private JSON arrives through stdin, never shell arguments or logs.
const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 4 * 1024 * 1024) throw new Error('修复清单超过4MiB');
  chunks.push(Buffer.from(chunk));
}
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('只支持--apply，默认只核对');
const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const store = getFamilyStore();
try {
  process.stdout.write(
    JSON.stringify(
      await repairHomeworkImages(
        store,
        manifest,
        !process.argv.includes('--apply'),
      ),
    ) + '\n',
  );
} finally {
  store.close();
}
