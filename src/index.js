import { createStore } from './store/store.js';
import { PreprocessService } from './services/preprocess.js';
import { EstimationService } from './services/estimation.js';
import { StorageService } from './services/storage.js';
import { App } from './ui/app.js';

const store = createStore();
const preprocessService = new PreprocessService();
const estimationService = new EstimationService({ maxSchemaRetries: 1 });
const storageService = new StorageService();

document.addEventListener('DOMContentLoaded', () => {
  const app = new App({
    store,
    preprocessService,
    estimationService,
    storageService,
    root: document,
  });
  app.init();
});
