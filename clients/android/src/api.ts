import type { Login, Question, Scan, Student, User, WrongBookItem, TutoringReviewInput } from './types';
import type { CandidateReply } from './candidates';
import type { PhotoDelivery } from './photo-processing/delivery';
import { verifyProcessedReceipt } from './photo-processing/receipt';

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
  async request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const form = body instanceof FormData;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort(); else signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), form ? 120000 : 20000);
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
      signal: controller.signal,
    };
    try {
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
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', forwardAbort); }
  }
  login(username: string, password: string) {
    return this.request<Login>('/session/login', 'POST', {
      username,
      password,
    });
  }
  setupStatus() {
    return this.request<{ enabled: boolean; needsSetup: boolean; registrationEnabled?: boolean; processedPhotoMetadataVersion?: number }>('/setup');
  }
  register(username: string, password: string) {
    return this.request<Login>('/session/register', 'POST', { username, password });
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
  changeUsername(username: string, currentPassword: string) {
    return this.request<Login>('/account/username', 'POST', { username, currentPassword });
  }
  changePassword(password: string, currentPassword: string) {
    return this.request<Login>('/account/password', 'POST', { password, currentPassword });
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
  }, signal?: AbortSignal) {
    const form = new FormData();
    form.set('studentId', draft.studentId);
    form.set('source', draft.source);
    form.set('clientRequestId', draft.id);
    form.set('file', draft.file, draft.name);
    return this.request<{ scan: Scan }>('/scans', 'POST', form, signal);
  }
  async uploadProcessed(delivery: PhotoDelivery, signal?: AbortSignal) {
    const { upload, record } = delivery;
    if (record.policy !== 'processed-only' || record.id !== upload.processing.outputId || record.studentId !== upload.processing.studentId)
      throw new Error('处理图待提交记录不匹配');
    signal?.throwIfAborted();
    const capability = await this.request<{ processedPhotoMetadataVersion?: number }>('/setup', 'GET', undefined, signal);
    signal?.throwIfAborted();
    if (capability.processedPhotoMetadataVersion !== 1)
      throw new Error('服务器需要升级服务以接收照片处理信息，尚未发送照片；待提交照片已保留');
    const form = new FormData();
    form.set('studentId', record.studentId);
    form.set('source', '手机拍照与导入');
    form.set('clientRequestId', upload.processing.outputId);
    form.set('sourceKind', 'processed-photo');
    form.set('processing', JSON.stringify(upload.processing));
    form.set('file', upload.file, upload.name);
    const result = await this.request<{ scan: Scan }>('/scans', 'POST', form, signal);
    verifyProcessedReceipt(result.scan, delivery);
    return result;
  }
  recognize(scan: Scan) {
    return this.request<{ scan: Scan }>(
      `/scans/${encodeURIComponent(scan.id)}/recognize`,
      'POST',
      { revision: scan.revision },
    );
  }
  candidateRegions(scan: Scan) {
    return this.request<CandidateReply>(`/scans/${encodeURIComponent(scan.id)}/candidate-regions`,
      'POST', { revision: scan.revision });
  }
  review(scan: Scan, questions: Question[]) {
    return this.request<{ scan: Scan }>(
      `/scans/${encodeURIComponent(scan.id)}/review`,
      'PUT',
      { revision: scan.revision, questions },
    );
  }
  wrongBook(studentId: string) {
    return this.request<{ items: WrongBookItem[] }>(`/wrong-book?studentId=${encodeURIComponent(studentId)}`);
  }
  saveWrongQuestion(scan: Scan, questionId: string, saved = true) {
    return this.request<{ scan: Scan }>(`/scans/${encodeURIComponent(scan.id)}/questions/${encodeURIComponent(questionId)}/wrong-book`,
      'POST', { revision: scan.revision, saved });
  }
  explain(scan: Scan, questionId: string) {
    return this.request<{ scan: Scan }>(`/scans/${encodeURIComponent(scan.id)}/questions/${encodeURIComponent(questionId)}/explain`,
      'POST', { revision: scan.revision });
  }
  async reviewAnalysis(scan: Scan, questionId: string, input: TutoringReviewInput) {
    const setup = await this.request<{ questionReviewVersion?: number }>('/setup');
    if (setup.questionReviewVersion !== 1) throw new ApiError('家庭服务需要升级后才能保存分析核对，当前结果仍保留', 503);
    const result = scan.questions.find(q => q.id === questionId)?.tutoring?.result;
    if (!result) throw new ApiError('请先取得这道题的分析结果', 400);
    return this.request<{ scan: Scan }>(`/scans/${encodeURIComponent(scan.id)}/questions/${encodeURIComponent(questionId)}/analysis-review`,
      'POST', { revision: scan.revision, resultGeneratedAt: result.generatedAt, ...input });
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
