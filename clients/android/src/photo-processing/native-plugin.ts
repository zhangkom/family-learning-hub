import { registerPlugin } from '@capacitor/core';

// Every feature uses the same Capacitor proxy. Registering each interface separately
// warns on every page load and can diverge when Capacitor's proxy handling changes.
const plugin = registerPlugin<object>('PhotoProcessing');
export function photoPlugin<T extends object>(): T { return plugin as T; }
