import { confidenceToRange, buildTotalsNote } from '../utils/range.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function itemCalorieValue(item) {
  return item.editedKcal ?? item.originalKcal;
}

function computeItemTotal(items) {
  return items.filter((item) => item.included).reduce((sum, item) => sum + itemCalorieValue(item), 0);
}

function prepareItems(rawItems, threshold) {
  return rawItems.map((item, index) => {
    const included = item.confidence >= threshold;
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      name: item.name,
      originalKcal: item.kcal,
      editedKcal: null,
      included,
      confidence: item.confidence,
      estimatedGrams: item.estimated_grams,
      usedScaleRef: item.used_scale_ref,
      scaleRef: item.scale_ref,
      bbox: item.bbox_1000,
      notes: item.notes,
    };
  });
}

function deriveEstimation(items, modelTotal, mealConfidence) {
  const itemTotal = computeItemTotal(items);
  // Range must be based on the sum of the (possibly edited) included items.
  const cleanModelTotal = Number.isFinite(modelTotal) ? modelTotal : itemTotal;
  const range = confidenceToRange(itemTotal, mealConfidence);
  const totalsNote = buildTotalsNote(itemTotal, cleanModelTotal);
  return {
    mealConfidence,
    items,
    itemTotal,
    modelTotal: cleanModelTotal,
    range,
    totalsNote,
  };
}

export const initialState = {
  activeTab: 'camera',
  capture: {
    status: 'idle',
    error: null,
    originalBlob: null,
    normalizedBlob: null,
    thumbBlob: null,
    width: 0,
    height: 0,
  },
  estimation: {
    status: 'idle',
    data: null,
    error: null,
    showBoxes: true,
    context: null,
    sourceId: null,
    createdAt: null,
  },
  history: {
    entries: [],
    search: '',
    selectedId: null,
  },
  settings: {
    apiKey: '',
    modelVariant: 'flash',
    preprocessSize: 1536,
    units: 'kcal',
    defaultShowBoxes: true,
    confidenceThreshold: 0.35,
    demoUnlocked: false,
  },
  logs: [],
  notifications: [],
};

function updateItem(items, itemId, updater) {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    return { ...item, ...updater(item) };
  });
}

function removeItem(items, itemId) {
  return items.filter((item) => item.id !== itemId);
}

export function rootReducer(state = initialState, action) {
  switch (action.type) {
    case 'ui/setTab':
      return { ...state, activeTab: action.tab };
    case 'capture/start':
      return {
        ...state,
        capture: {
          status: 'processing',
          error: null,
          originalBlob: action.file,
          normalizedBlob: null,
          thumbBlob: null,
          width: 0,
          height: 0,
        },
        estimation: { ...state.estimation, status: 'idle', data: null, error: null, context: null, sourceId: null, createdAt: null },
      };
    case 'capture/failure':
      return {
        ...state,
        capture: { ...state.capture, status: 'error', error: action.error },
      };
    case 'capture/done':
      return {
        ...state,
        capture: {
          status: 'ready',
          error: null,
          originalBlob: state.capture.originalBlob,
          normalizedBlob: action.normalizedBlob,
          thumbBlob: action.thumbBlob,
          width: action.width,
          height: action.height,
        },
      };
    case 'capture/reset':
      return {
        ...state,
        capture: { ...initialState.capture },
        estimation: { ...state.estimation, status: 'idle', data: null, error: null, context: null, sourceId: null, createdAt: null },
      };
    case 'estimation/start':
      return {
        ...state,
        estimation: { ...state.estimation, status: 'processing', error: null },
      };
    case 'estimation/success': {
      const threshold = state.settings.confidenceThreshold;
      const items = prepareItems(action.payload.items, threshold);
      const data = deriveEstimation(items, action.payload.total_kcal, action.payload.meal_confidence);
      return {
        ...state,
        estimation: {
          status: 'ready',
          error: null,
          data,
          showBoxes: state.settings.defaultShowBoxes,
          lastUpdated: Date.now(),
          context: 'capture',
          sourceId: null,
          createdAt: Date.now(),
        },
      };
    }
    case 'estimation/failure':
      return {
        ...state,
        estimation: { ...state.estimation, status: 'error', error: action.error, context: null, sourceId: null, createdAt: null },
      };
    case 'estimation/loadSaved': {
      const items = (action.data.items || []).map((item) => ({ ...item }));
      const data = deriveEstimation(items, action.data.modelTotal, action.data.mealConfidence);
      return {
        ...state,
        estimation: {
          ...state.estimation,
          status: 'ready',
          error: null,
          data,
          showBoxes: action.data.showBoxes ?? state.settings.defaultShowBoxes,
          context: 'history',
          sourceId: action.data.id,
          createdAt: action.data.createdAt || Date.now(),
        },
      };
    }
    case 'result/toggleItem': {
      if (!state.estimation.data) return state;
      const items = updateItem(state.estimation.data.items, action.id, (item) => ({ included: !item.included }));
      const data = deriveEstimation(items, state.estimation.data.modelTotal, state.estimation.data.mealConfidence);
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/renameItem': {
      if (!state.estimation.data) return state;
      const items = updateItem(state.estimation.data.items, action.id, () => ({ name: action.name }));
      const data = { ...state.estimation.data, items };
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/updateKcal': {
      if (!state.estimation.data) return state;
      const items = updateItem(state.estimation.data.items, action.id, () => ({ editedKcal: action.kcal }));
      const data = deriveEstimation(items, state.estimation.data.modelTotal, state.estimation.data.mealConfidence);
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/resetKcal': {
      if (!state.estimation.data) return state;
      const items = updateItem(state.estimation.data.items, action.id, () => ({ editedKcal: null }));
      const data = deriveEstimation(items, state.estimation.data.modelTotal, state.estimation.data.mealConfidence);
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/removeItem': {
      if (!state.estimation.data) return state;
      const items = removeItem(state.estimation.data.items, action.id);
      const data = deriveEstimation(items, state.estimation.data.modelTotal, state.estimation.data.mealConfidence);
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/addItem': {
      if (!state.estimation.data) return state;
      const newItem = {
        id: `${Date.now()}-manual-${Math.random().toString(16).slice(2)}`,
        name: action.item.name,
        originalKcal: action.item.kcal,
        editedKcal: null,
        included: true,
        confidence: action.item.confidence ?? 1,
        estimatedGrams: action.item.estimatedGrams ?? null,
        usedScaleRef: false,
        scaleRef: null,
        bbox: null,
        notes: null,
      };
      const items = [...state.estimation.data.items, newItem];
      const data = deriveEstimation(items, state.estimation.data.modelTotal, state.estimation.data.mealConfidence);
      return { ...state, estimation: { ...state.estimation, data } };
    }
    case 'result/setShowBoxes':
      return { ...state, estimation: { ...state.estimation, showBoxes: action.value } };
    case 'history/setEntries':
      return { ...state, history: { ...state.history, entries: clone(action.entries) } };
    case 'history/addEntry':
      return {
        ...state,
        history: {
          ...state.history,
          entries: [clone(action.entry), ...state.history.entries],
        },
      };
    case 'history/deleteEntry':
      return {
        ...state,
        history: {
          ...state.history,
          entries: state.history.entries.filter((entry) => entry.id !== action.id),
        },
      };
    case 'history/setSearch':
      return { ...state, history: { ...state.history, search: action.query } };
    case 'history/select':
      return { ...state, history: { ...state.history, selectedId: action.id } };
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'logs/add':
      return { ...state, logs: [{ timestamp: Date.now(), message: action.message, level: action.level || 'info' }, ...state.logs].slice(0, 50) };
    case 'logs/clear':
      return { ...state, logs: [] };
    case 'notifications/push':
      return { ...state, notifications: [...state.notifications, { id: Date.now(), ...action.payload }] };
    case 'notifications/dismiss':
      return { ...state, notifications: state.notifications.filter((note) => note.id !== action.id) };
    default:
      return state;
  }
}

