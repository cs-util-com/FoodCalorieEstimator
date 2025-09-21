import { parseEstimationResponse } from './schema.js';

const SAMPLE = {
  version: '1.1',
  model_id: 'gemini-2.5',
  meal_confidence: 'high',
  total_kcal: 720,
  items: [
    {
      name: 'Avocado toast',
      kcal: 320,
      confidence: 0.82,
      estimated_grams: 140,
      used_scale_ref: true,
      scale_ref: 'plate',
      bbox_1000: { x: 100, y: 200, w: 300, h: 250 },
      notes: 'Half slice',
    },
  ],
};

describe('parseEstimationResponse', () => {
  test('returns normalised object for valid payload', () => {
    // Why: Guarantees predictable structure for downstream reducers and UI logic.
    const parsed = parseEstimationResponse(SAMPLE);
    expect(parsed.items[0]).toMatchObject({
      name: 'Avocado toast',
      kcal: 320,
      confidence: 0.82,
      estimated_grams: 140,
      used_scale_ref: true,
      scale_ref: 'plate',
      bbox_1000: { x: 100, y: 200, w: 300, h: 250 },
      notes: 'Half slice',
    });
  });

  test('throws on invalid version', () => {
    // Why: Prevents silently accepting incompatible schema revisions.
    expect(() => parseEstimationResponse({ ...SAMPLE, version: '1.0' })).toThrow(/version/);
  });

  test('enforces confidence enum', () => {
    // Why: Ensures range mapping stays within the supported set.
    expect(() => parseEstimationResponse({ ...SAMPLE, meal_confidence: 'approx' })).toThrow(/meal_confidence/);
  });

  test('enforces optional fields when provided', () => {
    // Why: Highlights provider contract drift early via unit test failure.
    const invalid = {
      ...SAMPLE,
      items: [
        {
          ...SAMPLE.items[0],
          bbox_1000: { x: -1, y: 0, w: 1, h: 1 },
        },
      ],
    };
    expect(() => parseEstimationResponse(invalid)).toThrow(/bbox_1000/);
  });
});
