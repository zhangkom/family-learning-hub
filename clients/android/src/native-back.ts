import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';

type Entry = { close: () => void; priority: number };
const entries: Entry[] = [];
let connection: { active: boolean; handle: ReturnType<typeof NativeApp.addListener> } | undefined;

/** A native back event goes only to the top view, never both a dialog and its parent. */
export function registerNativeBack(close: () => void, priority = 0) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const entry = { close, priority }; entries.push(entry);
  if (!connection) {
    const current = { active: true, handle: NativeApp.addListener('backButton', () => {
      if (!current.active) return;
      const top = entries.reduce<Entry | undefined>((best, item) => !best || item.priority >= best.priority ? item : best, undefined);
      top?.close();
    }) };
    connection = current;
    void current.handle.catch(() => {});
  }
  return () => {
    const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1);
    if (!entries.length && connection) {
      const current = connection; current.active = false; connection = undefined;
      void current.handle.then(handle => handle.remove()).catch(() => {});
    }
  };
}

export function useNativeBack(close: () => void, priority = 0) {
  const latest = useRef(close); latest.current = close;
  useEffect(() => registerNativeBack(() => latest.current(), priority), [priority]);
}
