import { confidenceToRange, buildTotalsNote } from './range.js';

describe('confidenceToRange', () => {
  test('computes ±15% for high confidence', () => {
    // Why: Ensures the meal range headline matches the specification mapping.
    const range = confidenceToRange(600, 'high');
    expect(range).toEqual({ lower: 510, upper: 690, percentage: 0.15 });
  });

  test('throws for unsupported level', () => {
    // Why: Guards against silent failures when the provider changes enums.
    expect(() => confidenceToRange(500, 'mystery')).toThrow(/Unsupported/);
  });
});

describe('buildTotalsNote', () => {
  test('hides note when difference is within 10%', () => {
    // Why: Prevents noisy UI when totals already agree closely.
    expect(buildTotalsNote(100, 105)).toEqual({ showNote: false, message: null });
  });

  test('shows note when model diverges', () => {
    // Why: Communicates to users when the UI deviates from the model output.
    expect(buildTotalsNote(120, 90)).toEqual({
      showNote: true,
      message: 'Using item sum (120 kcal); model total was 90 kcal.',
    });
  });
});
