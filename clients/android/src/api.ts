import type { Login, Question, Scan, Student, User } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const sessionExpiredEvent = 'family-learning:session-expired';

export function validateServer(value: string) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(import.meta.env.DEV && loopback && url.protocol === 'http:'))
  ) {
    throw new Error('请使用不含账号、参数的 HTTPS 服务地址');
  }
  return url.href.replace(/\/+$/, '');
}

export class FamilyApi {
  constructor(
    readonly base: string,
    readonly token = '',
  ) {}
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const form = body instanceof FormData;
    const options: RequestInit = {
      method,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined && !form
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      signal: AbortSignal.timeout(form ? 120000 : 20000),
    };
    if (body !== undefined) {
      if (method === 'GET' || method === 'HEAD')
        throw new Error('读取请求不能携带提交内容');
      options.body = form ? body : JSON.stringify(body);
    }
    const response = await fetch(`${this.base}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && this.token)
      window.dispatchEvent(
        new CustomEvent(sessionExpiredEvent, {
          detail: { base: this.base, token: this.token },
        }),
      );
    if (!response.ok)
      throw new ApiError(
        data.error || `请求未完成（${response.status}）`,
        response.status,
      );
    return data as T;
  }
  login(username: string, password: string) {
    return this.request<Login>('/session/login', 'POST', {
      username,
      password,
    });
  }
  setupStatus() {
    return this.request<{ enabled: boolean; needsSetup: boolean }>('/setup');
  }
  setup(username: string, password: string, setupToken: string) {
    return this.request<Login>('/session/setup', 'POST', {
      username,
      password,
      setupToken,
    });
  }
  me() {
    return this.request<{ user: User }>('/session');
  }
  logout() {
    return this.request('/session/logout', 'POST', {});
  }
  students() {
    return this.request<{ students: Student[] }>('/students');
  }
  addStudent(name: string, grade: string) {
    return this.request<{ student: Student }>('/students', 'POST', {
      name,
      grade,
    });
  }
  scans(studentId: string) {
    return this.request<{ scans: Scan[] }>(
      `/scans?studentId=${encodeURIComponent(studentId)}`,
    );
  }
  scan(id: string) {
    return this.request<{ scan: Scan }>(`/scans/${encodeURIComponent(id)}`);
  }
  upload(draft: {
    studentId: string;
    source: string;
    file: Blob;
    name: string;
    id: string;
  }) {
    const form = new FormData();
    form.set('studentId', draft.studentId);
    form.set('subject', '数学');
    form.set('source', draft.source);
    form.set('clientRequestId', draft.id);
    form.set('file', draft.file, draft.name);
    return this.request<{ scan: Scan }>('/scans', 'POST', form);
  }
  recognize(scan: Scan) {
    return this.request<{ scan: Scan }>(
      `/scans/${encodeURIComponent(scan.id)}/recognize`,
      'POST',
      { revision: scan.revision },
    );
  }
  review(scan: Scan, questions: Question[]) {
    return this.request<{ scan: Scan }>(
      `/scans/${encodeURIComponent(scan.id)}/review`,
      'PUT',
      { revision: scan.revision, questions },
    );
  }
  async image(id: string, signal?: AbortSignal) {
    const response = await fetch(
      `${this.base}/scans/${encodeURIComponent(id)}/file`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      },
    );
    if (response.status === 401)
      window.dispatchEvent(
        new CustomEvent(sessionExpiredEvent, {
          detail: { base: this.base, token: this.token },
        }),
      );
    if (!response.ok)
      throw new ApiError('原图加载失败，请重新打开', response.status);
    return response.blob();
  }
}
