import { Capacitor, registerPlugin } from '@capacitor/core';

const vault = registerPlugin<{
  get(): Promise<{ value?: string }>;
  set(options: { value: string }): Promise<void>;
  clear(): Promise<void>;
}>('SessionVault');

// Browser previews use memory only. Native builds use an Android Keystore-backed plugin.
let memory = '';
export const session = {
  async read() {
    if (!Capacitor.isNativePlatform()) return memory;
    return (await vault.get()).value || '';
  },
  async save(value: string) {
    if (Capacitor.isNativePlatform()) await vault.set({ value });
    memory = value;
  },
  async clear() {
    memory = '';
    if (Capacitor.isNativePlatform()) await vault.clear();
  },
};
