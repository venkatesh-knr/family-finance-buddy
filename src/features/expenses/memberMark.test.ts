import { describe, expect, it } from 'vitest';
import { memberMarks } from './memberMark.ts';

const m = (id: string, displayName: string) => ({ id, displayName });

describe('memberMarks', () => {
  it('is the initial when it is enough', () => {
    const marks = memberMarks([m('a', 'Venkatesh'), m('b', 'Meera')]);
    expect(marks.get('a')).toEqual({ text: 'V', showName: false });
    expect(marks.get('b')).toEqual({ text: 'M', showName: false });
  });

  it('is two letters where two members share an initial, and no name', () => {
    const marks = memberMarks([m('a', 'Venkatesh'), m('b', 'Vijay'), m('c', 'Meera')]);
    expect(marks.get('a')).toEqual({ text: 'Ve', showName: false });
    expect(marks.get('b')).toEqual({ text: 'Vi', showName: false });
    // The one with a unique initial keeps it: only those that collide grow.
    expect(marks.get('c')).toEqual({ text: 'M', showName: false });
  });

  it('shows the name where two letters still do not separate them', () => {
    const marks = memberMarks([m('a', 'Vinay'), m('b', 'Vinita'), m('c', 'Meera')]);
    expect(marks.get('a')).toEqual({ text: 'V', showName: true });
    expect(marks.get('b')).toEqual({ text: 'V', showName: true });
    expect(marks.get('c')).toEqual({ text: 'M', showName: false });
  });

  it('ignores case and surrounding space', () => {
    const marks = memberMarks([m('a', ' venkatesh'), m('b', 'Vijay')]);
    expect(marks.get('a')).toEqual({ text: 'Ve', showName: false });
    expect(marks.get('b')).toEqual({ text: 'Vi', showName: false });
  });

  it('shows the name for two members called the same', () => {
    const marks = memberMarks([m('a', 'Asha'), m('b', 'Asha')]);
    expect(marks.get('a')).toEqual({ text: 'A', showName: true });
    expect(marks.get('b')).toEqual({ text: 'A', showName: true });
  });

  it('copes with a name that is empty', () => {
    expect(memberMarks([m('a', '')]).get('a')).toEqual({ text: '?', showName: false });
  });
});
