const DB_NAME = 'caloriecam';
const DB_VERSION = 1;
const MEALS_STORE = 'meals';
const IMAGES_STORE = 'images';

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEALS_STORE)) {
        const meals = db.createObjectStore(MEALS_STORE, { keyPath: 'id' });
        meals.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `meal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function blobToArrayBuffer(blob) {
  if (!blob) return null;
  // Modern browsers and Node 18+
  if (typeof blob.arrayBuffer === 'function') {
    try {
      return await blob.arrayBuffer();
    } catch {
      // fall through to other strategies
    }
  }
  // Generic fallback via Fetch/Response
  if (typeof Response !== 'undefined') {
    try {
      return await new Response(blob).arrayBuffer();
    } catch {
      // continue
    }
  }
  // Legacy fallback via FileReader (browser only)
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('FileReader error'));
      fr.readAsArrayBuffer(blob);
    });
  }
  throw new Error('BLOB_READ_UNSUPPORTED');
}

export class StorageService {
  constructor({ dbPromise } = {}) {
    this.dbPromise = dbPromise || openDatabase();
  }

  async #db() {
    return this.dbPromise;
  }

  async saveMeal(meal, { normalizedBlob, thumbBlob }) {
    if (!meal || typeof meal !== 'object') {
      throw new Error('meal must be an object');
    }
    // Important: convert blobs to ArrayBuffers BEFORE opening a transaction.
    // Some browsers auto-close readwrite transactions when the event loop yields
    // (e.g., awaiting arrayBuffer()) without pending IDB requests, leading to
    // "TransactionInactiveError". Reading buffers up-front avoids that.
  const normalizedBuffer = await blobToArrayBuffer(normalizedBlob);
  const thumbBuffer = await blobToArrayBuffer(thumbBlob);

    const db = await this.#db();
    const tx = db.transaction([MEALS_STORE, IMAGES_STORE], 'readwrite');
    const id = meal.id || generateId();
    const record = {
      ...clone(meal),
      id,
      createdAt: meal.createdAt || Date.now(),
    };
    tx.objectStore(MEALS_STORE).put(record);
    tx
      .objectStore(IMAGES_STORE)
      .put({
        id,
        normalizedBuffer,
        thumbBuffer,
        normalizedType: normalizedBlob?.type || 'image/webp',
        thumbType: thumbBlob?.type || normalizedBlob?.type || 'image/webp',
      });
    await waitForTransaction(tx);
    return id;
  }

  async loadMeal(id) {
    const db = await this.#db();
    const tx = db.transaction([MEALS_STORE, IMAGES_STORE], 'readonly');
    const mealReq = tx.objectStore(MEALS_STORE).get(id);
    const imgReq = tx.objectStore(IMAGES_STORE).get(id);
    const [meal, image] = await Promise.all([promisifyRequest(mealReq), promisifyRequest(imgReq)]);
    await waitForTransaction(tx);
    if (!meal) return null;
    return {
      meal,
      images: image
        ? {
            normalizedBlob: image.normalizedBuffer
              ? new Blob([image.normalizedBuffer], { type: image.normalizedType })
              : null,
            thumbBlob: image.thumbBuffer
              ? new Blob([image.thumbBuffer], { type: image.thumbType })
              : null,
          }
        : null,
    };
  }

  async deleteMeal(id) {
    const db = await this.#db();
    const tx = db.transaction([MEALS_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(MEALS_STORE).delete(id);
    tx.objectStore(IMAGES_STORE).delete(id);
    await waitForTransaction(tx);
  }

  async listMeals() {
    const db = await this.#db();
    const tx = db.transaction([MEALS_STORE, IMAGES_STORE], 'readonly');
    const mealsReq = tx.objectStore(MEALS_STORE).index('createdAt').getAll();
    const imagesReq = tx.objectStore(IMAGES_STORE).getAll();
    const [meals, images] = await Promise.all([promisifyRequest(mealsReq), promisifyRequest(imagesReq)]);
    await waitForTransaction(tx);
    const imageMap = new Map(
      (images || []).map((image) => [
        image.id,
        image.thumbBuffer
          ? new Blob([image.thumbBuffer], { type: image.thumbType })
          : image.normalizedBuffer
          ? new Blob([image.normalizedBuffer], { type: image.normalizedType })
          : null,
      ]),
    );
    return (meals || [])
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((meal) => ({ ...meal, thumbBlob: imageMap.get(meal.id) || null }));
  }

  async deleteOldest(count) {
    const meals = await this.listMeals();
    const targets = meals.slice(-count);
    await Promise.all(targets.map((entry) => this.deleteMeal(entry.id)));
    return targets.map((entry) => entry.id);
  }
}
