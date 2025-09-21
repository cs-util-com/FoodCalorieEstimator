import { actions, createStore, initialState, rootReducer, selectors } from './store.js';

function buildSampleEstimation() {
  return {
    version: '1.1',
    model_id: 'gemini-2.5',
    meal_confidence: 'high',
    total_kcal: 600,
    items: [
      { name: 'Salad', kcal: 200, confidence: 0.8, estimated_grams: 150, used_scale_ref: false, scale_ref: null, bbox_1000: null, notes: null },
      { name: 'Soup', kcal: 150, confidence: 0.2, estimated_grams: null, used_scale_ref: false, scale_ref: null, bbox_1000: null, notes: null },
    ],
  };
}

describe('store reducers', () => {
  test('capture lifecycle transitions from processing to ready', () => {
    // Why: Ensures Camera view reacts to preprocess outcomes predictably.
    const store = createStore();
    const dummyFile = new Blob(['x'], { type: 'image/jpeg' });

    store.dispatch(actions.captureStart(dummyFile));
    expect(store.getState().capture.status).toBe('processing');

    store.dispatch(actions.captureDone({ normalizedBlob: dummyFile, thumbBlob: dummyFile, width: 10, height: 10 }));
    expect(store.getState().capture.status).toBe('ready');
    expect(store.getState().capture.normalizedBlob).toBe(dummyFile);
  });

  test('estimation success prepares items with confidence gating', () => {
    // Why: Low confidence items must default to excluded so totals stay realistic.
    const store = createStore();
    store.dispatch(actions.estimationSuccess(buildSampleEstimation()));
    const { data } = store.getState().estimation;
    expect(data.items.length).toBe(2);
    const salad = data.items.find((item) => item.name === 'Salad');
    const soup = data.items.find((item) => item.name === 'Soup');
    expect(salad.included).toBe(true);
    expect(soup.included).toBe(false);
  });

  test('manual kcal edit updates totals and note', () => {
    // Why: Result view must recalc the header when the user overrides numbers.
    const store = createStore();
    store.dispatch(actions.estimationSuccess(buildSampleEstimation()));
    const firstId = store.getState().estimation.data.items[0].id;
    store.dispatch(actions.updateKcal(firstId, 400));
    const { data } = store.getState().estimation;
    expect(data.itemTotal).toBe(400);
    expect(data.totalsNote.showNote).toBe(true);
  });

  test('loading a saved meal switches context to history', () => {
    // Why: History detail view reuses the estimation reducers for editing.
    const store = createStore();
    const saved = {
      id: 'saved-1',
      mealConfidence: 'medium',
      modelTotal: 500,
      items: [
        {
          id: 'item-1',
          name: 'Leftovers',
          originalKcal: 250,
          editedKcal: 200,
          included: true,
          confidence: 0.6,
        },
      ],
    };
    store.dispatch(actions.loadSavedMeal(saved));
    const estimation = store.getState().estimation;
    expect(estimation.context).toBe('history');
    expect(estimation.data.items[0].name).toBe('Leftovers');
  });

  test('capture reset clears blobs and context', () => {
    // Why: Camera tab should return to an idle state after manual reset.
    const store = createStore();
    const blob = new Blob(['x']);
    store.dispatch(actions.captureStart(blob));
    store.dispatch(actions.captureDone({ normalizedBlob: blob, thumbBlob: blob, width: 1, height: 1 }));
    store.dispatch(actions.captureReset());
    expect(store.getState().capture.status).toBe('idle');
    expect(store.getState().estimation.context).toBeNull();
  });

  test('notifications push and dismiss correctly', () => {
    // Why: Toast stack should be predictable for UX consistency.
    const store = createStore();
    store.dispatch(actions.pushNotification({ message: 'Hello' }));
    const noteId = store.getState().notifications[0].id;
    store.dispatch(actions.dismissNotification(noteId));
    expect(store.getState().notifications).toHaveLength(0);
  });

  test('settings update toggles default show boxes', () => {
    // Why: Settings tab affects initial overlay visibility in the result view.
    const store = createStore();
    store.dispatch(actions.updateSettings({ defaultShowBoxes: false, apiKey: 'key' }));
    expect(store.getState().settings.defaultShowBoxes).toBe(false);
    expect(store.getState().settings.apiKey).toBe('key');
  });
});

describe('selectors', () => {
  test('filteredHistory applies search query', () => {
    // Why: History search must stay consistent with user expectations.
    const state = {
      ...initialState,
      history: {
        entries: [
          { id: '1', createdAt: 1, items: [{ name: 'Avocado toast' }] },
          { id: '2', createdAt: 2, items: [{ name: 'Yogurt parfait' }] },
        ],
        search: 'cado',
        selectedId: null,
      },
    };

    const filtered = selectors.filteredHistory(state);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });
});
