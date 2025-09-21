import 'fake-indexeddb/auto';
import { StorageService } from './storage.js';

function makeFakeBlob() {
  const buffer = Uint8Array.from([5, 6, 7, 8]).buffer;
  return {
    type: 'image/webp',
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

describe('StorageService', () => {
  test('persists and retrieves meals', async () => {
    // Why: Guarantees History view can reload data across sessions.
    const service = new StorageService();
    const meal = {
      items: [{ name: 'Toast', kcal: 120 }],
      totalKcal: 120,
      mealConfidence: 'high',
    };
    const id = await service.saveMeal(meal, {
      normalizedBlob: makeFakeBlob(),
      thumbBlob: makeFakeBlob(),
    });
    const loaded = await service.loadMeal(id);
    expect(loaded.meal.items[0].name).toBe('Toast');
    expect(loaded.images.normalizedBlob).toBeInstanceOf(Blob);
    const meals = await service.listMeals();
    expect(meals[0].thumbBlob).toBeInstanceOf(Blob);
  });

  test('saves with real Blob without transaction idle errors', async () => {
    // Why: Reproduces browser path where real Blob.arrayBuffer() is awaited
    // and ensures we do it before starting the IDB transaction.
    const service = new StorageService();
    const normalizedBlob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/webp' });
    const thumbBlob = new Blob([Uint8Array.from([9, 8, 7, 6])], { type: 'image/webp' });
    const id = await service.saveMeal(
      { items: [], totalKcal: 0, mealConfidence: 'medium' },
      { normalizedBlob, thumbBlob },
    );
    const listed = await service.listMeals();
    const entry = listed.find((e) => e.id === id);
    expect(entry).toBeTruthy();
    expect(entry.thumbBlob).toBeInstanceOf(Blob);
    const loaded = await service.loadMeal(id);
    expect(loaded.images.normalizedBlob).toBeInstanceOf(Blob);
  });

  test('deleteOldest removes the earliest entries', async () => {
    // Why: Supports quota management UI when storage runs low.
    const service = new StorageService();
    await service.saveMeal({ id: '1', createdAt: 1, items: [], totalKcal: 0 }, { normalizedBlob: makeFakeBlob(), thumbBlob: makeFakeBlob() });
    await service.saveMeal({ id: '2', createdAt: 2, items: [], totalKcal: 0 }, { normalizedBlob: makeFakeBlob(), thumbBlob: makeFakeBlob() });
    const removed = await service.deleteOldest(1);
    expect(removed).toContain('1');
    const remaining = await service.listMeals();
    expect(remaining.find((m) => m.id === '1')).toBeUndefined();
  });
});
