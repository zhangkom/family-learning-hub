'use client';

import { appPath } from './deployment';
import {
  children,
  emptyFamily,
  mergeFamily,
  validateFamily,
  type ChildId,
  type FamilyState,
  type TaskMark,
} from './family-state';
import { parseStoredWrongQuestions, parseStoredStringList } from './learning';
import { parseStudyAttempts } from './study';

export type FamilyUser = { id: string; username: string };
const activeKey = 'family-learning:active';
export const learningEvent = 'family-learning:changed';
export const syncEvent = 'family-learning:sync';
export const pendingEvent = 'family-learning:pending';
let active: FamilyUser | null = null;
let initialized = false;
let identityLoaded = false;
let inFlight: Promise<void> | null = null;
let status = '未登录，记录保存在本机';
export function currentFamily() {
  if (!identityLoaded && typeof window !== 'undefined') {
    identityLoaded = true;
    try {
      const cached = JSON.parse(
        window.localStorage.getItem(activeKey) || 'null',
      );
      if (
        cached &&
        typeof cached.id === 'string' &&
        typeof cached.username === 'string'
      )
        active = cached;
    } catch {
      /* Public pages remain usable when browser storage is disabled. */
    }
  }
  return active;
}
function localKey(key: string, owner: FamilyUser | null = currentFamily()) {
  return owner ? `family-learning:${owner.id}:${key}` : key;
}
function emit() {
  window.dispatchEvent(new Event(learningEvent));
}
function setStatus(message: string) {
  status = message;
  window.dispatchEvent(new Event(syncEvent));
}
export function syncStatus() {
  return status;
}
function pendingKey(owner: FamilyUser) {
  return `family-learning:${owner.id}:pending`;
}
function touch(owner = active) {
  if (owner)
    window.localStorage.setItem(pendingKey(owner), crypto.randomUUID());
  window.dispatchEvent(new Event(pendingEvent));
}
export function setFamily(user: FamilyUser | null) {
  identityLoaded = true;
  active = user;
  if (user) window.localStorage.setItem(activeKey, JSON.stringify(user));
  else window.localStorage.removeItem(activeKey);
}
export const learningStorage = {
  getItem(key: string) {
    return window.localStorage.getItem(localKey(key));
  },
  setItem(key: string, value: string) {
    const old = learningStorage.getItem(key);
    if (key.endsWith(':weekly-tasks')) {
      const marksKey = `${key}:marks`;
      const marks = JSON.parse(
        window.localStorage.getItem(localKey(marksKey)) || '[]',
      ) as TaskMark[];
      const before = new Set(parseStoredStringList(old)),
        after = new Set(parseStoredStringList(value));
      const map = new Map(marks.map((x) => [x.id, x]));
      for (const id of new Set([...before, ...after])) {
        if (before.has(id) !== after.has(id))
          map.set(id, {
            id,
            done: after.has(id),
            at: Math.max(Date.now(), (map.get(id)?.at || 0) + 1),
            nonce: crypto.randomUUID(),
          });
      }
      window.localStorage.setItem(
        localKey(marksKey),
        JSON.stringify([...map.values()]),
      );
    }
    window.localStorage.setItem(localKey(key), value);
    touch();
    setStatus(active ? '已存本机，等待同步' : '未登录，记录保存在本机');
    emit();
  },
};
export function readLocal(
  owner: FamilyUser | null = currentFamily(),
): FamilyState {
  const records = emptyFamily();
  for (const child of children) {
    const key = `twin-stars:${child}:`;
    const get = (part: string) =>
      window.localStorage.getItem(localKey(key + part, owner));
    const weekly = parseStoredStringList(get('weekly-tasks'));
    const marks = JSON.parse(get('weekly-tasks:marks') || '[]') as TaskMark[];
    const marked = new Set(marks.map((x) => x.id));
    records[child] = {
      wrong: parseStoredWrongQuestions(get('wrong-questions'), 5000),
      attempts: parseStudyAttempts(get('study-attempts'), 20000),
      completed: parseStoredStringList(get('practice-complete'), 2000),
      weekly: [
        ...marks,
        ...weekly
          .filter((id) => !marked.has(id))
          .map((id) => ({ id, done: true, at: 0, nonce: 'legacy' })),
      ],
    };
  }
  return validateFamily(records);
}
function writeLocal(records: FamilyState, owner: FamilyUser | null = active) {
  // Keep a recoverable snapshot if a storage quota error interrupts these writes.
  const recoveryKey = localKey('sync-recovery', owner);
  window.localStorage.setItem(recoveryKey, JSON.stringify(records));
  for (const child of children) {
    const key = `twin-stars:${child}:`,
      s = records[child];
    const put = (part: string, value: unknown) =>
      window.localStorage.setItem(
        localKey(key + part, owner),
        JSON.stringify(value),
      );
    put('wrong-questions', s.wrong);
    put('study-attempts', s.attempts);
    put('practice-complete', s.completed);
    put('weekly-tasks:marks', s.weekly);
    put(
      'weekly-tasks',
      s.weekly.filter((x) => x.done).map((x) => x.id),
    );
  }
  window.localStorage.removeItem(recoveryKey);
  emit();
}
export async function familyRequest(path: string, body?: unknown) {
  const response = await fetch(appPath(`/api/family/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json()) as {
    error?: string;
    user: FamilyUser | null;
    records?: unknown;
    enabled?: boolean;
    needsSetup?: boolean;
  };
  if (!response.ok)
    throw Object.assign(new Error(data.error || '请求失败'), {
      status: response.status,
    });
  return data;
}
export async function initializeFamily() {
  if (initialized) return;
  try {
    const cached = JSON.parse(window.localStorage.getItem(activeKey) || 'null');
    if (
      cached &&
      typeof cached.id === 'string' &&
      typeof cached.username === 'string'
    )
      active = cached;
    const session = await familyRequest('session');
    setFamily(session.user || null);
    setStatus(
      session.enabled
        ? active
          ? '正在同步学习记录…'
          : '登录后可跨设备同步'
        : '当前版本保存在本机',
    );
  } catch {
    setStatus(
      active ? '暂时离线，登录记录保留在本机' : '暂时离线，记录保存在本机',
    );
  }
  initialized = true;
  const recovery = window.localStorage.getItem(localKey('sync-recovery'));
  if (recovery)
    writeLocal(mergeFamily(readLocal(), validateFamily(JSON.parse(recovery))));
}
export function syncFamily(): Promise<void> {
  if (!active) return Promise.resolve();
  if (inFlight) return inFlight;
  const owner = active;
  inFlight = (async () => {
    try {
      const pending = window.localStorage.getItem(pendingKey(owner));
      const data = await familyRequest(
        'sync',
        pending ? { records: readLocal(owner) } : undefined,
      );
      if (active?.id !== owner.id || data.user?.id !== owner.id) return;
      const remote = validateFamily(data.records);
      const merged = mergeFamily(readLocal(owner), remote);
      const changedDuringRequest =
        window.localStorage.getItem(pendingKey(owner)) !== pending;
      writeLocal(merged, owner);
      if (!changedDuringRequest) {
        if (
          JSON.stringify(merged) ===
          JSON.stringify(mergeFamily(remote, emptyFamily()))
        )
          window.localStorage.removeItem(pendingKey(owner));
        else touch(owner);
      }
      setStatus(
        window.localStorage.getItem(pendingKey(owner))
          ? '已存本机，等待同步'
          : `已同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      );
    } catch (e) {
      const error = e as Error & { status?: number };
      setStatus(
        error.status === 401
          ? '登录已过期，本机记录保留；请重新登录'
          : `尚未同步：${error.message || '网络不可用'}。本机记录保留。`,
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
export function importRecords(records: FamilyState) {
  const merged = mergeFamily(readLocal(), validateFamily(records));
  writeLocal(merged);
  touch();
  setStatus('已导入本机，等待同步');
  emit();
}
export function listenLearning(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === activeKey) {
      window.location.reload();
      return;
    }
    listener();
  };
  window.addEventListener(learningEvent, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(learningEvent, listener);
    window.removeEventListener('storage', storage);
  };
}
export function childLabel(child: ChildId) {
  return child === 'xiaobao' ? '小宝' : '大宝';
}
