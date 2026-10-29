import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { aggregate, LEVEL_ORDER } from '../../src/engine/verdict';
import type { Severity } from '../../src/engine/types';
import { f, I, T } from './helpers';

const sev = fc.constantFrom<Severity>('critical', 'high', 'caution');
const rank = (l: string) => LEVEL_ORDER.indexOf(l as never);

describe('aggregate properties (I-3)', () => {
  test('adding findings or notChecked never lowers the level', () => {
    fc.assert(
      fc.property(fc.array(sev), fc.array(sev), fc.array(fc.string()), fc.array(fc.string()), (a, b, na, nb) => {
        const base = aggregate(a.map((s) => f(s)), na, T, I).level;
        const more = aggregate([...a, ...b].map((s) => f(s)), [...na, ...nb], T, I).level;
        expect(rank(more)).toBeGreaterThanOrEqual(rank(base));
      }),
    );
  });
  test('order of findings does not matter', () => {
    fc.assert(
      fc.property(fc.array(sev), (a) => {
        expect(aggregate(a.map((s) => f(s)), [], T, I).level).toBe(aggregate([...a].reverse().map((s) => f(s)), [], T, I).level);
      }),
    );
  });
});
