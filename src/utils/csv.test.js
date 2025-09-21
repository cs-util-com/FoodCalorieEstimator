import { mealToCsv } from './csv.js';

describe('mealToCsv', () => {
  test('creates CSV string with item summary', () => {
    // Why: Ensures export feature produces human-readable output.
    const meal = {
      id: 'abc',
      createdAt: 1700000000000,
      totalKcal: 450,
      mealConfidence: 'high',
      items: [
        { name: 'Toast', originalKcal: 200 },
        { name: 'Eggs', originalKcal: 250 },
      ],
    };
    const csv = mealToCsv(meal);
    expect(csv).toContain('Toast (200 kcal)');
    expect(csv.split('\n')).toHaveLength(2);
  });

  test('throws without id', () => {
    // Why: IDs are required for downstream sharing and dedupe.
    expect(() => mealToCsv({})).toThrow(/id/);
  });
});
