import { setTimeout } from 'node:timers/promises';
import { getFamilyStore } from './family-store';
import { runNextJob } from './scan-jobs';
import { runNextLearningJob } from './learning-jobs';
import { runNextWeaknessJob } from './weakness-jobs';

const store = getFamilyStore();
let stopping = false, nextQueue = 0;
const queues = [runNextJob, runNextLearningJob, runNextWeaknessJob];
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
try {
  while (!stopping) {
    try {
      let worked = false;
      for (let attempt = 0; attempt < queues.length; attempt++) {
        const index = nextQueue;
        nextQueue = (nextQueue + 1) % queues.length;
        if (await queues[index](store)) { worked = true; break; }
      }
      if (!worked) await setTimeout(1000);
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
