import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [action, grantPath, resultPath] = process.argv.slice(2);
if (!['pull', 'submit'].includes(action) || !grantPath)
  throw new Error(
    '用法：node scripts/prism-review-cli.mjs pull 授权文件；或 submit 授权文件 结果JSON',
  );
const grant = JSON.parse(await readFile(resolve(grantPath), 'utf8')),
  base = new URL(grant.baseUrl);
const localTest =
  process.env.PRISM_ALLOW_LOCAL_TEST === 'true' &&
  base.protocol === 'http:' &&
  base.hostname === '127.0.0.1' &&
  base.pathname === '/family-learning/api/external-review' &&
  !base.username &&
  !base.password &&
  !base.search &&
  !base.hash;
if (
  (!localTest &&
    base.href !==
      'https://123.207.232.151/family-learning/api/external-review') ||
  !/^[a-f0-9]{64}$/.test(grant.token || '') ||
  !/^[a-f0-9-]{36}$/.test(grant.batchId || '') ||
  Number(grant.expiresAt) <= Date.now()
)
  throw new Error('授权文件无效、地址不符或已过期');
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../temp/pc-review',
  grant.batchId,
);
async function request(path, body) {
  const response = await fetch(base.href + '/' + path, {
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + grant.token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '复核接口不可用');
  }
  return response;
}
const batch = await (await request('batch')).json();
if (batch.id !== grant.batchId) throw new Error('批次身份不匹配');
if (action === 'pull') {
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(join(output, 'batch.json'), JSON.stringify(batch, null, 2), {
    mode: 0o600,
  });
  for (const item of batch.items) {
    if (!/^[a-f0-9-]{36}$/.test(item.id)) throw new Error('复核题目编号无效');
    const material = await (await request('items/' + item.id)).json(),
      response = await request('items/' + item.id + '/image');
    if (!response.headers.get('content-type')?.startsWith('image/jpeg'))
      throw new Error('题图格式无效');
    await writeFile(
      join(output, item.id + '.jpg'),
      new Uint8Array(await response.arrayBuffer()),
      { mode: 0o600 },
    );
    await writeFile(
      join(output, item.id + '.json'),
      JSON.stringify(material, null, 2),
      { mode: 0o600 },
    );
  }
  console.log(
    JSON.stringify(
      {
        directory: output,
        count: batch.items.length,
        instructions:
          '先实际查看每张jpg，按batch.json说明独立求解和核对。结果写为{"items":[{"id":"...","fingerprint":"...","provider":"codex","model":"实际模型或unknown","summary":"修正说明","knowledgePoints":[],"result":{"transcribedPrompt":"","referenceAnswer":"","explanation":"","answerEvidence":[],"errorHypotheses":[],"uncertainties":[]}}]}。模型结果是待核对提案，不代表已应用。',
      },
      null,
      2,
    ),
  );
} else {
  if (!resultPath) throw new Error('缺少结果JSON路径');
  const document = JSON.parse(await readFile(resolve(resultPath), 'utf8'));
  if (
    !Array.isArray(document.items) ||
    !document.items.length ||
    document.items.length > 100
  )
    throw new Error('结果需包含1至100项');
  const saved = [],
    failed = [];
  for (const item of document.items) {
    try {
      if (!batch.items.some((i) => i.id === item.id))
        throw new Error('题目不属于当前批次');
      const local = JSON.parse(
        await readFile(join(output, item.id + '.json'), 'utf8'),
      );
      if (local.fingerprint !== item.fingerprint)
        throw new Error('题目版本不匹配，请重新读取');
      const { id, ...body } = item;
      const result = await (
        await request('items/' + id + '/proposal', body)
      ).json();
      saved.push({ id, status: result.status });
    } catch (error) {
      failed.push({ id: item.id, error: error.message });
    }
  }
  console.log(
    JSON.stringify(
      {
        saved,
        failed,
        message: '提交成功项已保存为待核对提案，管理员确认应用后才更新原题。',
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
}
