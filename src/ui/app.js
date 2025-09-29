import { actions, selectors } from '../store/store.js';
import { formatEnergy } from '../utils/units.js';
import { mealToCsv } from '../utils/csv.js';
import { ImageCanvas } from './components/image-canvas.js';

const DEMO_SAMPLE = {
  version: '1.1',
  model_id: 'gemini-2.5',
  meal_confidence: 'medium',
  total_kcal: 680,
  items: [
    {
      name: 'Veggie burger',
      kcal: 420,
      confidence: 0.78,
      estimated_grams: 220,
      used_scale_ref: false,
      scale_ref: null,
      bbox_1000: { x: 120, y: 180, w: 400, h: 420 },
      notes: 'Plant-based patty',
    },
    {
      name: 'Side salad',
      kcal: 180,
      confidence: 0.6,
      estimated_grams: 80,
      used_scale_ref: false,
      scale_ref: null,
      bbox_1000: { x: 580, y: 220, w: 320, h: 360 },
      notes: null,
    },
    {
      name: 'Iced tea',
      kcal: 80,
      confidence: 0.32,
      estimated_grams: null,
      used_scale_ref: false,
      scale_ref: null,
      bbox_1000: { x: 760, y: 80, w: 200, h: 380 },
      notes: null,
    },
  ],
};

const DEMO_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

// Offline-safe placeholder thumbnail (160x120) as inline SVG data URL
// Rationale: Avoids external network calls to placeholder services which may fail offline.
const PLACEHOLDER_THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">\n' +
      '<rect width="160" height="120" fill="#e5e7eb"/>\n' +
      '<text x="80" y="60" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif" font-size="16" fill="#6b7280">Meal</text>\n' +
    '</svg>'
  );

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const length = binary.length;
  const buffer = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return new Blob([buffer], { type });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRange(range, units) {
  if (!range) return '';
  return `${formatEnergy(range.lower, units)} – ${formatEnergy(range.upper, units)}`;
}

