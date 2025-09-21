const CONVERSION = 4.184;

export function convertEnergy(kcal, units = 'kcal') {
  if (!Number.isFinite(kcal)) {
    throw new Error('kcal must be finite');
  }
  if (units === 'kcal') {
    return Math.round(kcal);
  }
  if (units === 'kJ') {
    return Math.round(kcal * CONVERSION);
  }
  throw new Error(`Unsupported units: ${units}`);
}

export function formatEnergy(kcal, units = 'kcal') {
  const value = convertEnergy(kcal, units);
  return units === 'kJ' ? `${value} kJ` : `${value} kcal`;
}
