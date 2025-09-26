import { App } from './app.js';
import { actions, createStore } from '../store/store.js';

function setupDom() {
  document.body.innerHTML = `
    <nav>
      <button class="secondary" data-tab="camera"></button>
      <button class="secondary" data-tab="history"></button>
      <button class="secondary" data-tab="settings"></button>
    </nav>
    <section id="camera-view" class="view"></section>
    <section id="result-view" class="view"></section>
    <section id="history-view" class="view"></section>
    <section id="detail-view" class="view"></section>
    <section id="settings-view" class="view"></section>
    <input id="file-input" />
    <button id="demo-button"></button>
    <input type="checkbox" id="toggle-boxes" />
    <div id="capture-status"></div>
    <div id="canvas-wrapper"><canvas id="result-canvas" width="640" height="480"></canvas><div id="canvas-overlay"></div></div>
    <p id="result-summary"></p>
    <small id="result-note"></small>
    <div id="items-list"></div>
    <button id="add-item"></button>
    <form id="add-item-form"><input name="name" /><input name="kcal" /><input name="confidence" /></form>
    <button id="save-meal"></button>
    <input id="history-search" />
    <div id="history-grid"></div>
    <p id="detail-summary"></p>
    <small id="detail-note"></small>
    <div id="detail-items"></div>
    <button id="detail-export"></button>
    <button id="detail-delete"></button>
    <button id="detail-close"></button>
    <button id="detail-add-item"></button>
    <button id="detail-save"></button>
    <form id="detail-add-item-form"><input name="name" /><input name="kcal" /><input name="confidence" /></form>
    <form id="settings-form">
      <input name="apiKey" />
      <select name="modelVariant"><option value="flash">flash</option></select>
      <select name="preprocessSize"><option value="1536">1536</option></select>
      <select name="units"><option value="kcal">kcal</option></select>
      <input type="checkbox" name="defaultShowBoxes" />
      <input type="range" name="confidenceThreshold" />
    </form>
    <button id="logs-toggle"></button>
    <pre id="logs"></pre>
    <button id="wipe-data"></button>
    <dialog id="notification-dialog"></dialog>
  `;
}

