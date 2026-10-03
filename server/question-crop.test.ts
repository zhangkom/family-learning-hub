import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharp } from './sharp';
import { cropQuestionImage, cropQuestionImages } from './question-crop';
import { explainQuestion, recognizeModel } from './model-gateway';
import type { Question } from '../lib/mobile';
import type { ScanRecord } from '../lib/scans';
const question: Question = { id: 'q', number: '1', subject: '数学', prompt: '题目定位摘要：合成跨页材料', diagram: '', confirmed: true, regions: [{ id: 'r', kind: 'stem', x: 0, y: 0, width: 1, height: 1 }], answerSteps: [], knowledgePoints: [], uncertainties: [] };
const record: ScanRecord = { id: 'synthetic', subject: '数学', source: '合成QA', originalName: 'synthetic.jpg', mimeType: 'image/jpeg', size: 0, status: 'ready', createdAt: '', fileUrl: '', revision: 1, structuredQuestions: [question] };
function model(protocol = 'chat-completions') {
  vi.stubEnv('FAMILY_RECOGNITION_ENABLED', 'true'); vi.stubEnv('FAMILY_AI_API_KEY', 'synthetic'); vi.stubEnv('FAMILY_AI_BASE_URL', 'https://model.example/v1'); vi.stubEnv('FAMILY_AI_MODEL', 'synthetic-vision'); vi.stubEnv('FAMILY_AI_PROTOCOL', protocol);
  const result = { questions: [{ transcribedPrompt: '合成完整转录', referenceAnswer: '', explanation: '缺条件待核对', answerEvidence: [], errorHypotheses: [], uncertainties: ['待核对'] }] };
  const fetcher = vi.fn(async () => Response.json(protocol === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] } : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('complete readable question images', () => {
  it('keeps distant selected regions without including an unrelated middle question', async () => {
    const bytes = await sharp({ create: { width: 300, height: 900, channels: 3, background: '#00ff00' } }).composite([
      { input: await sharp({ create: { width: 300, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0000ff' } }).png().toBuffer(), top: 700, left: 0 },
    ]).png().toBuffer();
    const q = { ...question, regions: [{ ...question.regions[0], height: 2 / 9 }, { ...question.regions[0], id: 'r2', y: 7 / 9, height: 2 / 9 }] };
    const before = JSON.stringify(q), parts = await cropQuestionImages(bytes, q, [q]); expect(parts).toHaveLength(2);
    const colors = await Promise.all(parts.map(async image => (await sharp(image).stats()).channels.map(c => c.mean)));
    expect(colors[0][0]).toBeGreaterThan(240); expect(colors[0][1]).toBeLessThan(10); expect(colors[1][2]).toBeGreaterThan(240);
    const full = await sharp(await cropQuestionImage(bytes, q, [q])).metadata(); expect(full.height).toBe(424); expect(JSON.stringify(q)).toBe(before);
  });
  it('preserves readable width and sends every ordered long-image part to explanation', async () => {
    const bytes = await sharp({ create: { width: 1200, height: 7000, channels: 3, background: 'white' } }).png().toBuffer();
    const parts = await cropQuestionImages(bytes, question, [question]); expect(parts).toHaveLength(3);
    const sizes = await Promise.all(parts.map(part => sharp(part).metadata())); expect(sizes.every(m => m.width === 1200 && m.height! <= 2400)).toBe(true); expect(sizes.at(-1)!.height).toBe(2392);
    expect((await sharp(await cropQuestionImage(bytes, question, [question])).metadata()).height).toBe(7000);
    const fetcher = model(); await explainQuestion(record, bytes, 'q');
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const images = body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url'); expect(images).toHaveLength(3);
    expect(images.every((part: { image_url: { detail: string } }) => part.image_url.detail === 'high')).toBe(true);
  });
  it.each(['chat-completions', 'responses'])('retains all images with high detail for %s', async protocol => {
    const fetcher = model(protocol); await recognizeModel(record, [new Uint8Array([1]), new Uint8Array([2])], {}, '合成检查');
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const images = (protocol === 'responses' ? body.input[0].content : body.messages[1].content).filter((part: { type: string }) => ['input_image', 'image_url'].includes(part.type));
    expect(images).toHaveLength(2); expect(images.map((part: { detail?: string; image_url?: { detail: string } }) => part.detail || part.image_url?.detail)).toEqual(['high', 'high']);
  });
  it('rejects oversized image sets before making a model request, never silently truncating them', async () => {
    const fetcher = model(); await expect(recognizeModel(record, Array.from({ length: 25 }, () => new Uint8Array([1])), {}, '合成检查')).rejects.toThrow('未截断');
    await expect(recognizeModel(record, [new Uint8Array(25 * 1024 * 1024)], {}, '合成检查')).rejects.toThrow('未截断'); expect(fetcher).not.toHaveBeenCalled();
  });
});
