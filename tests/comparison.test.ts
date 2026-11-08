import { describe, expect, it } from 'vitest';
import { selectForComparison } from '../src/lib/comparison';

describe('comparison selection', () => {
  it('adds and removes explicit selections without mutating the previous selection', () => {
    const previous = ['fixture-one'];
    expect(selectForComparison(previous, 'fixture-two', true)).toEqual(['fixture-one', 'fixture-two']);
    expect(previous).toEqual(['fixture-one']);
    expect(selectForComparison(['fixture-one', 'fixture-two'], 'fixture-one', false)).toEqual(['fixture-two']);
  });
  it('limits selection to four products while retaining the original selected products', () => {
    const selected = ['fixture-one', 'fixture-two', 'fixture-three', 'fixture-four'];
    expect(selectForComparison(selected, 'fixture-five', true)).toEqual(selected);
  });
  it('does not add duplicates and permits reselecting a previously removed product', () => {
    expect(selectForComparison(['fixture-one'], 'fixture-one', true)).toEqual(['fixture-one']);
    const removed = selectForComparison(['fixture-one'], 'fixture-one', false);
    expect(selectForComparison(removed, 'fixture-one', true)).toEqual(['fixture-one']);
  });
});