describe('App UI integration', () => {
  let store;
  let app;
  let storage;

  beforeEach(() => {
    setupDom();
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: jest.fn(), clearRect: jest.fn() });
    global.createImageBitmap = jest.fn(() => Promise.resolve({ width: 100, height: 80, close: jest.fn() }));
    URL.createObjectURL = jest.fn(() => 'blob:url');
    HTMLDialogElement.prototype.show = jest.fn();
    HTMLDialogElement.prototype.close = jest.fn();
    store = createStore();
    storage = {
      listMeals: jest.fn(() => Promise.resolve([])),
      saveMeal: jest.fn(() => Promise.resolve('id-1')),
      loadMeal: jest.fn(() =>
        Promise.resolve({
          meal: {
            id: 'id-1',
            createdAt: 1,
            mealConfidence: 'high',
            modelTotal: 500,
            itemTotal: 500,
            totalKcal: 500,
            range: { lower: 450, upper: 550 },
            items: [],
            width: 640,
            height: 480,
          },
          images: { normalizedBlob: new Blob(['a']), thumbBlob: new Blob(['b']) },
        }),
      ),
      deleteMeal: jest.fn(() => Promise.resolve()),
      deleteOldest: jest.fn(() => Promise.resolve([])),
    };
    app = new App({
      store,
      preprocessService: { preprocess: jest.fn() },
      estimationService: { estimate: jest.fn(), runDemo: jest.fn() },
      storageService: storage,
      root: document,
    });
    app.init();
  });

  test('manual item form dispatches addItem action', () => {
    // Why: Ensures editable lists behave identically in result and detail views.
    const sample = {
      version: '1.1',
      model_id: 'gemini-2.5',
      meal_confidence: 'high',
      total_kcal: 500,
      items: [
        { name: 'Salad', kcal: 200, confidence: 0.8, estimated_grams: null, used_scale_ref: false, scale_ref: null, bbox_1000: null, notes: null },
      ],
    };
    store.dispatch(actions.estimationSuccess(sample));
    const form = document.getElementById('add-item-form');
    form.querySelector('[name="name"]').value = 'Toast';
    form.querySelector('[name="kcal"]').value = '120';
    form.querySelector('[name="confidence"]').value = '0.8';
    form.dispatchEvent(new Event('submit'));
    const state = store.getState();
    expect(state.estimation.data.items).toHaveLength(2);
    expect(form.hidden).toBe(true);
  });

  test('renderHistory highlights search matches', async () => {
    // Why: UX spec requires highlighting matched substrings in the history grid.
    store.dispatch(
      actions.setHistoryEntries([
        {
          id: 'h1',
          createdAt: 1,
          totalKcal: 320,
          mealConfidence: 'high',
          items: [{ name: 'Avocado toast' }],
          thumbBlob: new Blob(['x']),
        },
      ]),
    );
    store.dispatch(actions.setHistorySearch('cado'));
    app.renderHistory();
    expect(document.querySelector('#history-grid small').innerHTML).toContain('<mark>cado</mark>');
  });

  test('renderHistory tolerates non-Blob thumbBlob', () => {
    // Why: In the browser, malformed entries or legacy data could provide a non-Blob; UI must not crash.
    const badThumb = { type: 'image/webp', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    store.dispatch(
      actions.setHistoryEntries([
        {
          id: 'h2',
          createdAt: 2,
          totalKcal: 100,
          mealConfidence: 'low',
          items: [{ name: 'Tea' }],
          thumbBlob: badThumb, // not a real Blob
        },
      ]),
    );
    URL.createObjectURL = jest.fn(() => 'blob:url');
    // Should not throw; should fall back to placeholder image
    expect(() => app.renderHistory()).not.toThrow();
    const imgSrc = document.querySelector('#history-grid img')?.getAttribute('src');
    // Should fall back to our inline data URL placeholder (offline-safe)
    expect(imgSrc).toMatch(/^data:image\/(svg\+xml|png);/);
  });

  test('saveMeal forwards data to storage service', async () => {
    // Why: Verifies persistence includes image metadata and totals.
    const sample = {
      version: '1.1',
      model_id: 'gemini-2.5',
      meal_confidence: 'high',
      total_kcal: 500,
      items: [
        { name: 'Toast', kcal: 200, confidence: 0.8, estimated_grams: null, used_scale_ref: false, scale_ref: null, bbox_1000: null, notes: null },
      ],
    };
    store.dispatch(actions.estimationSuccess(sample));
    app.currentImage = { blob: new Blob(['img']), width: 640, height: 480 };
    await app.saveMeal();
    expect(storage.saveMeal).toHaveBeenCalledWith(
      expect.objectContaining({ width: 640, height: 480 }),
      expect.any(Object),
    );
  });

  test('openDetail loads meal and renders items', async () => {
    // Why: Detail view should hydrate from IndexedDB metadata.
    const meal = {
      id: 'id-2',
      createdAt: 2,
      mealConfidence: 'medium',
      modelTotal: 420,
      itemTotal: 400,
      totalKcal: 400,
      range: { lower: 300, upper: 500 },
      items: [
        {
          id: 'it-1',
          name: 'Yogurt',
          originalKcal: 150,
          editedKcal: null,
          included: true,
          confidence: 0.6,
          bbox: { x: 0, y: 0, w: 500, h: 500 },
        },
      ],
      width: 300,
      height: 200,
    };
    storage.loadMeal = jest.fn(() =>
      Promise.resolve({ meal, images: { normalizedBlob: new Blob(['x']), thumbBlob: new Blob(['y']) } }),
    );
    store.dispatch(actions.setHistoryEntries([{ ...meal, thumbBlob: null }]));
    await app.openDetail('id-2');
    expect(store.getState().estimation.context).toBe('history');
    expect(document.querySelectorAll('#detail-items .item-card').length).toBe(1);
  });

  test('deleteDetail removes meal and resets detail state', async () => {
    // Why: Users can clean up storage from the detail view.
    storage.loadMeal = jest.fn(() =>
      Promise.resolve({
        meal: {
          id: 'to-delete',
          createdAt: 3,
          mealConfidence: 'low',
          modelTotal: 300,
          itemTotal: 280,
          totalKcal: 280,
          range: { lower: 200, upper: 360 },
          items: [],
          width: 200,
          height: 200,
        },
        images: { normalizedBlob: new Blob(['z']), thumbBlob: new Blob(['z']) },
      }),
    );
    await app.openDetail('to-delete');
    await app.deleteDetail();
    expect(storage.deleteMeal).toHaveBeenCalledWith('to-delete');
    expect(app.detailRecord).toBeNull();
  });

  test('wipeData clears stored meals when confirmed', async () => {
    // Why: Settings wipe action should clear history and logs.
    window.confirm = jest.fn(() => true);
    await app.wipeData();
    expect(storage.deleteOldest).toHaveBeenCalled();
  });

  test('handleFile triggers preprocess and estimation when key present', async () => {
    // Why: Main happy path should run through preprocess and estimation services.
    store.dispatch(actions.updateSettings({ apiKey: 'key-123' }));
    const normalized = { normalizedBlob: createFakeBlob(), thumbBlob: createFakeBlob(), width: 10, height: 5 };
    app.preprocessService.preprocess.mockResolvedValue(normalized);
    app.estimationService.estimate = jest.fn(() => Promise.resolve(buildSampleEstimation()));
    await app.handleFile(createFakeBlob());
    expect(app.preprocessService.preprocess).toHaveBeenCalled();
    expect(app.estimationService.estimate).toHaveBeenCalled();
  });

  test('runDemo hydrates estimation without a key', async () => {
    // Why: Demo-first onboarding path should function without configuration.
    app.estimationService.runDemo = jest.fn(() => Promise.resolve(buildSampleEstimation()));
    await app.runDemo();
    expect(app.estimationService.runDemo).toHaveBeenCalled();
    expect(store.getState().estimation.data).not.toBeNull();
    expect(app.currentImage.blob).toBeInstanceOf(Blob);
  });
});

function createFakeBlob() {
  const buffer = Uint8Array.from([9, 9, 9]).buffer;
  return {
    type: 'image/jpeg',
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

function buildSampleEstimation() {
  return {
    version: '1.1',
    model_id: 'gemini-2.5',
    meal_confidence: 'high',
    total_kcal: 320,
    items: [
      {
        name: 'Toast',
        kcal: 200,
        confidence: 0.8,
        estimated_grams: null,
        used_scale_ref: false,
        scale_ref: null,
        bbox_1000: null,
        notes: null,
      },
    ],
  };
}