function highlight(text, query) {
  const safeText = escapeHtml(text);
  if (!query) return safeText;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${safe})`, 'ig');
  return safeText.replace(regex, '<mark>$1</mark>');
}

export class App {
  constructor({ store, preprocessService, estimationService, storageService, root = document }) {
    this.store = store;
    this.preprocessService = preprocessService;
    this.estimationService = estimationService;
    this.storageService = storageService;
    this.root = root;
    this.elements = {};
    this.canvas = null;
    this.thumbUrls = new Map();
    this.currentImage = null;
    this.detailRecord = null;
  }

  init() {
    this.cacheElements();
    this.imageCanvas = new ImageCanvas(this.elements.resultCanvas, this.elements.canvasOverlay);
    this.bindEvents();
    this.loadSettings();
    this.attachOnlineHandlers();
    this.store.subscribe(() => this.render());
    this.render();
    this.refreshHistory();
    this.registerServiceWorker();
  }

  cacheElements() {
    this.elements = {
      tabs: Array.from(this.root.querySelectorAll('nav .secondary')),
      views: {
        camera: this.root.getElementById('camera-view'),
        result: this.root.getElementById('result-view'),
        history: this.root.getElementById('history-view'),
        detail: this.root.getElementById('detail-view'),
        settings: this.root.getElementById('settings-view'),
      },
      fileInput: this.root.getElementById('file-input'),
      demoButton: this.root.getElementById('demo-button'),
      toggleBoxes: this.root.getElementById('toggle-boxes'),
      captureStatus: this.root.getElementById('capture-status'),
      canvasWrapper: this.root.getElementById('canvas-wrapper'),
      resultCanvas: this.root.getElementById('result-canvas'),
      canvasOverlay: this.root.getElementById('canvas-overlay'),
      resultSummary: this.root.getElementById('result-summary'),
      resultNote: this.root.getElementById('result-note'),
      itemsList: this.root.getElementById('items-list'),
      addItemButton: this.root.getElementById('add-item'),
      addItemForm: this.root.getElementById('add-item-form'),
      saveMeal: this.root.getElementById('save-meal'),
      historySearch: this.root.getElementById('history-search'),
      historyGrid: this.root.getElementById('history-grid'),
      detailSummary: this.root.getElementById('detail-summary'),
      detailNote: this.root.getElementById('detail-note'),
      detailItems: this.root.getElementById('detail-items'),
      detailExport: this.root.getElementById('detail-export'),
      detailDelete: this.root.getElementById('detail-delete'),
      detailClose: this.root.getElementById('detail-close'),
      detailAddButton: this.root.getElementById('detail-add-item'),
      detailAddForm: this.root.getElementById('detail-add-item-form'),
      detailSave: this.root.getElementById('detail-save'),
      settingsForm: this.root.getElementById('settings-form'),
      logsToggle: this.root.getElementById('logs-toggle'),
      logs: this.root.getElementById('logs'),
      wipeData: this.root.getElementById('wipe-data'),
      notificationDialog: this.root.getElementById('notification-dialog'),
    };
  }

  bindEvents() {
    this.elements.tabs.forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        this.store.dispatch(actions.setActiveTab(tab));
      });
    });

    this.elements.fileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        console.log('[CalorieCam] File selected:', { name: file.name, size: file.size, type: file.type });
        this.store.dispatch(actions.addLog(`File selected: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'info'));
        this.handleFile(file);
      }
    });

    this.elements.toggleBoxes.addEventListener('change', (event) => {
      this.store.dispatch(actions.setShowBoxes(event.target.checked));
      this.store.dispatch(actions.addLog(`Show boxes: ${event.target.checked}`, 'info'));
      this.renderCanvas();
    });

    this.elements.addItemButton.addEventListener('click', () => {
      this.elements.addItemForm.hidden = !this.elements.addItemForm.hidden;
    });

    this.elements.addItemForm.addEventListener('submit', this.handleManualItemForm(this.elements.addItemForm));

    this.elements.saveMeal.addEventListener('click', () => this.saveMeal());

    this.elements.detailAddButton.addEventListener('click', () => {
      this.elements.detailAddForm.hidden = !this.elements.detailAddForm.hidden;
    });

    this.elements.detailAddForm.addEventListener('submit', this.handleManualItemForm(this.elements.detailAddForm));

    this.elements.detailSave.addEventListener('click', () => this.saveMeal());

    this.elements.historySearch.addEventListener('input', (event) => {
      this.store.dispatch(actions.setHistorySearch(event.target.value));
      this.renderHistory();
    });

    this.elements.detailClose.addEventListener('click', () => {
      this.store.dispatch(actions.selectHistoryEntry(null));
      this.store.dispatch(actions.captureReset());
      this.detailRecord = null;
      this.store.dispatch(actions.setActiveTab('history'));
    });

    this.elements.detailDelete.addEventListener('click', () => this.deleteDetail());
    this.elements.detailExport.addEventListener('click', () => this.exportDetail());

    this.elements.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(this.elements.settingsForm);
      const settings = {
        apiKey: formData.get('apiKey') || '',
        modelVariant: formData.get('modelVariant'),
        preprocessSize: Number.parseInt(formData.get('preprocessSize'), 10),
        units: formData.get('units'),
        defaultShowBoxes: formData.get('defaultShowBoxes') === 'on',
        confidenceThreshold: Number.parseFloat(formData.get('confidenceThreshold')),
      };
      this.store.dispatch(actions.updateSettings(settings));
      this.persistSettings(settings);
      this.toast('Settings saved');
    });

    this.elements.logsToggle.addEventListener('click', () => {
      this.elements.logs.hidden = !this.elements.logs.hidden;
      this.renderLogs();
    });

    this.elements.wipeData.addEventListener('click', () => this.wipeData());
  }

  attachOnlineHandlers() {
    window.addEventListener('offline', () => this.toast('You are offline. Estimation disabled.'));
    window.addEventListener('online', () => this.toast('Back online.'));
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (error) {
        console.warn('SW registration failed', error);
      }
    }
  }

  loadSettings() {
    const saved = localStorage.getItem('caloriecam-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      this.store.dispatch(actions.updateSettings(parsed));
    }
    const settings = selectors.settings(this.store.getState());
    this.elements.toggleBoxes.checked = settings.defaultShowBoxes;
    this.syncSettingsForm();
  }

  persistSettings(settings) {
    const current = selectors.settings(this.store.getState());
    localStorage.setItem('caloriecam-settings', JSON.stringify({ ...current, ...settings }));
  }

  syncSettingsForm() {
    const settings = selectors.settings(this.store.getState());
    const form = this.elements.settingsForm;
    const apiKey = form.elements.namedItem('apiKey');
    const modelVariant = form.elements.namedItem('modelVariant');
    const preprocessSize = form.elements.namedItem('preprocessSize');
    const units = form.elements.namedItem('units');
    const defaultShowBoxes = form.elements.namedItem('defaultShowBoxes');
    const confidenceThreshold = form.elements.namedItem('confidenceThreshold');
    if (apiKey) apiKey.value = settings.apiKey;
    if (modelVariant) modelVariant.value = settings.modelVariant;
    if (preprocessSize) preprocessSize.value = settings.preprocessSize;
    if (units) units.value = settings.units;
    if (defaultShowBoxes) defaultShowBoxes.checked = settings.defaultShowBoxes;
    if (confidenceThreshold) confidenceThreshold.value = settings.confidenceThreshold;
  }

  handleManualItemForm(form) {
    return (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = (formData.get('name') || '').toString().trim();
      const kcal = Number.parseInt(formData.get('kcal'), 10);
      const confidence = Number.parseFloat(formData.get('confidence')) || 0.5;
      if (!name || Number.isNaN(kcal)) {
        return;
      }
      this.store.dispatch(actions.addItem({ name, kcal, confidence }));
      form.reset();
      form.hidden = true;
    };
  }

  async handleFile(file) {
    this.store.dispatch(actions.captureStart(file));
    const settings = selectors.settings(this.store.getState());
    try {
      const t0 = performance.now?.() ?? Date.now();
      this.store.dispatch(actions.addLog('Preprocess: start', 'info'));
      console.log('[CalorieCam] Preprocess started');
      const preprocess = await this.preprocessService.preprocess(file);
      const t1 = performance.now?.() ?? Date.now();
      this.store.dispatch(actions.captureDone(preprocess));
      this.currentImage = { blob: preprocess.normalizedBlob, width: preprocess.width, height: preprocess.height };
      this.store.dispatch(
        actions.addLog(
          `Preprocess: done (${preprocess.width}x${preprocess.height}) in ${Math.round(t1 - t0)}ms`,
          'info',
        ),
      );
      console.log('[CalorieCam] Preprocess done', {
        width: preprocess.width,
        height: preprocess.height,
        blobType: preprocess.normalizedBlob?.type,
      });
      this.renderCanvas();
      if (!settings.apiKey) {
        this.store.dispatch(actions.estimationFailure('API key required for estimation.')); 
        this.toast('Add your Gemini API key in Settings to run real estimations.');
        return;
      }
      this.store.dispatch(actions.addLog('Estimation: start (Gemini)', 'info'));
      console.log('[CalorieCam] Estimation starting with Gemini');
      await this.estimate(preprocess.normalizedBlob, settings);
    } catch (error) {
      console.error('[CalorieCam] Preprocess error', error);
      const message = error?.message || 'Unknown preprocess error';
      this.store.dispatch(actions.captureFailure(message));
      this.store.dispatch(actions.addLog(`Preprocess error: ${message}`, 'error'));
      this.toast('Preprocessing failed. Try another image.');
    }
  }

  async estimate(blob, settings) {
    const start = performance.now?.() ?? Date.now();
    this.store.dispatch(actions.estimationStart());
    try {
      const payload = await this.estimationService.estimate({
        imageBlob: blob,
        apiKey: settings.apiKey,
        modelVariant: settings.modelVariant,
      });
      this.store.dispatch(actions.estimationSuccess(payload));
      const end = performance.now?.() ?? Date.now();
      this.store.dispatch(actions.addLog(`Estimation: completed in ${Math.round(end - start)}ms`, 'info'));
      console.log('[CalorieCam] Estimation success', payload);
      this.renderCanvas();
      this.store.dispatch(actions.setActiveTab('camera'));
      this.showResult();
    } catch (error) {
      const code = error?.code || 'UNKNOWN';
      const msg = error?.message || 'Unknown error';
      this.store.dispatch(actions.estimationFailure(msg));
      this.store.dispatch(actions.addLog(`Estimation error [${code}]: ${msg}`, 'error'));
      if (error?.details) {
        this.store.dispatch(actions.addLog(`Details: ${String(error.details).slice(0, 200)}`, 'error'));
      }
      console.error('[CalorieCam] Estimation error', error);
      const friendly =
        code === 'TIMEOUT'
          ? 'Gemini timed out. Please try again.'
          : code === 'HTTP'
          ? `Gemini HTTP error${error.status ? ' ' + error.status : ''}. Check your key and quota.`
          : code === 'NETWORK'
          ? 'Network error reaching Gemini. Check your connection.'
          : 'Gemini request failed. Check your key or try again.';
      this.toast(friendly);
    }
  }

  async runDemo() {
    try {
      const payload = await this.estimationService.runDemo(DEMO_SAMPLE);
      this.store.dispatch(actions.estimationSuccess(payload));
      this.store.dispatch(actions.addLog('Demo meal loaded', 'info'));
      this.store.dispatch(actions.setActiveTab('camera'));
      this.showResult();
      const blob = base64ToBlob(DEMO_IMAGE_BASE64, 'image/png');
      this.currentImage = { blob, width: 600, height: 400 };
      this.renderCanvas();
    } catch {
      this.toast('Demo failed to load');
    }
  }

  showResult() {
    this.switchView('camera');
    this.elements.views.result.classList.add('is-active');
  }

  async refreshHistory() {
    // Clear cached thumb URLs so refreshed entries can create fresh object URLs
    // and avoid showing stale or missing images.
    for (const [, url] of this.thumbUrls.entries()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    this.thumbUrls.clear();
    const entries = await this.storageService.listMeals();
    this.store.dispatch(actions.setHistoryEntries(entries));
    this.renderHistory();
  }

  async saveMeal() {
    const estimation = selectors.estimationData(this.store.getState());
    if (!estimation || !this.currentImage) {
      this.toast('No result to save yet.');
      return;
    }
    const context = selectors.estimationContext(this.store.getState());
    const sourceId = selectors.estimationSourceId(this.store.getState());
    const createdAt = selectors.estimationCreatedAt(this.store.getState()) || Date.now();
    const record = {
      id: context === 'history' ? sourceId : undefined,
      createdAt,
      updatedAt: Date.now(),
      mealConfidence: estimation.mealConfidence,
      modelTotal: estimation.modelTotal,
      itemTotal: estimation.itemTotal,
      totalKcal: estimation.itemTotal,
      range: estimation.range,
      items: estimation.items,
      width: this.currentImage.width,
      height: this.currentImage.height,
    };
    try {
      await this.storageService.saveMeal(record, {
        normalizedBlob: this.currentImage.blob,
        thumbBlob: this.store.getState().capture.thumbBlob || this.currentImage.blob,
      });
      const loaded = await this.storageService.loadMeal(record.id ?? (await this.storageService.listMeals())[0]?.id);
      this.toast('Meal saved to history');
      await this.refreshHistory();
      if (context === 'history') {
        this.detailRecord = loaded.meal;
        this.currentImage = {
          blob: loaded.images?.normalizedBlob,
          width: loaded.meal.width,
          height: loaded.meal.height,
        };
        this.store.dispatch(
          actions.loadSavedMeal({ ...loaded.meal, id: loaded.meal.id, showBoxes: selectors.showBoxes(this.store.getState()) }),
        );
        this.renderDetail();
      }
    } catch (error) {
      this.toast('Saving failed');
      this.store.dispatch(actions.addLog(`Save error: ${error.message}`, 'error'));
    }
  }

  async deleteDetail() {
    if (!this.detailRecord) return;
    await this.storageService.deleteMeal(this.detailRecord.id);
    this.toast('Meal deleted');
    this.detailRecord = null;
    this.currentImage = null;
    this.renderCanvas();
    await this.refreshHistory();
    this.store.dispatch(actions.selectHistoryEntry(null));
    this.switchView('history');
  }

  exportDetail() {
    if (!this.detailRecord) return;
    const csv = mealToCsv({
      ...this.detailRecord,
      items: this.detailRecord.items,
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.detailRecord.id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async openDetail(entryId) {
    const loaded = await this.storageService.loadMeal(entryId);
    if (!loaded) return;
    this.detailRecord = loaded.meal;
    this.store.dispatch(actions.loadSavedMeal({ ...loaded.meal, id: entryId, showBoxes: true }));
    this.store.dispatch(actions.selectHistoryEntry(entryId));
    this.currentImage = {
      blob: loaded.images?.normalizedBlob,
      width: loaded.meal.width,
      height: loaded.meal.height,
    };
    this.renderCanvas();
    this.switchView('detail');
    this.renderDetail();
  }

  wipeData() {
    if (!confirm('Delete all saved meals? This cannot be undone.')) return;
    this.storageService.deleteOldest(Number.MAX_SAFE_INTEGER).then(() => {
      this.store.dispatch(actions.setHistoryEntries([]));
      this.store.dispatch(actions.clearLogs());
      this.refreshHistory();
      this.toast('All data wiped');
    });
  }

  toast(message) {
    if (!this.elements.notificationDialog) return;
    this.elements.notificationDialog.textContent = message;
    this.elements.notificationDialog.show();
    setTimeout(() => this.elements.notificationDialog.close(), 1600);
  }

  setViewVisibility(section, isActive) {
    if (!section) return;
    section.classList.toggle('is-active', isActive);
    section.classList.toggle('hidden', !isActive);
  }

  switchView(tab) {
    Object.entries(this.elements.views).forEach(([key, section]) => {
      const shouldShow = key === tab || (tab === 'camera' && key === 'camera');
      this.setViewVisibility(section, shouldShow);
    });
  }

  render() {
    const state = this.store.getState();
    const activeTab = selectors.activeTab(state);
    this.elements.tabs.forEach((button) => {
      const isActive = button.dataset.tab === activeTab;
      button.setAttribute('aria-current', isActive ? 'page' : 'false');
      button.classList.toggle('text-emerald-600', isActive);
      button.classList.toggle('border-emerald-500', isActive);
      button.classList.toggle('text-slate-500', !isActive);
      button.classList.toggle('border-transparent', !isActive);
    });
    this.switchView(activeTab);
    if (state.estimation.data) {
      this.setViewVisibility(this.elements.views.result, true);
    }
    if (state.history.selectedId) {
      this.setViewVisibility(this.elements.views.detail, true);
    }
    this.renderCamera();
    this.renderResult();
    this.renderHistory();
    this.renderDetail();
    this.renderLogs();
  }

  renderCamera() {
    const status = selectors.captureStatus(this.store.getState());
    const estimationStatus = selectors.estimationStatus(this.store.getState());
    const isLoading = status === 'processing' || estimationStatus === 'processing';

    this.elements.captureStatus.innerHTML = isLoading
      ? '<span class="sr-only">Processing image</span><progress aria-label="Image processing progress" class="h-1.5 w-40 overflow-hidden rounded-full"></progress>'
      : '';
    this.elements.captureStatus.classList.toggle('hidden', !isLoading);
    this.elements.canvasWrapper.hidden = !this.currentImage;
  }

  renderCanvas() {
    const state = this.store.getState();
    const showBoxes = selectors.showBoxes(state);
    const items = selectors.estimationData(state)?.items || [];
    this.imageCanvas.render({ ...this.currentImage, items, showBoxes });
  }

  renderEditableItems(container) {
    const estimation = selectors.estimationData(this.store.getState());
    if (!estimation) {
      container.innerHTML = '<p class="text-sm text-slate-500">No meal estimated yet.</p>';
      return;
    }
    container.innerHTML = '';
    estimation.items.forEach((item) => {
      const card = document.createElement('section');
      card.className = `item-card space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md ${
        item.included ? '' : 'opacity-50'
      }`;
      const safeName = escapeHtml(item.name ?? '');
      card.innerHTML = `
        <header class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <strong class="text-base font-semibold text-slate-900">${safeName}</strong>
          <span class="text-sm font-medium text-emerald-600">${(item.confidence * 100).toFixed(0)}% confidence</span>
        </header>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-2 text-sm font-medium text-slate-600">Rename
            <input data-action="rename" value="${safeName}" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
          </label>
          <label class="flex flex-col gap-2 text-sm font-medium text-slate-600">Manual kcal
            <input data-action="kcal" type="number" min="0" step="1" value="${
              item.editedKcal ?? ''
            }" placeholder="${item.originalKcal}" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
          </label>
        </div>
        <footer class="flex flex-wrap gap-3 pt-2">
          <button data-action="toggle" type="button" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2">${
            item.included ? 'Exclude' : 'Include'
          }</button>
          <button data-action="reset" type="button" class="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2">Reset kcal</button>
          <button data-action="delete" class="secondary inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2" type="button">Remove</button>
        </footer>
      `;
      card.querySelector('[data-action="rename"]').addEventListener('change', (event) => {
        this.store.dispatch(actions.renameItem(item.id, event.target.value));
      });
      card.querySelector('[data-action="kcal"]').addEventListener('change', (event) => {
        const value = Number.parseInt(event.target.value, 10);
        if (Number.isNaN(value)) {
          this.store.dispatch(actions.resetKcal(item.id));
        } else {
          this.store.dispatch(actions.updateKcal(item.id, value));
        }
      });
      card.querySelector('[data-action="toggle"]').addEventListener('click', () => {
        this.store.dispatch(actions.toggleItem(item.id));
      });
      card.querySelector('[data-action="reset"]').addEventListener('click', () => {
        this.store.dispatch(actions.resetKcal(item.id));
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', () => {
        this.store.dispatch(actions.removeItem(item.id));
      });
      container.append(card);
    });
  }

  renderResult() {
    const estimation = selectors.estimationData(this.store.getState());
    if (!estimation) {
      this.elements.itemsList.innerHTML = '<p class="text-sm text-slate-500">No meal estimated yet.</p>';
      this.elements.resultSummary.textContent = '';
      this.elements.resultNote.textContent = '';
      return;
    }
    const settings = selectors.settings(this.store.getState());
    this.elements.resultSummary.innerHTML = `Meal range <span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-600">${formatRange(
      estimation.range,
      settings.units,
    )}</span>`;
    this.elements.resultNote.textContent = estimation.totalsNote.showNote ? estimation.totalsNote.message : '';
    this.renderEditableItems(this.elements.itemsList);
  }

  renderHistory() {
    const state = this.store.getState();
    const entries = selectors.filteredHistory(state);
    const settings = selectors.settings(state);
    this.elements.historyGrid.innerHTML = '';
    if (!entries.length) {
      this.elements.historyGrid.innerHTML = '<p class="col-span-full text-sm text-slate-500">No meals saved yet.</p>';
      return;
    }
    entries.forEach((entry) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className =
        'group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2';
      card.dataset.id = entry.id;
      const thumbUrl = this.ensureThumbUrl(entry.id, entry.thumbBlob);
      card.innerHTML = `
        <div class="relative h-36 w-full overflow-hidden bg-slate-100">
          <img src="${thumbUrl || PLACEHOLDER_THUMB}" alt="Meal" class="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          <span class="absolute bottom-2 left-2 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white">${formatEnergy(
            entry.totalKcal ?? entry.itemTotal ?? 0,
            settings.units,
          )}</span>
        </div>
        <div class="px-3 py-3 text-sm text-slate-600"><small class="block text-inherit">${highlight(
          entry.items.map((item) => item.name).join(', '),
          state.history.search,
        )}</small></div>
      `;
      card.addEventListener('click', () => this.openDetail(entry.id));
      this.elements.historyGrid.append(card);
    });
  }

  ensureThumbUrl(id, blob) {
    if (this.thumbUrls.has(id)) {
      // If we already have a URL but no blob is available now, return existing.
      // If a new blob arrives, revoke old and create a new URL.
      const existing = this.thumbUrls.get(id);
      if (!blob) return existing;
      try { URL.revokeObjectURL(existing); } catch { /* ignore */ }
      this.thumbUrls.delete(id);
    }
    // Only accept real Blob instances to avoid issues with legacy or malformed data
    if (!(blob instanceof Blob)) return null;
    const url = URL.createObjectURL(blob);
    this.thumbUrls.set(id, url);
    return url;
  }

  renderDetail() {
    if (!this.detailRecord) {
      this.elements.detailItems.innerHTML = '<p class="text-sm text-slate-500">Select a meal to view details.</p>';
      this.elements.detailSummary.textContent = '';
      this.elements.detailNote.textContent = '';
      this.elements.detailAddButton.disabled = true;
      this.elements.detailSave.disabled = true;
      this.elements.detailAddForm.hidden = true;
      return;
    }
    this.elements.detailAddButton.disabled = false;
    this.elements.detailSave.disabled = false;
    const estimation = selectors.estimationData(this.store.getState());
    if (!estimation) return;
    const settings = selectors.settings(this.store.getState());
    this.elements.detailSummary.textContent = `Range ${formatRange(estimation.range, settings.units)}`;
    this.elements.detailNote.textContent = estimation.totalsNote.showNote ? estimation.totalsNote.message : '';
    this.renderEditableItems(this.elements.detailItems);
    this.renderCanvas();
  }

  renderLogs() {
    if (this.elements.logs.hidden) return;
    const logs = selectors.logs(this.store.getState());
    this.elements.logs.textContent = logs
      .map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()} [${entry.level}] ${entry.message}`)
      .join('\n');
  }
}
