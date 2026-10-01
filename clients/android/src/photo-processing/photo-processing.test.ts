import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  available: true,
  plugin: { importPhoto: vi.fn(), getOriginal: vi.fn(), listOriginals: vi.fn(), process: vi.fn(), deleteOriginal: vi.fn() },
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => mocks.plugin,
  Capacitor: { getPlatform: () => mocks.available ? 'android' : 'web', isPluginAvailable: () => mocks.available,
    convertFileSrc: (value: string) => `https://localhost/_capacitor_file_${value.slice(7)}` },
}));
import { fullPage, mapPoint, pointerToImage, mapQuestionToOriginal, validateQuad } from './geometry';
import { deleteOriginal, importOriginal, preparePhoto, readConfirmedUpload, type OriginalPhoto, type PreparedPhoto } from './index';

const originalId = '11111111-1111-1111-1111-111111111111';
const outputId = '22222222-2222-2222-2222-222222222222';
const identity = [1,0,0,0,1,0,0,0,1] as const;
const original: OriginalPhoto = { schemaVersion: 1, originalId, studentId: 'student-1', sha256: 'a'.repeat(64), bytes: 1000,
  mime: 'image/jpeg', width: 3000, height: 4000, orientation: 6, uprightWidth: 4000, uprightHeight: 3000,
  originalUri: 'file:///private/original', previewUri: 'file:///private/preview.jpg', createdAt: 1 };
const prepared: PreparedPhoto = { schemaVersion: 1, algorithmVersion: 'android-photo-v1', originalId, studentId: original.studentId, outputId,
  sourceSha256: original.sha256, sha256: 'b'.repeat(64), bytes: 200, mime: 'image/jpeg', width: 2000, height: 1500,
  sourceWidth: 4000, sourceHeight: 3000, exifOrientation: 6, decodedWidth: 1500, decodedHeight: 2000,
  sourceSpace: 'exif-upright-normalized-edges', outputSpace: 'normalized-edges', corners: fullPage,
  quarterTurns: 0, enhancement: 'none', jpegQuality: 94, maxEdge: 3072, sourceToOutput: identity, outputToSource: identity,
  quality: { advisoryOnly: true, warnings: [], laplacianVariance: 42, darkFraction: .1, backgroundRange: 20, percentile10: 50, percentile90: 240 },
  createdAt: 2, uri: 'file:///private/result.jpg' };

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); mocks.available = true; mocks.plugin.process.mockResolvedValue(prepared); });

describe('preview and question coordinates', () => {
  it('accounts for portrait-image letterboxing in a wide viewport', () => {
    const viewport = { left: 10, top: 20, width: 400, height: 400 }, image = { width: 200, height: 400 };
    expect(pointerToImage(110, 20, viewport, image)).toEqual([0,0]);
    expect(pointerToImage(310, 420, viewport, image)).toEqual([1,1]);
    expect(pointerToImage(210, 220, viewport, image)).toEqual([.5,.5]);
    expect(pointerToImage(50, 100, viewport, image)).toBeNull();
  });
  it('maps a question through a clockwise rotation back to its original location', () => {
    const undoRotation = [0,1,0,-1,0,1,0,0,1] as const;
    expect(mapQuestionToOriginal(undoRotation, { x: .1, y: .2, width: .3, height: .4 }))
      .toEqual([.2,.9,.2,.6,.6000000000000001,.6,.6000000000000001,.9]);
  });
  it('does projective division instead of treating perspective as a linear scale', () => {
    const p = mapPoint([2,0,0,0,2,0,1,0,1], .5, .25);
    expect(p[0]).toBeCloseTo(2/3); expect(p[1]).toBeCloseTo(1/3);
  });
  it.each([
    [0,0,1,1,1,0,0,1], [0,0,0,1,1,1,1,0], [0,0,1,0,1,0,0,1],
    [0,0,NaN,0,1,1,0,1], [0,0,2,0,1,1,0,1], [0,0,.01,0,.01,.01,0,.01],
  ])('rejects unsafe quadrilateral %j', (...q) => expect(() => validateQuad(q)).toThrow());
});

describe('native preparation contract', () => {
  it('requires Android integration and does not pretend browser success', async () => {
    mocks.available = false;
    await expect(importOriginal('owner', 'content://media/1', original.studentId)).rejects.toThrow('尚未接入');
    expect(mocks.plugin.importPhoto).not.toHaveBeenCalled();
  });
  it('rejects server URLs and webPath instead of uploading/importing them', async () => {
    await expect(importOriginal('owner', 'https://example.test/image.jpg', original.studentId)).rejects.toThrow('原生 uri');
    expect(mocks.plugin.importPhoto).not.toHaveBeenCalled();
  });
  it('accepts the absolute native filesystem path returned by Camera 8.x', async () => {
    mocks.plugin.importPhoto.mockResolvedValue(original);
    await expect(importOriginal('owner', '/data/user/0/cn.familylearning.study/cache/photo.jpg', original.studentId))
      .resolves.toEqual(original);
    expect(mocks.plugin.importPhoto).toHaveBeenCalledWith({ owner: 'owner', studentId: original.studentId,
      uri: '/data/user/0/cn.familylearning.study/cache/photo.jpg' });
  });
  it('binds prepared bytes to the original and leaves originals intact', async () => {
    await expect(preparePhoto('owner', original)).resolves.toEqual(prepared);
    expect(mocks.plugin.deleteOriginal).not.toHaveBeenCalled();
    mocks.plugin.process.mockResolvedValue({ ...prepared, sourceSha256: 'c'.repeat(64) });
    await expect(preparePhoto('owner', original)).rejects.toThrow('不匹配');
  });
  it('does not allow options to replace the owner or original ID', async () => {
    await preparePhoto('owner', original, { owner: 'other', originalId: outputId } as never);
    expect(mocks.plugin.process.mock.calls[0][0]).toMatchObject({ owner: 'owner', originalId });
  });
  it('requires explicit preview confirmation before reading upload bytes', async () => {
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    await expect(readConfirmedUpload(prepared, false)).rejects.toThrow('预览');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('verifies the output hash and strips local paths from upload metadata', async () => {
    const bytes = new Uint8Array([255,216,255,217]);
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const result = await readConfirmedUpload({ ...prepared, bytes: 4, sha256: sha }, true);
    expect(result.file.type).toBe('image/jpeg');expect(result.file.size).toBe(4);
    expect(result.processing).not.toHaveProperty('uri');
    expect(JSON.stringify(result.processing)).not.toContain('file:');
    expect(mocks.plugin.deleteOriginal).not.toHaveBeenCalled();
    await expect(readConfirmedUpload({ ...prepared, bytes: 4 }, true)).rejects.toThrow('校验失败');
  });
  it('requires an explicit deletion action', async () => {
    await expect(deleteOriginal('owner', originalId, false)).rejects.toThrow('确认');
    expect(mocks.plugin.deleteOriginal).not.toHaveBeenCalled();
    await deleteOriginal('owner', originalId, true);
    expect(mocks.plugin.deleteOriginal).toHaveBeenCalledWith({ owner: 'owner', originalId, confirmDelete: true });
  });
});
