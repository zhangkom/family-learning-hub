import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { sharp } from './sharp';
const run = promisify(execFile);
let server: Server, root: string, batchId: string, itemId: string, grantPath: string, output: string, jpeg: Uint8Array, client: Client | undefined;
let cap = true, failPart = -1, proposals = 0;
const fingerprint = 'f'.repeat(64), env = () => ({ ...process.env, PRISM_ALLOW_LOCAL_TEST: 'true' });
beforeEach(async () => {
  await mkdir(resolve('work'), { recursive: true }); root = await mkdtemp(resolve('work/review-tools-')); batchId = randomUUID(); itemId = randomUUID(); cap = true; failPart = -1; proposals = 0;
  output = resolve('temp/pc-review', batchId); grantPath = join(root, 'synthetic-grant.json');
  jpeg = new Uint8Array(await sharp({ create: { width: 40, height: 40, channels: 3, background: 'white' } }).jpeg().toBuffer());
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1'), path = url.pathname.split('/external-review/')[1];
    const send = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer ' + 'a'.repeat(64)) { res.statusCode = 401; return send({ error: 'unauthorized' }); }
    if (path === 'batch') return send({ id: batchId, expiresAt: Date.now() + 60000, ...(cap ? { imagePartsVersion: 1 } : {}), items: [{ id: itemId, number: '1', status: 'pending' }] });
    if (path === `items/${itemId}`) return send({ id: itemId, fingerprint });
    if (path === `items/${itemId}/images`) return send({ parts: [0, 1, 2].map(index => ({ index, size: jpeg.byteLength })) });
    if (path === `items/${itemId}/image`) {
      if (url.searchParams.has('part') && Number(url.searchParams.get('part')) === failPart) { res.statusCode = 503; return send({ error: 'synthetic failed part' }); }
      res.setHeader('content-type', 'image/jpeg'); return res.end(jpeg);
    }
    if (path === `items/${itemId}/proposal`) { proposals++; return send({ id: itemId, status: 'proposed', proposalHash: 'synthetic' }); }
    res.statusCode = 404; send({ error: 'not found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  await writeFile(grantPath, JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}/family-learning/api/external-review`, token: 'a'.repeat(64), batchId, expiresAt: Date.now() + 60000 }));
});
afterEach(async () => {
  await client?.close(); client = undefined; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  expect(root.startsWith(resolve('work') + sep)).toBe(true); expect(output).toBe(resolve('temp/pc-review', batchId));
  await rm(root, { recursive: true, force: true }); await rm(output, { recursive: true, force: true });
});
describe('actual desktop review tools', () => {
  it('CLI saves all parts, marks interruption incomplete and refuses submission until a complete pull', async () => {
    const cli = resolve('scripts/prism-review-cli.mjs');
    const pulled = JSON.parse((await run(process.execPath, [cli, 'pull', grantPath], { env: env(), windowsHide: true })).stdout); expect(pulled.count).toBe(1);
    expect(JSON.parse(await readFile(join(output, itemId + '.json'), 'utf8')).imageFiles).toHaveLength(3);
    failPart = 1; await expect(run(process.execPath, [cli, 'pull', grantPath], { env: env(), windowsHide: true })).rejects.toThrow();
    expect(JSON.parse(await readFile(join(output, 'pull-status.json'), 'utf8')).status).toBe('downloading');
    const result = join(root, 'result.json'); await writeFile(result, JSON.stringify({ items: [{ id: itemId, fingerprint }] }));
    await expect(run(process.execPath, [cli, 'submit', grantPath, result], { env: env(), windowsHide: true })).rejects.toThrow('尚未完整下载'); expect(proposals).toBe(0);
    cap = false; failPart = -1; await run(process.execPath, [cli, 'pull', grantPath], { env: env(), windowsHide: true });
    expect(JSON.parse(await readFile(join(output, itemId + '.json'), 'utf8')).imageFiles).toEqual([itemId + '.jpg']);
  }, 20000);
  it('MCP exposes every part and only permits proposing after the entire read succeeds', async () => {
    client = new Client({ name: 'synthetic-review-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('scripts/prism-review-mcp.mjs'), grantPath], env: env() as Record<string, string> }));
    failPart = 1; expect((await client.callTool({ name: 'get_question', arguments: { itemId } })).isError).toBe(true);
    expect((await client.callTool({ name: 'submit_review', arguments: { itemId, fingerprint } })).isError).toBe(true); expect(proposals).toBe(0);
    failPart = -1; const question = await client.callTool({ name: 'get_question', arguments: { itemId } });
    expect(question.isError).toBeUndefined(); expect((question.content as { type: string }[]).filter(content => content.type === 'image')).toHaveLength(3);
    expect((await client.callTool({ name: 'submit_review', arguments: { itemId, fingerprint } })).isError).toBeUndefined(); expect(proposals).toBe(1);
  }, 20000);
});
