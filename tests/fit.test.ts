import {describe, expect, it} from 'vitest';
import {fitBreakdown, sortByStatus} from '../src/lib/fit';
import type {Compatibility, Stand, Television} from '../src/lib/data';

const tv: Television = {id: 'fixture-tv', manufacturer: 'Fixture', model: 'FX-1', screen_inches: 65, weight_kg: 12.9, vesa_width_mm: 400, vesa_height_mm: 200, source_url: null, release_date: null};
const stand: Stand = {id: 'fixture-stand', manufacturer: 'Fixture', sku: 'FS-1', stand_type: 'floor', max_weight_kg: 40, vesa_patterns: [{width: 400, height: 200}, {width: 400, height: 400}], source_url: 'https://fixture.invalid/', product_url: null};

describe('fit breakdown', () => {
  it('reports VESA match and weight margin', () => {
    expect(fitBreakdown(tv, stand)).toEqual({vesaMatch: true, weightMarginKg: 27.1});
  });
  it('does not treat swapped width and height as a VESA match', () => {
    expect(fitBreakdown({...tv, vesa_width_mm: 200, vesa_height_mm: 400}, stand).vesaMatch).toBe(false);
  });
  it('returns null when the television values are not confirmed', () => {
    expect(fitBreakdown({...tv, weight_kg: null, vesa_width_mm: null, vesa_height_mm: null}, stand)).toEqual({vesaMatch: null, weightMarginKg: null});
  });
  it('reports a negative margin when the stand is overloaded', () => {
    expect(fitBreakdown({...tv, weight_kg: 45}, stand).weightMarginKg).toBe(-5);
  });
});

describe('sortByStatus', () => {
  const entry = (id: string, status: Compatibility['status'] | null) => ({id, compatibility: status ? {status} as Compatibility : null});
  it('orders confirmed, candidate, unknown, incompatible and keeps the original order within a status', () => {
    const sorted = sortByStatus([entry('a', 'incompatible'), entry('b', null), entry('c', 'candidate'), entry('d', 'confirmed'), entry('e', 'candidate')]);
    expect(sorted.map(item => item.id)).toEqual(['d', 'c', 'e', 'b', 'a']);
  });
});
