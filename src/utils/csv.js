function formatItems(items) {
  return items
    .map((item) => {
      const kcal = item.editedKcal ?? item.originalKcal ?? item.kcal;
      return `${item.name} (${kcal} kcal)`;
    })
    .join('; ');
}

export function mealToCsv(meal) {
  if (!meal || typeof meal !== 'object') {
    throw new Error('meal must be an object');
  }
  const { id, createdAt, totalKcal, mealConfidence, items } = meal;
  if (!id) {
    throw new Error('meal requires an id');
  }
  const header = 'id,createdAt,totalKcal,mealConfidence,itemsCount,itemsList';
  const row = [
    JSON.stringify(id),
    createdAt || Date.now(),
    totalKcal ?? 0,
    JSON.stringify(mealConfidence || ''),
    items?.length ?? 0,
    JSON.stringify(formatItems(items || [])),
  ].join(',');
  return `${header}\n${row}`;
}
