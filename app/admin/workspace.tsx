'use client';
/* eslint-disable next/no-img-element -- Private cookie-authenticated images must bypass the public image optimizer. */
import { useEffect, useState } from 'react';
import { appPath } from '@/lib/deployment';
import { scanSubjects } from '@/lib/scans';
import type {
  AdminAccount,
  AdminQuestion,
  AdminUserDetail,
  ReviewBatch,
  ReviewItem,
} from '@/lib/admin';
import './workspace.css';

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(appPath('/api/admin/' + path), {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(45000),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new RequestError(data.error || '请求失败', response.status);
  return data as T;
}
function useData<T>(path: string, revision = 0) {
  const key = path + '@' + revision;
  const [state, setState] = useState<{ key: string; data?: T; error: string }>({
    key: '',
    error: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    void api<T>(
      path,
      undefined,
      AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: '' });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setState({ key, error: e.message });
      });
    return () => controller.abort();
  }, [path, key]);
  return state.key === key ? state : { data: undefined, error: '' };
}
function Raw({
  value,
  label = '查看完整记录',
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <details className="adm-raw">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
function Paging({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="adm-paging">
      <span>
        共 {total} 项 · 第 {page} 页
      </span>
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <button disabled={page * 30 >= total} onClick={() => onPage(page + 1)}>
        下一页
      </button>
    </div>
  );
}
function Image({
  q,
  source,
}: {
  q: Pick<AdminQuestion, 'accountId' | 'scanId' | 'question'>;
  source?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="adm-error">题图读取失败，请刷新；原件仍保留。</p>
  ) : (
    <img
      className="adm-question-image"
      loading="lazy"
      alt="原题截图，含关联题干和配图"
      src={
        source ||
        appPath(
          '/api/admin/question-image?' +
            new URLSearchParams({
              accountId: q.accountId,
              scanId: q.scanId,
              questionId: q.question.id,
            }),
        )
      }
      onError={() => setFailed(true)}
    />
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="adm-panel adm-login"
      onSubmit={async (e) => {
        e.preventDefault();
        const values = new FormData(e.currentTarget);
        setBusy(true);
        setMessage('');
        try {
          const response = await fetch(appPath('/api/family/login'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: values.get('username'),
              password: values.get('password'),
            }),
          });
          const data = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(data.error || '登录失败');
          onLogin();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>管理员登录</h2>
      <p>管理用户、查看题目和集中复核。</p>
      <label>
        账号
        <input
          name="username"
          defaultValue="admin"
          autoComplete="username"
          required
        />
      </label>
      <label>
        密码
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="adm-primary" disabled={busy}>
        {busy ? '正在登录…' : '登录'}
      </button>
      {message && (
        <p role="alert" className="adm-error">
          {message}
        </p>
      )}
    </form>
  );
}
function Password({
  onDone,
  initial = false,
}: {
  onDone: () => void;
  initial?: boolean;
}) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="adm-panel adm-login"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = new FormData(e.currentTarget);
        if (v.get('password') !== v.get('repeat')) {
          setMessage('两次新密码不一致');
          return;
        }
        setBusy(true);
        try {
          await api('password', {
            currentPassword: v.get('current'),
            password: v.get('password'),
          });
          onDone();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{initial ? '请先设置管理员密码' : '修改管理员密码'}</h2>
      <p>新密码至少5个字符，修改后重新登录。</p>
      <label>
        当前密码
        <input
          type="password"
          name="current"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        新密码
        <input
          type="password"
          name="password"
          minLength={5}
          maxLength={128}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        再输入一次
        <input
          type="password"
          name="repeat"
          minLength={5}
          autoComplete="new-password"
          required
        />
      </label>
      <button className="adm-primary" disabled={busy}>
        保存并重新登录
      </button>
      {message && (
        <p className="adm-error" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
function Overview() {
  const { data, error } = useData<Record<string, number>>('overview');
  return (
    <>
      {error && (
        <p role="alert" className="adm-error">
          {error}
        </p>
      )}
      <div className="adm-stats">
        {[
          ['users', '普通用户'],
          ['administrators', '管理员'],
          ['students', '学生'],
          ['questions', '题目'],
          ['cloudPhotos', '云盘原图'],
        ].map(([k, label]) => (
          <div key={k}>
            <strong>{data?.[k] ?? '—'}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}
const labelValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function UserCollection({
  id,
  collection,
}: {
  id: string;
  collection: string;
}) {
  const [page, setPage] = useState(1),
    { data, error } = useData<{
      items: Record<string, unknown>[];
      total: number;
    }>('accounts/' + id + '/' + collection + '?page=' + page);
  return (
    <>
      {error && <p className="adm-error">{error}</p>}
      {!data && !error && <p>正在读取…</p>}
      {data && (
        <>
          <div className="adm-grid">
            {data.items.map((item, i) => (
              <article className="adm-card" key={labelValue(item.id || i)}>
                <strong>
                  {labelValue(
                    item.originalName ||
                      item.title ||
                      item.subject ||
                      '学习记录',
                  )}
                </strong>
                <p>
                  {labelValue(item.status || item.source || item.mode || '')}
                </p>
                <small>
                  {labelValue(item.createdAt || item.updatedAt || '')}
                </small>
                {collection === 'photos' && typeof item.id === 'string' && (
                  <a
                    href={appPath(
                      `/api/admin/accounts/${id}/photos/${item.id}/file`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      loading="lazy"
                      alt={labelValue(item.originalName || '云盘原图')}
                      src={appPath(
                        `/api/admin/accounts/${id}/photos/${item.id}/thumbnail`,
                      )}
                    />
                    <span>查看原图</span>
                  </a>
                )}
                <Raw value={item} label="展开完整记录" />
              </article>
            ))}
          </div>
          {!data.items.length && <p>暂无记录</p>}
          <Paging page={page} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
function UserDetail({
  id,
  onQuestions,
}: {
  id: string;
  onQuestions: (id: string) => void;
}) {
  const { data, error } = useData<AdminUserDetail>('accounts/' + id),
    [tab, setTab] = useState('profile');
  return (
    <section className="adm-panel">
      {error && <p className="adm-error">{error}</p>}
      {data ? (
        <>
          <div className="adm-heading">
            <h2>{data.account.username}</h2>
            <button onClick={() => onQuestions(id)}>查看该用户全部题目</button>
          </div>
          <p>
            注册于 {new Date(data.account.createdAt).toLocaleString('zh-CN')} ·{' '}
            {data.account.administrator ? '管理员' : '普通用户'} ·{' '}
            {data.account.questions} 道题 · {data.account.cloudPhotos}{' '}
            张云盘原图
          </p>
          <div className="adm-tabs">
            {[
              ['profile', '学生与资料'],
              ['scans', '上传资料'],
              ['photos', '云盘图片'],
              ['learning', '练习记录'],
              ['weakness', '能力分析'],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'profile' ? (
            <>
              <div className="adm-grid">
                {data.students.map((s) => (
                  <article className="adm-card" key={s.id}>
                    <h3>{s.name}</h3>
                    <p>{s.grade || '年级未填写'}</p>
                    <small>
                      建档于 {new Date(s.createdAt).toLocaleDateString('zh-CN')}
                    </small>
                  </article>
                ))}
              </div>
              {data.students.length === 0 && <p>尚未建立学生档案</p>}
              <Raw value={data.learning} label="查看完整家庭学习记录" />
            </>
          ) : (
            <UserCollection key={id + tab} id={id} collection={tab} />
          )}
        </>
      ) : (
        !error && <p>正在读取用户资料…</p>
      )}
    </section>
  );
}
function Users({ onQuestions }: { onQuestions: (id: string) => void }) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [id, setId] = useState('');
  const { data, error } = useData<{ items: AdminAccount[]; total: number }>(
    'accounts?' + new URLSearchParams({ search, page: String(page) }),
  );
  return (
    <>
      <section className="adm-panel">
        <div className="adm-heading">
          <h2>用户管理</h2>
          <input
            aria-label="搜索账号"
            placeholder="搜索账号"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-grid">
          {data?.items.map((a) => (
            <button
              className={'adm-card ' + (a.id === id ? 'is-selected' : '')}
              key={a.id}
              onClick={() => setId(a.id)}
            >
              <strong>{a.username}</strong>
              <span>
                {a.administrator ? '管理员' : `${a.students} 名学生`} ·{' '}
                {a.questions} 道题
              </span>
              <small>
                {a.cloudPhotos} 张云盘原图 · {a.learningSessions} 次练习
              </small>
            </button>
          ))}
        </div>
        {data && <Paging page={page} total={data.total} onPage={setPage} />}
      </section>
      {id && <UserDetail key={id} id={id} onQuestions={onQuestions} />}
    </>
  );
}
function Questions({
  accountId,
  onBatch,
}: {
  accountId: string;
  onBatch: (id: string) => void;
}) {
  const [page, setPage] = useState(1),
    [subject, setSubject] = useState(''),
    [state, setState] = useState(''),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<Record<string, AdminQuestion>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const { data, error } = useData<{ items: AdminQuestion[]; total: number }>(
    'questions?' +
      new URLSearchParams({
        page: String(page),
        accountId,
        subject,
        state,
        search,
      }),
  );
  const key = (q: AdminQuestion) =>
    JSON.stringify([q.accountId, q.scanId, q.question.id]);
  const choose = (q: AdminQuestion, checked: boolean) =>
    setSelected((old) => {
      const next = { ...old };
      if (checked) next[key(q)] = q;
      else delete next[key(q)];
      return next;
    });
  return (
    <section className="adm-panel">
      <div className="adm-heading">
        <h2>{accountId ? '所选用户题目' : '全部用户题目'}</h2>
        <span>共 {data?.total ?? '—'} 道</span>
      </div>
      <div className="adm-filters">
        <input
          aria-label="搜索题干"
          placeholder="搜索题干"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="学科"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部学科</option>
          {scanSubjects.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="解析状态"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部题目</option>
          <option value="unanswered">尚无答案</option>
          <option value="flagged">解析有疑问</option>
          <option value="saved">已收错题本</option>
        </select>
      </div>
      <div className="adm-selection">
        <button
          onClick={() => data?.items.forEach((q) => choose(q, true))}
          disabled={!data?.items.length}
        >
          选中本页
        </button>
        <button
          onClick={() => setSelected({})}
          disabled={!Object.keys(selected).length}
        >
          清空选择
        </button>
        <strong>已选 {Object.keys(selected).length} 道</strong>
        <button
          className="adm-primary"
          disabled={busy || !Object.keys(selected).length}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              const batch = await api<ReviewBatch>('batches', {
                title: '集中复核 ' + new Date().toLocaleString('zh-CN'),
                items: Object.values(selected).map((q) => ({
                  accountId: q.accountId,
                  scanId: q.scanId,
                  questionId: q.question.id,
                })),
              });
              onBatch(batch.id);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          创建复核批次
        </button>
      </div>
      {(message || error) && (
        <p role="alert" className="adm-error">
          {message || error}
        </p>
      )}
      {!data && !error && <p>正在读取题目…</p>}
      {data?.items.map((q) => (
        <article className="adm-question" key={key(q)}>
          <div className="adm-heading">
            <label>
              <input
                type="checkbox"
                checked={!!selected[key(q)]}
                onChange={(e) => choose(q, e.target.checked)}
              />
              {q.question.subject || '科目待确认'} · 第{' '}
              {q.question.number || '未标号'} 题
            </label>
            <span>
              {q.username} / {q.studentName}
            </span>
          </div>
          <p className="adm-muted">
            {q.originalName} · {q.source}
          </p>
          <Image q={q} />
          <p className="adm-prose">{q.question.prompt}</p>
          <details>
            <summary>查看当前答案与解析</summary>
            <p className="adm-prose">
              {q.question.tutoring?.result?.referenceAnswer ||
                q.question.referenceAnswer ||
                '暂无答案'}
            </p>
            <p className="adm-prose">
              {q.question.tutoring?.result?.explanation ||
                q.question.explanation ||
                '暂无解析'}
            </p>
          </details>
        </article>
      ))}
      {data && !data.items.length && <p>暂无符合条件的题目</p>}
      {data && <Paging page={page} total={data.total} onPage={setPage} />}
    </section>
  );
}
function ResultCard({
  item,
  batchId,
  onChange,
}: {
  item: ReviewItem;
  batchId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [updatePrompt, setUpdatePrompt] = useState(false),
    q = item.snapshot.question,
    p = item.proposal;
  const action = async (name: 'apply' | 'rollback') => {
    setBusy(true);
    setMessage('');
    try {
      await api(
        `batches/${batchId}/items/${item.id}/${name}`,
        name === 'apply'
          ? { proposalHash: item.proposalHash, updatePrompt }
          : {},
      );
      onChange();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="adm-question">
      <div className="adm-heading">
        <h3>
          {q.subject} · 第 {q.number || '未标号'} 题
        </h3>
        <span>
          {
            {
              pending: '待复核',
              proposed: '待核对应用',
              applied: '已应用',
              rolled_back: '已回退',
            }[item.status]
          }
        </span>
      </div>
      <Image
        q={{ accountId: item.accountId, scanId: item.scanId, question: q }}
        source={appPath(`/api/admin/batches/${batchId}/items/${item.id}/image`)}
      />
      {p ? (
        <>
          <p>
            <strong>
              {p.provider} / {p.model}
            </strong>{' '}
            · {p.summary}
          </p>
          <div className="adm-compare">
            <section>
              <h4>原题干、答案与解析</h4>
              <p className="adm-prose">{q.prompt}</p>
              <p className="adm-prose">
                {q.tutoring?.result?.referenceAnswer ||
                  q.referenceAnswer ||
                  '暂无答案'}
              </p>
              <p className="adm-prose">
                {q.tutoring?.result?.explanation || q.explanation || '暂无解析'}
              </p>
            </section>
            <section>
              <h4>复核题干、答案与解析</h4>
              <p className="adm-prose">{p.result.transcribedPrompt}</p>
              <p className="adm-prose">
                {p.result.referenceAnswer || '条件不足，待补充'}
              </p>
              <p className="adm-prose">{p.result.explanation}</p>
              <p>知识点：{p.knowledgePoints.join('、') || '未识别'}</p>
              <details>
                <summary>转写、作答证据和不确定项</summary>
                <Raw value={p.result} />
              </details>
            </section>
          </div>
          {item.status === 'proposed' &&
            p.result.transcribedPrompt !== q.prompt && (
              <label className="adm-prompt-option">
                <input
                  type="checkbox"
                  checked={updatePrompt}
                  onChange={(e) => setUpdatePrompt(e.target.checked)}
                />
                同时采用已核对的复核题干（关联小问需要重新核对）
              </label>
            )}
          {item.status === 'proposed' && (
            <button
              className="adm-primary"
              disabled={busy}
              onClick={() => void action('apply')}
            >
              确认并应用到原题
            </button>
          )}
          {item.status === 'applied' && (
            <button disabled={busy} onClick={() => void action('rollback')}>
              回退本次修改
            </button>
          )}
        </>
      ) : (
        <p>等待电脑端读取本题并提交复核结果。</p>
      )}
      {message && (
        <p role="alert" className="adm-error">
          {message}
        </p>
      )}
    </article>
  );
}
function BatchDetail({ id }: { id: string }) {
  const [now] = useState(() => Date.now());
  const [revision, setRevision] = useState(0),
    { data, error } = useData<ReviewBatch>('batches/' + id, revision),
    [message, setMessage] = useState(''),
    [grant, setGrant] = useState<{
      token: string;
      batchId: string;
      expiresAt: number;
    }>(),
    [busy, setBusy] = useState(false),
    [input, setInput] = useState('');
  const reload = () => setRevision((v) => v + 1);
  const downloadGrant = () => {
    if (!grant) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            baseUrl: location.origin + appPath('/api/external-review'),
            ...grant,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const u = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = u;
    a.download = 'knowledge-prism-review-' + id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };
  return (
    <section className="adm-panel">
      <div className="adm-heading">
        <h2>{data?.title || '复核批次'}</h2>
        <button onClick={reload}>刷新结果</button>
      </div>
      {error && <p className="adm-error">{error}</p>}
      {data && (
        <>
          <p>
            {data.items.length} 道题 ·{' '}
            {data.items.filter((i) => i.status === 'applied').length} 道已应用 ·{' '}
            {data.revoked
              ? '已关闭'
              : `批次有效至 ${new Date(data.expiresAt).toLocaleString('zh-CN')}`}
          </p>
          <div className="adm-actions">
            <button
              className="adm-primary"
              disabled={busy || data.revoked || data.expiresAt <= now}
              onClick={async () => {
                setBusy(true);
                try {
                  setGrant(await api('batches/' + id + '/token', {}));
                  setMessage('');
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              连接电脑 Codex
            </button>
            <button
              disabled={busy || data.revoked}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('batches/' + id + '/revoke', {});
                  setGrant(undefined);
                  reload();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              关闭外部复核授权
            </button>
          </div>
          {grant && !data.revoked && (
            <div className="adm-notice">
              <strong>本批次专用授权，有效12小时</strong>
              <p>
                下载授权文件后，在已登录的 Codex
                中提供文件路径，让它使用知识棱镜复核工具处理本批题目。授权仅可读本批题图、提交结果，不能查看账号或直接应用结果。
              </p>
              <button onClick={downloadGrant}>下载电脑复核授权文件</button>
              <p className="adm-muted">
                授权文件仅在你的电脑保存，请勿公开分享。过期可重新授权。
              </p>
            </div>
          )}
          <details className="adm-import">
            <summary>导入电脑端复核结果</summary>
            <p>
              工具可直接提交；离线结果也可按约定JSON导入。每题单独保存，失败不影响已导入项。
            </p>
            <textarea
              aria-label="复核结果JSON"
              rows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                '{"items":[{"id":"复核题编号","fingerprint":"题目校验值","provider":"codex", ...}]}'
              }
            />
            <button
              disabled={busy || !input.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const parsed = JSON.parse(input);
                  if (
                    !Array.isArray(parsed.items) ||
                    !parsed.items.length ||
                    parsed.items.length > 100
                  )
                    throw new Error('需要包含1至100项的items数组');
                  let done = 0;
                  const failures: string[] = [];
                  for (const value of parsed.items) {
                    const { id: itemId, ...body } = value;
                    try {
                      await api(
                        `batches/${id}/items/${encodeURIComponent(itemId)}/proposal`,
                        body,
                      );
                      done++;
                    } catch (e) {
                      failures.push(`${itemId}: ${(e as Error).message}`);
                    }
                  }
                  setMessage(
                    `已导入 ${done} 道${failures.length ? '；' + failures.join('；') : ''}`,
                  );
                  reload();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              导入为待核对结果
            </button>
          </details>
          {message && <output>{message}</output>}
          {data.items.map((item) => (
            <ResultCard
              key={item.id}
              item={item}
              batchId={id}
              onChange={reload}
            />
          ))}
        </>
      )}
    </section>
  );
}
function Batches({ initial }: { initial: string }) {
  const [id, setId] = useState(initial),
    [page, setPage] = useState(1),
    { data, error } = useData<{
      total: number;
      items: {
        id: string;
        title: string;
        createdAt: number;
        revoked: number;
      }[];
    }>('batches?page=' + page);
  return (
    <>
      {id && <BatchDetail key={id} id={id} />}
      <section className="adm-panel">
        <h2>复核批次记录</h2>
        {error && <p className="adm-error">{error}</p>}
        {data?.items.map((b) => (
          <button className="adm-batch" key={b.id} onClick={() => setId(b.id)}>
            <strong>{b.title}</strong>
            <span>
              {new Date(b.createdAt).toLocaleString('zh-CN')} ·{' '}
              {b.revoked ? '授权已关闭' : '查看进度'}
            </span>
          </button>
        ))}
        {data && <Paging page={page} total={data.total} onPage={setPage} />}
      </section>
    </>
  );
}
function Audit() {
  const [page, setPage] = useState(1),
    { data, error } = useData<{
      total: number;
      items: {
        id: number;
        actor: string;
        action: string;
        target: string;
        createdAt: number;
      }[];
    }>('audit?page=' + page);
  return (
    <section className="adm-panel">
      <h2>管理操作记录</h2>
      {error && <p className="adm-error">{error}</p>}
      {data?.items.map((a) => (
        <p className="adm-audit" key={a.id}>
          {new Date(a.createdAt).toLocaleString('zh-CN')} · {a.actor}
          <br />
          {a.action} · {a.target}
        </p>
      ))}
      {data && <Paging page={page} total={data.total} onPage={setPage} />}
    </section>
  );
}
export default function AdminWorkspace() {
  const [session, setSession] = useState<{
      id: string;
      username: string;
      mustChangePassword: boolean;
    } | null>(),
    [message, setMessage] = useState(''),
    [tab, setTab] = useState('users'),
    [account, setAccount] = useState(''),
    [batch, setBatch] = useState('');
  const refresh = async () => {
    setSession(undefined);
    setMessage('');
    try {
      setSession(
        (await api<{ user: NonNullable<typeof session> }>('session')).user,
      );
    } catch (e) {
      setSession(null);
      if ((e as RequestError).status !== 401) setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    void api<{ user: NonNullable<typeof session> }>(
      'session',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setSession(data.user);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setSession(null);
          if (e.status !== 401) setMessage(e.message);
        }
      });
    return () => controller.abort();
  }, []);
  const logout = async () => {
    try {
      await fetch(appPath('/api/family/logout'), {
        method: 'POST',
        credentials: 'same-origin',
      });
    } finally {
      setSession(null);
      setTab('users');
      setAccount('');
      setBatch('');
    }
  };
  return (
    <main className="adm-shell">
      <header className="adm-brand">
        <div>
          <span>知识棱镜AI</span>
          <h1>管理工作台</h1>
        </div>
        {session && (
          <div className="adm-actions">
            <span>{session.username}</span>
            <button onClick={() => setTab('password')}>修改密码</button>
            <button onClick={() => void logout()}>退出登录</button>
          </div>
        )}
      </header>
      {message && (
        <p className="adm-error" role="alert">
          {message}
        </p>
      )}
      {session === undefined ? (
        <p>正在确认管理权限…</p>
      ) : session === null ? (
        <Login onLogin={() => void refresh()} />
      ) : session.mustChangePassword ? (
        <Password initial onDone={() => setSession(null)} />
      ) : (
        <>
          <nav className="adm-main-tabs">
            {[
              ['users', '用户管理'],
              ['questions', '全部题目'],
              ['batches', '集中复核'],
              ['audit', '操作记录'],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => {
                  setTab(key);
                  if (key === 'questions') setAccount('');
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <Overview />
          {tab === 'users' && (
            <Users
              onQuestions={(id) => {
                setAccount(id);
                setTab('questions');
              }}
            />
          )}
          {tab === 'questions' && (
            <Questions
              key={account}
              accountId={account}
              onBatch={(id) => {
                setBatch(id);
                setTab('batches');
              }}
            />
          )}
          {tab === 'batches' && <Batches initial={batch} />}{' '}
          {tab === 'audit' && <Audit />}
          {tab === 'password' && <Password onDone={() => setSession(null)} />}
        </>
      )}
    </main>
  );
}
