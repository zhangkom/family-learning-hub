import { describe, it, expect } from 'vitest';
import { captureFailure } from './permissions';
describe('photo permission and cancellation recovery', () => {
  it('treats a user cancellation as normal', () => {
    expect(captureFailure({ code: 'OS-PLUG-CAMR-0006' }, 'camera')).toBeNull();
    expect(captureFailure({ code: 'OS-PLUG-CAMR-0020' }, 'gallery')).toBeNull();
  });
  it('offers a photo alternative without making unrelated permissions mandatory', () => {
    expect(captureFailure({ code: 'OS-PLUG-CAMR-0003' }, 'camera')).toContain('从相册选图');
    expect(captureFailure({ code: 'OS-PLUG-CAMR-0005' }, 'gallery')).toContain('其他功能仍可使用');
  });
});
