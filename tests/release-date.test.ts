import { describe, expect, it } from 'vitest';
import { formatReleaseDate, televisionSchema } from '../src/lib/data';

const base = {
  id: 'test-tv-release', manufacturer: 'テスト', model: 'T-1', screen_inches: '55', weight_kg: '12',
  vesa_width_mm: '300', vesa_height_mm: '300', source_url: 'https://www.sony.jp/bravia/',
};

describe('television release date', () => {
  it('accepts a full date or a month, with a source', () => {
    for (const release_date of ['2025-06-07', '2025-06']) {
      expect(televisionSchema.parse({ ...base, release_date, release_source_url: 'https://www.sony.jp/bravia/' }).release_date).toBe(release_date);
    }
  });

  it('keeps the date optional, and treats a missing CMS field as blank', () => {
    expect(televisionSchema.parse({ ...base, release_date: '', release_source_url: '' })).toMatchObject({ release_date: null, release_source_url: null });
    expect(televisionSchema.parse(base)).toMatchObject({ release_date: null, release_source_url: null });
  });

  it('rejects malformed or impossible dates and dates without a source', () => {
    for (const release_date of ['2025/06/07', '2025-13', '2025-02-30', '2025-6-7']) {
      expect(() => televisionSchema.parse({ ...base, release_date, release_source_url: 'https://www.sony.jp/bravia/' })).toThrow();
    }
    expect(() => televisionSchema.parse({ ...base, release_date: '2025-06-07' })).toThrow(/出典/u);
  });

  it('formats dates for display', () => {
    expect(formatReleaseDate('2025-06-07')).toBe('2025年6月7日');
    expect(formatReleaseDate('2025-06')).toBe('2025年6月');
  });
});
