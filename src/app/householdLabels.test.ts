import { describe, expect, it } from 'vitest';
import { householdLabels, type LabelledMembership } from './householdLabels.ts';

const m = (id: string, name: string, role: string, createdOn: string | null = null): LabelledMembership => ({
  household: { id, name, createdOn },
  role,
});

describe('householdLabels', () => {
  it('leaves a name that is not repeated exactly as it is', () => {
    const labels = householdLabels([m('a1', 'Demo household', 'owner'), m('b2', 'Parents', 'owner')]);
    expect(labels.get('a1')).toBe('Demo household');
    expect(labels.get('b2')).toBe('Parents');
  });

  it('tells two apart by the role the person has in each, when that is enough', () => {
    const labels = householdLabels([m('a1', 'Demo household', 'owner'), m('b2', 'Demo household', 'viewer')]);
    expect(labels.get('a1')).toBe('Demo household · owner');
    expect(labels.get('b2')).toBe('Demo household · viewer');
  });

  it('falls back to the date each was created, when the roles are the same', () => {
    const labels = householdLabels([
      m('a1', 'Demo household', 'owner', '2026-09-07'),
      m('b2', 'Demo household', 'owner', '2026-09-11'),
      m('c3', 'Demo household', 'owner', '2026-10-01'),
    ]);
    expect(labels.get('a1')).toBe('Demo household · created 7 Sept 2026');
    expect(labels.get('b2')).toBe('Demo household · created 11 Sept 2026');
    expect(labels.get('c3')).toBe('Demo household · created 1 Oct 2026');
  });

  it('falls back to a short id when even the dates are the same, so no two ever read alike', () => {
    const labels = householdLabels([
      m('3f9c1a22-0000', 'Demo household', 'owner', '2026-09-07'),
      m('b17e40d9-0000', 'Demo household', 'owner', '2026-09-07'),
      m('c3000000-0000', 'Demo household', 'owner', '2026-09-07'),
    ]);
    expect(labels.get('3f9c1a22-0000')).toBe('Demo household · 3f9c');
    expect(labels.get('b17e40d9-0000')).toBe('Demo household · b17e');
    expect(new Set(labels.values()).size).toBe(3);
  });

  it('lengthens the short id when two of them collide', () => {
    const labels = householdLabels([
      m('3f9c1a22-0000', 'Demo household', 'owner'),
      m('3f9c9b00-0000', 'Demo household', 'owner'),
    ]);
    expect(labels.get('3f9c1a22-0000')).toBe('Demo household · 3f9c1a');
    expect(labels.get('3f9c9b00-0000')).toBe('Demo household · 3f9c9b');
  });

  it('compares names without regard to case or surrounding space', () => {
    const labels = householdLabels([m('a1', 'Demo household', 'owner'), m('b2', ' demo household ', 'viewer')]);
    expect(labels.get('a1')).toBe('Demo household · owner');
    expect(labels.get('b2')).toBe('demo household · viewer');
  });

  it('only suffixes the names that are repeated', () => {
    const labels = householdLabels([
      m('a1', 'Demo household', 'owner', '2026-09-07'),
      m('b2', 'Demo household', 'owner', '2026-09-11'),
      m('c3', 'Parents', 'owner'),
    ]);
    expect(labels.get('c3')).toBe('Parents');
    expect(labels.get('a1')).toContain('created');
  });
});
