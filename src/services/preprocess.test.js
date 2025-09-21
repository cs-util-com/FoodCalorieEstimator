import { PreprocessService } from './preprocess.js';

describe('PreprocessService', () => {
  test('scales long edge and exports blobs', async () => {
    // Why: Keeps provider bandwidth predictable and respects the spec limit.
    const fakeBitmap = { width: 4000, height: 3000 };
    const exported = [];
    const canvasFactory = () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: jest.fn() }),
      toDataURL: () => 'data:image/webp;base64,xxx',
      convertToBlob: jest.fn((options) => {
        exported.push(options);
        return Promise.resolve(new Blob(['x'], { type: 'image/webp' }));
      }),
    });

    const service = new PreprocessService({
      maxLongEdge: 1536,
      thumbLongEdge: 512,
      createImageBitmapFn: () => fakeBitmap,
      canvasFactory,
    });

    const blob = new Blob(['source'], { type: 'image/jpeg' });
    const result = await service.preprocess(blob);

    expect(result.width).toBeLessThanOrEqual(1536);
    expect(result.height).toBeLessThanOrEqual(1536);
    expect(result.normalizedBlob).toBeInstanceOf(Blob);
    expect(result.thumbBlob).toBeInstanceOf(Blob);
  expect(exported[0]).toEqual({ type: 'image/webp', quality: 0.8 });
  });

  test('throws when canvas factory fails', async () => {
    // Why: Surfaces environment issues early, aiding debugging in unsupported browsers.
    const service = new PreprocessService({
      createImageBitmapFn: () => ({ width: 10, height: 10 }),
      canvasFactory: () => null,
    });

    await expect(service.preprocess(new Blob(['x']))).rejects.toThrow(/canvas/i);
  });

  test('falls back to toBlob when convertToBlob is unavailable', async () => {
    // Why: Older browsers only support the asynchronous toBlob API.
    const fakeBitmap = { width: 100, height: 50 };
    const canvasFactory = () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: jest.fn() }),
      toBlob: jest.fn((cb) => cb(new Blob(['z'], { type: 'image/webp' }))),
    });
    const service = new PreprocessService({
      createImageBitmapFn: () => fakeBitmap,
      canvasFactory,
    });
    const result = await service.preprocess(new Blob(['source']));
    expect(result.normalizedBlob).toBeInstanceOf(Blob);
  });

  test('falls back to <img> loader when createImageBitmap fails', async () => {
    // Simulate failure and ensure <img> path is exercised; mock Image to resolve
    const createImageBitmapFn = jest.fn(() => {
      throw new Error('not supported');
    });
    const originalURL = global.URL;
    const objectUrls = [];
    global.URL = {
      ...originalURL,
      createObjectURL: () => {
        const u = `blob:mock:${objectUrls.length + 1}`;
        objectUrls.push(u);
        return u;
      },
      revokeObjectURL: jest.fn(),
    };
    const img = {};
    global.Image = class {
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
      set src(v) {
        img.src = v; // track
      }
    };
    const canvasFactory = () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: jest.fn() }),
      toBlob: (cb, type) => cb(new Blob(['a'], { type: type || 'image/png' })),
      toDataURL: () => 'data:image/png;base64,xxx',
    });
    const service = new PreprocessService({ createImageBitmapFn, canvasFactory });
    const result = await service.preprocess(new Blob(['pic']))
      .finally(() => {
        global.URL = originalURL;
      });
    expect(result.normalizedBlob).toBeInstanceOf(Blob);
  });
});
