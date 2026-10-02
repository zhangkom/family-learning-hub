import type { renameSync, lstatSync } from 'node:fs';
export function publishDirectorySync(source: string, target: string, options?: {
  platform?: NodeJS.Platform;
  rename?: typeof renameSync;
  inspect?: typeof lstatSync;
  wait?: (milliseconds: number) => void;
}): void;