export function createStore(reducer = rootReducer, preloadedState = initialState) {
  let currentState = preloadedState;
  const listeners = new Set();

  return {
    dispatch(action) {
      if (!action || typeof action.type !== 'string') {
        throw new Error('Actions must have a string type');
      }
      currentState = reducer(currentState, action);
      for (const listener of listeners) {
        listener();
      }
      return action;
    },
    getState() {
      return currentState;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const actions = {
  setActiveTab: (tab) => ({ type: 'ui/setTab', tab }),
  captureStart: (file) => ({ type: 'capture/start', file }),
  captureFailure: (error) => ({ type: 'capture/failure', error }),
  captureDone: (payload) => ({ type: 'capture/done', ...payload }),
  captureReset: () => ({ type: 'capture/reset' }),
  estimationStart: () => ({ type: 'estimation/start' }),
  estimationSuccess: (payload) => ({ type: 'estimation/success', payload }),
  estimationFailure: (error) => ({ type: 'estimation/failure', error }),
  loadSavedMeal: (data) => ({ type: 'estimation/loadSaved', data }),
  toggleItem: (id) => ({ type: 'result/toggleItem', id }),
  renameItem: (id, name) => ({ type: 'result/renameItem', id, name }),
  updateKcal: (id, kcal) => ({ type: 'result/updateKcal', id, kcal }),
  resetKcal: (id) => ({ type: 'result/resetKcal', id }),
  removeItem: (id) => ({ type: 'result/removeItem', id }),
  addItem: (item) => ({ type: 'result/addItem', item }),
  setShowBoxes: (value) => ({ type: 'result/setShowBoxes', value }),
  setHistoryEntries: (entries) => ({ type: 'history/setEntries', entries }),
  addHistoryEntry: (entry) => ({ type: 'history/addEntry', entry }),
  deleteHistoryEntry: (id) => ({ type: 'history/deleteEntry', id }),
  setHistorySearch: (query) => ({ type: 'history/setSearch', query }),
  selectHistoryEntry: (id) => ({ type: 'history/select', id }),
  updateSettings: (settings) => ({ type: 'settings/update', settings }),
  addLog: (message, level = 'info') => ({ type: 'logs/add', message, level }),
  clearLogs: () => ({ type: 'logs/clear' }),
  pushNotification: (payload) => ({ type: 'notifications/push', payload }),
  dismissNotification: (id) => ({ type: 'notifications/dismiss', id }),
};

export const selectors = {
  activeTab: (state) => state.activeTab,
  captureStatus: (state) => state.capture.status,
  captureReady: (state) => state.capture.status === 'ready',
  estimationData: (state) => state.estimation.data,
  estimationStatus: (state) => state.estimation.status,
  estimationContext: (state) => state.estimation.context,
  estimationSourceId: (state) => state.estimation.sourceId,
  estimationCreatedAt: (state) => state.estimation.createdAt,
  showBoxes: (state) => state.estimation.showBoxes,
  historyEntries: (state) => state.history.entries,
  historySearch: (state) => state.history.search,
  filteredHistory: (state) => {
    const query = state.history.search.trim().toLowerCase();
    if (!query) return state.history.entries;
    return state.history.entries.filter((entry) => entry.items.some((item) => item.name.toLowerCase().includes(query)));
  },
  settings: (state) => state.settings,
  logs: (state) => state.logs,
  notifications: (state) => state.notifications,
};
