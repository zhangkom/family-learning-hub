// The service memory limit includes child processes. Candidate detection and
// cloud validation/preview must not decode large originals simultaneously.
let held = false;
const listeners = new Set<() => void>();
export function onImageProcessAvailable(listener: () => void) {
  listeners.add(listener);
}
export function acquireImageProcess() {
  if (held) return undefined;
  held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
    for (const listener of listeners) queueMicrotask(listener);
  };
}
