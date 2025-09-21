const RANGE_MAP = {
  'very-high': 0.1,
  high: 0.15,
  medium: 0.25,
  low: 0.35,
  'very-low': 0.4,
};

/**
 * Convert a meal confidence enum into a kcal range around a total value.
 * @param {number} totalKcal
 * @param {string} confidenceLevel
 * @returns {{lower: number, upper: number, percentage: number}}
 */
export function confidenceToRange(totalKcal, confidenceLevel) {
  if (!Number.isFinite(totalKcal) || totalKcal < 0) {
    throw new Error('totalKcal must be a non-negative finite number');
  }

  const normalized = (confidenceLevel || '').toLowerCase();
  const pct = RANGE_MAP[normalized];
  if (!pct) {
    throw new Error(`Unsupported confidence level: ${confidenceLevel}`);
  }

  const delta = Math.round(totalKcal * pct);
  return {
    lower: Math.max(0, totalKcal - delta),
    upper: totalKcal + delta,
    percentage: pct,
  };
}

/**
 * Determine whether the UI should show both totals. When the sum of the item
 * calories differs from the model supplied total by more than 10% we expose
 * both values so users understand why the displayed number may not match their
 * expectation.
 *
 * @param {number} itemTotal
 * @param {number} modelTotal
 * @returns {{showNote: boolean, message: string | null}}
 */
export function buildTotalsNote(itemTotal, modelTotal) {
  if (!Number.isFinite(itemTotal) || itemTotal < 0) {
    throw new Error('itemTotal must be a non-negative finite number');
  }
  if (!Number.isFinite(modelTotal) || modelTotal < 0) {
    throw new Error('modelTotal must be a non-negative finite number');
  }

  if (modelTotal === 0) {
    return { showNote: false, message: null };
  }

  const diff = Math.abs(itemTotal - modelTotal) / modelTotal;
  if (diff <= 0.1) {
    return { showNote: false, message: null };
  }

  const message = `Using item sum (${itemTotal} kcal); model total was ${modelTotal} kcal.`;
  return { showNote: true, message };
}
