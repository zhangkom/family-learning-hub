import { getFamilyStore } from './family-store';
import { provisionAdmin } from './admin-service';

// Run on the project host with the private data directory. Password arrives on
// stdin, never via argv, logs, a public route, or a committed config file.
const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 4096) throw new Error('输入过长');
  chunks.push(Buffer.from(chunk));
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (typeof input.password !== 'string') throw new Error('缺少初始密码');
const store = getFamilyStore();
try {
  process.stdout.write(
    JSON.stringify(await provisionAdmin(store, input.password)) + '\n',
  );
} finally {
  store.close();
}
