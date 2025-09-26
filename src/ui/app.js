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
    this.cameraStream = null;
    this.cameraStarting = false;
    this.cameraErrorMessage = '';
    this.cameraStartPromise = null;
  }

  init() {
    this.cacheElements();
    this.imageCanvas = new ImageCanvas(this.elements.resultCanvas, this.elements.canvasOverlay);
    this.bindEvents();
    this.loadSettings();
    this.attachOnlineHandlers();
    this.startCamera();
    this.store.subscribe(() => this.render());
    this.render();
    this.refreshHistory();
    this.registerServiceWorker();
  }

  cacheElements() {
    this.elements = {
      appTitle: this.root.getElementById('app-title'),
      appSubtitle: this.root.getElementById('app-subtitle'),
      previewStage: this.root.getElementById('preview-stage'),
      cameraPreview: this.root.getElementById('camera-preview'),
      resultCanvas: this.root.getElementById('result-canvas'),
      canvasOverlay: this.root.getElementById('canvas-overlay'),
      rangeOverlay: this.root.getElementById('range-overlay'),
      cameraError: this.root.getElementById('camera-error'),
      cameraErrorMessage: this.root.getElementById('camera-error-message'),
      retryCamera: this.root.getElementById('retry-camera'),
      captureStatus: this.root.getElementById('capture-status'),
      controlBar: this.root.getElementById('control-bar'),
      importButton: this.root.getElementById('import-button'),
      captureButton: this.root.getElementById('capture-button'),
      historyButton: this.root.getElementById('history-button'),
      settingsButton: this.root.getElementById('settings-button'),
      settingsClose: this.root.getElementById('settings-close'),
      fileInput: this.root.getElementById('file-input'),
      views: {
        camera: this.root.getElementById('camera-shell'),
        result: this.root.getElementById('result-view'),
        history: this.root.getElementById('history-view'),
        detail: this.root.getElementById('detail-view'),
        settings: this.root.getElementById('settings-view'),
      },
      demoButton: this.root.getElementById('demo-button'),
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
    const { fileInput, importButton, captureButton, historyButton, settingsButton, settingsClose, retryCamera, previewStage, rangeOverlay } =
      this.elements;

    fileInput?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        console.log('[CalorieCam] File selected:', { name: file.name, size: file.size, type: file.type });
        this.store.dispatch(actions.addLog(`File selected: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'info'));
        this.handleFile(file);
      }
    });

    importButton?.addEventListener('click', () => {
      if (!fileInput) return;
      fileInput.value = '';
      fileInput.click();
    });

    captureButton?.addEventListener('click', () => this.handleCaptureClick());

    historyButton?.addEventListener('click', () => {
      const activeTab = selectors.activeTab(this.store.getState());
      const nextTab = activeTab === 'history' ? 'camera' : 'history';
      this.store.dispatch(actions.setActiveTab(nextTab));
    });

    settingsButton?.addEventListener('click', () => this.openSettings());
    settingsClose?.addEventListener('click', () => this.closeSettings());
    retryCamera?.addEventListener('click', () => this.retryCamera());

    this.elements.demoButton?.addEventListener('click', () => this.runDemo());

    previewStage?.addEventListener('click', (event) => {
      if (event.target.closest('.camera-error') || event.target.closest('#range-overlay')) {
        return;
      }
      if (!selectors.estimationData(this.store.getState())) return;
      this.toggleBoxes();
    });

    rangeOverlay?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!this.elements.views?.result?.classList.contains('is-active')) return;
      this.elements.views.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    this.elements.addItemButton?.addEventListener('click', () => {
      if (!this.elements.addItemForm) return;
      this.elements.addItemForm.hidden = !this.elements.addItemForm.hidden;
    });

    this.elements.addItemForm?.addEventListener('submit', this.handleManualItemForm(this.elements.addItemForm));

    this.elements.saveMeal?.addEventListener('click', () => this.saveMeal());

    this.elements.detailAddButton?.addEventListener('click', () => {
      if (!this.elements.detailAddForm) return;
      this.elements.detailAddForm.hidden = !this.elements.detailAddForm.hidden;
    });

    this.elements.detailAddForm?.addEventListener('submit', this.handleManualItemForm(this.elements.detailAddForm));

    this.elements.detailSave?.addEventListener('click', () => this.saveMeal());

    this.elements.historySearch?.addEventListener('input', (event) => {
      this.store.dispatch(actions.setHistorySearch(event.target.value));
      this.renderHistory();
    });

    this.elements.detailClose?.addEventListener('click', () => {
      this.store.dispatch(actions.selectHistoryEntry(null));
      this.store.dispatch(actions.captureReset());
      this.detailRecord = null;
      this.store.dispatch(actions.setActiveTab('history'));
    });

    this.elements.detailDelete?.addEventListener('click', () => this.deleteDetail());
    this.elements.detailExport?.addEventListener('click', () => this.exportDetail());

    this.elements.settingsForm?.addEventListener('submit', (event) => {
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

    this.elements.logsToggle?.addEventListener('click', () => {
      if (!this.elements.logs) return;
      this.elements.logs.hidden = !this.elements.logs.hidden;
      this.renderLogs();
    });

    this.elements.wipeData?.addEventListener('click', () => this.wipeData());

    window.addEventListener('resize', () => this.renderCanvas());
  }

  attachOnlineHandlers() {
    window.addEventListener('offline', () => this.toast('You are offline. Estimation disabled.'));
    window.addEventListener('online', () => this.toast('Back online.'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseCamera();
      } else if (selectors.activeTab(this.store.getState()) === 'camera') {
        this.startCamera();
      }
    });
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

  async handleFile(file, options = {}) {
    this.store.dispatch(actions.captureStart(file));
    const { width: previewWidth, height: previewHeight } = options;
    if (previewWidth && previewHeight) {
      this.currentImage = { blob: file, width: previewWidth, height: previewHeight };
      this.renderCanvas();
    }
    const settings = selectors.settings(this.store.getState());
    try {
      const t0 = performance.now?.() ?? Date.now();
      this.store.dispatch(actions.addLog('Preprocess: start', 'info'));
      console.log('[CalorieCam] Preprocess started');
      const preprocess = await this.preprocessService.preprocess(file);
      const t1 = performance.now?.() ?? Date.now();
  this.store.dispatch(actions.captureDone(preprocess));
  this.currentImage = { blob: preprocess.normalizedBlob, width: preprocess.width, height: preprocess.height };
  this.renderCanvas();
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

  async handleCaptureClick() {
    const state = this.store.getState();
    const activeTab = selectors.activeTab(state);
    if (activeTab !== 'camera') {
      this.store.dispatch(actions.setActiveTab('camera'));
      this.startCamera();
      return;
    }
    const captureStatus = selectors.captureStatus(state);
    const estimationStatus = selectors.estimationStatus(state);
    if (captureStatus === 'processing' || estimationStatus === 'processing') {
      return;
    }
    if (!this.cameraStream) {
      await this.startCamera();
      if (!this.cameraStream) {
        return;
      }
    }
    await this.capturePhoto();
  }

  async capturePhoto() {
    if (!this.elements.cameraPreview) {
      this.toast('Camera unavailable.');
      return;
    }
    if (!this.cameraStream) {
      await this.startCamera();
      if (!this.cameraStream) {
        this.toast('Camera permission needed.');
        return;
      }
    }
      this.store.dispatch(actions.addLog('Camera capture triggered', 'info'));
    const video = this.elements.cameraPreview;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      this.toast('Camera warming up…');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.toast('Capture failed.');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    try {
      const exportBlob = (type) =>
        new Promise((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) {
              resolve(result);
            } else {
              reject(new Error('Capture failed'));
            }
          }, type, 0.92);
        });
  const blob = await exportBlob('image/webp').catch(() => exportBlob('image/png'));
  const extension = blob.type === 'image/png' ? 'png' : 'webp';
  const file = new File([blob], `camera-${Date.now()}.${extension}`, { type: blob.type || 'image/webp' });
      await this.handleFile(file, { width, height });
    } catch (error) {
      console.error('[CalorieCam] Capture failed', error);
      this.toast('Capture failed. Try again.');
    }
  }

  async startCamera() {
    if (this.cameraStream) {
      return this.cameraStream;
    }
    if (document.hidden) {
      return null;
    }
    if (this.cameraStartPromise) {
      await this.cameraStartPromise;
      return this.cameraStream;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.showCameraError('Camera not supported on this device. Use Import instead.');
      return null;
    }
    this.cameraStarting = true;
    this.cameraStartPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        this.cameraStream = stream;
        if (this.elements.cameraPreview) {
          this.elements.cameraPreview.srcObject = stream;
          try {
            await this.elements.cameraPreview.play?.();
          } catch {
            /* ignore play errors */
          }
        }
        this.clearCameraError();
        return stream;
      } catch (error) {
        const name = error?.name;
        const friendly = name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Camera access denied. Allow access or use Import.'
          : 'Camera unavailable. Allow access or use Import.';
        this.showCameraError(friendly);
        this.store.dispatch(actions.addLog(`Camera error: ${error?.message || error}`, 'error'));
        this.pauseCamera();
        return null;
      }
    })();
    const stream = await this.cameraStartPromise;
    this.cameraStarting = false;
    this.cameraStartPromise = null;
    this.renderCamera();
    return stream;
  }

  pauseCamera() {
    if (!this.cameraStream) return;
    try {
      this.cameraStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
    } finally {
      this.cameraStream = null;
      if (this.elements.cameraPreview) {
        this.elements.cameraPreview.srcObject = null;
      }
      this.renderCamera();
    }
  }

  retryCamera() {
    this.pauseCamera();
    this.cameraErrorMessage = '';
    this.startCamera();
  }

  openSettings() {
    this.store.dispatch(actions.setActiveTab('settings'));
  }

  closeSettings() {
    this.store.dispatch(actions.setActiveTab('camera'));
  }

  toggleBoxes() {
    const state = this.store.getState();
    if (!selectors.estimationData(state)) return;
    const next = !selectors.showBoxes(state);
    this.store.dispatch(actions.setShowBoxes(next));
    this.store.dispatch(actions.addLog(`Show boxes: ${next}`, 'info'));
    this.renderCanvas();
  }

  showCameraError(message) {
    this.cameraErrorMessage = message;
    if (this.elements.cameraErrorMessage) {
      this.elements.cameraErrorMessage.textContent = message;
    }
    this.renderCamera();
  }

  clearCameraError() {
    this.cameraErrorMessage = '';
    this.renderCamera();
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
    this.elements.views?.result?.classList.add('is-active');
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
    this.store.dispatch(actions.setActiveTab('history'));
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
    this.store.dispatch(actions.setActiveTab('history'));
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

  switchView(tab, state = this.store.getState()) {
    const views = this.elements.views || {};
    const detailActive = tab === 'history' && Boolean(state.history?.selectedId);
    const hasEstimation = Boolean(state.estimation?.data);
    views.camera?.classList.toggle('is-active', tab === 'camera');
    views.result?.classList.toggle('is-active', tab === 'camera' && hasEstimation);
    views.history?.classList.toggle('is-active', tab === 'history' && !detailActive);
    views.detail?.classList.toggle('is-active', tab === 'history' && detailActive);
    views.settings?.classList.toggle('is-active', tab === 'settings');
    if (this.elements.controlBar) {
      this.elements.controlBar.classList.toggle('hidden', tab === 'settings');
    }
    if (tab === 'camera' && !document.hidden) {
      void this.startCamera();
    } else if (tab !== 'camera') {
      this.pauseCamera();
    }
  }

  render() {
    const state = this.store.getState();
    const activeTab = selectors.activeTab(state);
    this.switchView(activeTab, state);
    this.updateHeader(activeTab, state);
    this.updateControls(activeTab, state);
    this.renderCamera();
    this.renderResult();
    this.renderHistory();
    this.renderDetail();
    this.renderLogs();
  }

  updateHeader(tab, state) {
    if (!this.elements.appSubtitle) return;
    let subtitle = 'Camera';
    if (tab === 'history') {
      subtitle = state.history?.selectedId ? 'Meal detail' : 'History';
    } else if (tab === 'settings') {
      subtitle = 'Settings';
    }
    this.elements.appSubtitle.textContent = subtitle;
  }

  updateControls(tab, state) {
    if (this.elements.captureButton) {
      this.elements.captureButton.setAttribute('aria-current', tab === 'camera' ? 'page' : 'false');
    }
    if (this.elements.historyButton) {
      const historyActive = tab === 'history';
      this.elements.historyButton.setAttribute('aria-current', historyActive ? 'page' : 'false');
    }
  }

  renderCamera() {
    const state = this.store.getState();
    const status = selectors.captureStatus(state);
    const estimationStatus = selectors.estimationStatus(state);
    const isLoading = status === 'processing' || estimationStatus === 'processing';

    if (this.elements.captureStatus) {
      this.elements.captureStatus.innerHTML = isLoading ? '<progress aria-label="Image processing progress"></progress>' : '';
    }

    const hasImage = Boolean(this.currentImage);
    this.elements.resultCanvas?.classList.toggle('is-visible', hasImage);
    this.elements.cameraPreview?.classList.toggle('is-hidden', hasImage);

    if (this.elements.cameraError) {
      if (this.cameraErrorMessage) {
        this.elements.cameraError.hidden = false;
        if (this.elements.cameraErrorMessage) {
          this.elements.cameraErrorMessage.textContent = this.cameraErrorMessage;
        }
      } else {
        this.elements.cameraError.hidden = true;
      }
    }
  }

  renderCanvas() {
    const state = this.store.getState();
    const showBoxes = selectors.showBoxes(state);
    const items = selectors.estimationData(state)?.items || [];
    const baseImage = this.currentImage ? { ...this.currentImage } : {};
    this.imageCanvas.render({ ...baseImage, items, showBoxes });
  }

  renderEditableItems(container) {
    const estimation = selectors.estimationData(this.store.getState());
    if (!estimation) {
      container.innerHTML = '<p class="muted">No meal estimated yet.</p>';
      return;
    }
    container.innerHTML = '';
    estimation.items.forEach((item) => {
      const card = document.createElement('section');
      card.className = `item-card ${item.included ? '' : 'excluded'}`;
      const safeName = escapeHtml(item.name ?? '');
      card.innerHTML = `
        <header class="grid">
          <strong>${safeName}</strong>
          <span>${(item.confidence * 100).toFixed(0)}% confidence</span>
        </header>
        <label>Rename <input data-action="rename" value="${safeName}" /></label>
        <label>Manual kcal <input data-action="kcal" type="number" min="0" step="1" value="${
          item.editedKcal ?? ''
        }" placeholder="${item.originalKcal}" /></label>
        <footer class="grid">
          <button data-action="toggle" type="button">${item.included ? 'Exclude' : 'Include'}</button>
          <button data-action="reset" type="button">Reset kcal</button>
          <button data-action="delete" class="secondary" type="button">Remove</button>
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
      this.elements.itemsList.innerHTML = '<p class="muted">No meal estimated yet.</p>';
      this.elements.resultSummary.textContent = '';
      this.elements.resultNote.textContent = '';
      if (this.elements.rangeOverlay) {
        this.elements.rangeOverlay.hidden = true;
      }
      return;
    }
    const settings = selectors.settings(this.store.getState());
    const rangeText = formatRange(estimation.range, settings.units);
    this.elements.resultSummary.innerHTML = rangeText
      ? `Meal range <span class="range-badge">${rangeText}</span>`
      : 'Meal range <span class="range-badge">–</span>';
    this.elements.resultNote.textContent = estimation.totalsNote.showNote ? estimation.totalsNote.message : '';
    if (this.elements.rangeOverlay) {
      if (rangeText) {
        this.elements.rangeOverlay.textContent = rangeText;
        this.elements.rangeOverlay.hidden = false;
      } else {
        this.elements.rangeOverlay.hidden = true;
      }
    }
    this.renderEditableItems(this.elements.itemsList);
  }

  renderHistory() {
    const state = this.store.getState();
    const entries = selectors.filteredHistory(state);
    const settings = selectors.settings(state);
    this.elements.historyGrid.innerHTML = '';
    entries.forEach((entry) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'thumbnail';
      card.dataset.id = entry.id;
      const thumbUrl = this.ensureThumbUrl(entry.id, entry.thumbBlob);
      card.innerHTML = `
        <img src="${thumbUrl || PLACEHOLDER_THUMB}" alt="Meal" />
        <span>${formatEnergy(entry.totalKcal ?? entry.itemTotal ?? 0, settings.units)}</span>
      `;
      card.addEventListener('click', () => this.openDetail(entry.id));
      const names = entry.items.map((item) => item.name).join(', ');
      const caption = document.createElement('small');
      caption.innerHTML = highlight(names, state.history.search);
      caption.className = 'muted';
      card.append(caption);
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
      this.elements.detailItems.innerHTML = '<p class="muted">Select a meal to view details.</p>';
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
