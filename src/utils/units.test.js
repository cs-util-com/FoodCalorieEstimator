import { convertEnergy, formatEnergy } from './units.js';

describe('energy utils', () => {
  test('converts to kJ', () => {
    // Why: Settings allow switching between kcal and kJ.
    expect(convertEnergy(100, 'kJ')).toBe(418);
  });

  test('formats kcal by default', () => {
    // Why: UI badges should render consistent unit strings.
    expect(formatEnergy(123.4)).toBe('123 kcal');
  });

  test('convertEnergy rejects unsupported units', () => {
    expect(() => convertEnergy(50, 'cal')).toThrow(/unsupported/i);
  });
});
