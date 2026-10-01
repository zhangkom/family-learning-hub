import { setTimeout } from 'node:timers/promises';
import { getFamilyStore } from './family-store';
import { runNextJob } from './scan-jobs';

const store = getFamilyStore();
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
try {
  while (!stopping) {
    try {
      if (!(await runNextJob(store))) await setTimeout(1000);
    } catch (e) {
      console.error(
        'Scan worker failed:',
        e instanceof Error ? e.name : 'unknown',
      );
      await setTimeout(5000);
    }
  }
} finally {
  store.close();
}
