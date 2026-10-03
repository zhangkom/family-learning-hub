import { Buffer } from 'node:buffer';
import { getFamilyStore } from './family-store';
import { importHomeworkManifest } from './homework-import';

// JSON stdin prevents private manifests and source text entering argv/history.
// Default is a transactional dry run. Only --apply writes reviewed metadata.
const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 32 * 1024 * 1024) throw new Error('清单超过32MiB，请拆分');
  chunks.push(Buffer.from(chunk));
}
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('只支持--apply，其余情况默认只验证');
const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const store = getFamilyStore();
try {
  process.stdout.write(
    JSON.stringify(
      await importHomeworkManifest(
        store,
        manifest,
        !process.argv.includes('--apply'),
      ),
    ) + '\n',
  );
} finally {
  store.close();
}
