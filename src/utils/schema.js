const ALLOWED_CONFIDENCE = new Set(['very-low', 'low', 'medium', 'high', 'very-high']);
const ALLOWED_SCALE_REFS = new Set(['fork', 'spoon', 'credit_card', 'plate', 'chopsticks', 'other']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseBox(raw) {
  if (raw == null) return null;
  assert(typeof raw === 'object', 'bbox_1000 must be an object');
  const hasMinMax = ['x_min', 'y_min', 'x_max', 'y_max'].every((key) => key in raw);
  const hasRect = ['x', 'y', 'w', 'h'].every((key) => key in raw);

  if (!hasMinMax && !hasRect) {
    throw new Error('bbox_1000 must include either (x_min,y_min,x_max,y_max) or (x,y,w,h)');
  }

  if (hasMinMax) {
    const { x_min: xMin, y_min: yMin, x_max: xMax, y_max: yMax } = raw;
    for (const key of ['x_min', 'y_min', 'x_max', 'y_max']) {
      const value = raw[key];
      assert(Number.isInteger(value) && value >= 0 && value <= 1000, `bbox_1000.${key} must be an integer between 0 and 1000`);
    }
    assert(xMin <= xMax, 'bbox_1000.x_max must be greater than or equal to x_min');
    assert(yMin <= yMax, 'bbox_1000.y_max must be greater than or equal to y_min');
    return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
  }

  const { x, y, w, h } = raw;
  for (const key of ['x', 'y', 'w', 'h']) {
    const value = raw[key];
    assert(Number.isInteger(value) && value >= 0 && value <= 1000, `bbox_1000.${key} must be an integer between 0 and 1000`);
  }
  return { x, y, w, h };
}

function parseItem(raw) {
  assert(raw && typeof raw === 'object', 'Each item must be an object');
  const name = String(raw.name || '').trim();
  assert(name.length > 0, 'Item name must be a non-empty string');

  const kcal = raw.kcal;
  assert(Number.isInteger(kcal) && kcal >= 0, 'Item kcal must be a non-negative integer');

  const confidence = raw.confidence;
  assert(typeof confidence === 'number' && confidence >= 0 && confidence <= 1, 'Item confidence must be between 0 and 1');

  const estimatedGrams = raw.estimated_grams;
  if (estimatedGrams != null) {
    assert(Number.isInteger(estimatedGrams) && estimatedGrams >= 0, 'estimated_grams must be a non-negative integer');
  }

  const usedScaleRef = Boolean(raw.used_scale_ref);
  const scaleRef = raw.scale_ref;
  if (usedScaleRef) {
    assert(ALLOWED_SCALE_REFS.has(scaleRef), 'scale_ref must be known when used_scale_ref is true');
  }

  const bbox = parseBox(raw.bbox_1000);
  const notes = raw.notes == null ? null : String(raw.notes);

  return {
    name,
    kcal,
    confidence,
    estimated_grams: estimatedGrams ?? null,
    used_scale_ref: usedScaleRef,
    scale_ref: usedScaleRef ? scaleRef : null,
    bbox_1000: bbox,
    notes,
  };
}

/**
 * Validate and normalise the Gemini estimation JSON structure.
 * @param {unknown} payload
 * @returns {{ version: string, model_id: string, meal_confidence: string, total_kcal: number, items: Array }}
 */
export function parseEstimationResponse(payload) {
  assert(payload && typeof payload === 'object', 'Response must be an object');

  const { version, model_id: modelId, meal_confidence: mealConfidence, total_kcal: totalKcal, items } = payload;

  assert(version === '1.1', 'version must be "1.1"');
  assert(typeof modelId === 'string' && modelId.trim().length > 0, 'model_id must be a string');

  const normalizedConfidence = String(mealConfidence || '').toLowerCase();
  assert(ALLOWED_CONFIDENCE.has(normalizedConfidence), 'meal_confidence must be a valid enum value');

  assert(Number.isInteger(totalKcal) && totalKcal >= 0, 'total_kcal must be a non-negative integer');
  assert(Array.isArray(items) && items.length > 0, 'items must be a non-empty array');

  const parsedItems = items.map(parseItem);

  return {
    version,
    model_id: modelId,
    meal_confidence: normalizedConfidence,
    total_kcal: totalKcal,
    items: parsedItems,
  };
}
