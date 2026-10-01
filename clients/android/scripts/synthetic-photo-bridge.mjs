// Browser-only synthetic native bridge. No device or image-quality claim; no external requests.
export function installSyntheticPhotoBridge({ api, initialToken = 'test-A', initialUserId = 'A', missingSourceUris = [] }) {
  localStorage.setItem('family-learning:server', api);
  const store = (key, value) => localStorage.setItem('host-test:' + key, JSON.stringify(value));
  const read = (key, fallback) => JSON.parse(localStorage.getItem('host-test:' + key) || JSON.stringify(fallback));
  if (localStorage.getItem('host-test:vault') === null) store('vault', JSON.stringify({ base: api, token: initialToken }));
  let processingDelay = 0;
  const listeners = new Map();
  const sourceKey = (owner, id) => 'original:' + JSON.stringify([owner, id]);
  const image = (jpeg = false) => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fffdf2'; ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = '#243e32'; ctx.font = '40px sans-serif'; ctx.fillText('合成验收 · 数学练习', 80, 120);
    ctx.font = '32px sans-serif'; ctx.fillText('1. 计算：x² + 2x + 1 = 0', 80, 240); ctx.fillText('2. 求 √(9 + 16)', 80, 400);
    ctx.strokeStyle = '#547e70'; ctx.strokeRect(90, 600, 500, 350);
    return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', .94);
  };
  const blob = data => { const [header, base64] = data.split(','); return new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: header.slice(5).split(';')[0] }); };
  const info = async data => { const file = blob(data); return { bytes: file.size, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('') }; };
  const uriFor = (owner, id, name) => 'file:///synthetic/' + encodeURIComponent(owner) + '/' + id + '/' + name;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (value.startsWith(location.origin + '/__native?')) {
      if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      const uri = new URL(value).searchParams.get('uri');
      return Promise.resolve(new Response(blob(read('file:' + uri, image())), { status: 200 }));
    }
    return realFetch(input, init);
  };
  window.androidBridge = {};
  window.Capacitor = {
    PluginHeaders: ['SessionVault', 'App', 'AppUpdater', 'Camera', 'AppSettings', ...(new URL(location.href).searchParams.has('legacy') ? [] : ['PhotoProcessing'])].map(name => ({ name, methods: [
      ...['get', 'set', 'clear', 'removeListener', 'takePhoto', 'chooseFromGallery', 'importPhoto', 'getOriginal', 'listOriginals', 'process', 'deleteOriginal'].map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' },
    ] })),
    convertFileSrc: uri => read('file:' + uri, image()),
    nativeCallback(plugin, method, args, callback) {
      const id = crypto.randomUUID(); listeners.set(id, { plugin, name: args.eventName, callback });
      if (plugin === 'App' && args.eventName === 'appRestoredResult') {
        const event = read('restore', null);
        if (event) { localStorage.removeItem('host-test:restore'); queueMicrotask(() => callback(event)); }
      }
      return id;
    },
    async nativePromise(plugin, method, args) {
      if (method === 'removeListener') { listeners.delete(args.callbackId); return {}; }
      if (plugin === 'SessionVault') {
        if (method === 'get') return { value: read('vault', '') };
        if (method === 'set') store('vault', args.value);
        if (method === 'clear') store('vault', '');
        return {};
      }
      if (plugin === 'Camera') {
        const photo = { uri: '/synthetic/camera.png', webPath: location.origin + '/__native?uri=input' };
        return method === 'takePhoto' ? photo : { results: [photo] };
      }
      if (plugin !== 'PhotoProcessing') return {};
      if (method === 'importPhoto') {
        if (missingSourceUris.includes(args.uri)) throw new Error('合成测试：相机缓存文件已丢失');
        const data = image(), id = crypto.randomUUID(), originalUri = uriFor(args.owner, id, 'original'), previewUri = uriFor(args.owner, id, 'preview.jpg');
        const original = { schemaVersion: 1, originalId: id, studentId: args.studentId, ...(await info(data)), mime: 'image/png', width: 900, height: 1200,
          uprightWidth: 900, uprightHeight: 1200, orientation: 1, originalUri, previewUri, createdAt: Date.now() };
        store(sourceKey(args.owner, id), original); store('file:' + originalUri, data); store('file:' + previewUri, data);
        return original;
      }
      if (method === 'getOriginal') {
        const original = read(sourceKey(args.owner, args.originalId), null); if (!original) throw new Error('No original in this account'); return original;
      }
      if (method === 'listOriginals') {
        const all = Object.keys(localStorage).filter(k => k.startsWith('host-test:original:')).flatMap(k => {
          const scope = JSON.parse(k.slice('host-test:original:'.length)), p = JSON.parse(localStorage.getItem(k));
          return scope[0] === args.owner && p.studentId === args.studentId ? [p] : [];
        }); return { originals: all.slice(args.offset, args.offset + args.limit), total: all.length };
      }
      if (method === 'deleteOriginal') throw new Error('Host must never delete originals');
      if (method === 'process') {
        await new Promise(resolve => setTimeout(resolve, processingDelay));
        const original = read(sourceKey(args.owner, args.originalId), null); if (!original) throw new Error('Wrong account');
        const outputId = crypto.randomUUID(), data = image(true), uri = uriFor(args.owner, original.originalId, outputId + '.jpg'); store('file:' + uri, data);
        return { schemaVersion: 1, algorithmVersion: 'android-photo-v1', originalId: original.originalId, studentId: original.studentId, outputId,
          sourceSha256: original.sha256, ...(await info(data)), mime: 'image/jpeg', width: 900, height: 1200, sourceWidth: 900, sourceHeight: 1200,
          decodedWidth: 900, decodedHeight: 1200, exifOrientation: 1, sourceSpace: 'exif-upright-normalized-edges', outputSpace: 'normalized-edges',
          corners: args.corners, quarterTurns: args.quarterTurns, enhancement: args.enhancement, maxEdge: 3072, jpegQuality: 94,
          sourceToOutput: [1,0,0,0,1,0,0,0,1], outputToSource: [1,0,0,0,1,0,0,0,1], createdAt: Date.now(), uri,
          quality: { advisoryOnly: true, warnings: [], laplacianVariance: 80, darkFraction: .02, backgroundRange: 20, percentile10: 100, percentile90: 240 } };
      }
      throw new Error('Unexpected bridge operation: ' + method);
    },
  };
  window.hostPhotoTest = {
    delay: ms => { processingDelay = ms; },
    back: () => { for (const listener of listeners.values()) if (listener.plugin === 'App' && listener.name === 'backButton') listener.callback({ canGoBack: false }); },
    switchAccount: letter => { store('vault', JSON.stringify({ base: api, token: 'test-' + letter })); location.reload(); },
    seedRestore(studentId) {
      localStorage.setItem('family-learning:pending-camera', JSON.stringify({ owner: api + '|' + initialUserId, studentId, id: crypto.randomUUID(), source: 'camera' }));
      store('restore', { pluginId: 'Camera', methodName: 'takePhoto', success: true, data: { uri: '/synthetic/restored.png' } });
    },
    expire() { window.dispatchEvent(new CustomEvent('family-learning:session-expired', { detail: { base: api, token: initialToken } })); },
  };
}
