import { describe, expect, test } from 'vitest';
import { aggregate, LEVEL_ORDER, maxLevel } from '../../src/engine/verdict';
import { f, I, T } from './helpers';

describe('aggregate', () => {
  test('level is max severity', () => expect(aggregate([f('caution'), f('critical')], [], T, I).level).toBe('critical'));
  test('empty → no_known_issues', () => expect(aggregate([], [], T, I).level).toBe('no_known_issues'));
  test('notChecked floors at unknown', () => expect(aggregate([], ['x'], T, I).level).toBe('unknown'));
  test('notChecked does not lower critical', () => expect(aggregate([f('critical')], ['x'], T, I).level).toBe('critical'));
  test('caution beats unknown floor', () => expect(aggregate([f('caution')], ['x'], T, I).level).toBe('caution'));
  test('actions come from the fixed per-level map', () => {
    expect(aggregate([f('critical')], [], T, I).actions).toEqual(['Do not open this folder in VS Code']);
    expect(aggregate([f('high')], [], T, I).actions).toEqual(['Open with auto-run disabled']);
    expect(aggregate([f('caution')], [], T, I).actions).toEqual(['Review before running']);
    expect(aggregate([], ['x'], T, I).actions).toEqual(['Could not check fully']);
    expect(aggregate([], [], T, I).actions).toEqual([]);
  });
  test('passes target, indicators, findings and notChecked through', () => {
    const ind = { addresses: ['0x' + '1'.repeat(40)], domains: ['bad.example'] };
    const v = aggregate([f('high')], ['n'], T, ind);
    expect(v.target).toEqual(T);
    expect(v.indicators).toEqual(ind);
    expect(v.findings).toHaveLength(1);
    expect(v.notChecked).toEqual(['n']);
    expect(v.explanation).toBeUndefined();
  });
});

describe('maxLevel', () => {
  test('order is critical > high > caution > unknown > no_known_issues', () => {
    expect(LEVEL_ORDER).toEqual(['no_known_issues', 'unknown', 'caution', 'high', 'critical']);
    expect(maxLevel('unknown', 'caution')).toBe('caution');
    expect(maxLevel('critical', 'high')).toBe('critical');
    expect(maxLevel('no_known_issues', 'unknown')).toBe('unknown');
  });
});
