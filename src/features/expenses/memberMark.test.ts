import { describe, expect, it } from 'vitest';
import { memberMarks } from './memberMark.ts';

const m = (id: string, displayName: string) => ({ id, displayName });
const text = (marks: ReturnType<typeof memberMarks>, id: string) => marks.get(id);

describe('memberMarks', () => {
  it('is the initial of a one-word name', () => {
    const marks = memberMarks([m('a', 'Venkatesh'), m('b', 'Meera')]);
    expect(text(marks, 'a')).toEqual({ text: 'V', showName: false });
    expect(text(marks, 'b')).toEqual({ text: 'M', showName: false });
  });

  it('is the first and last initial of a longer name, as a chat app shows it', () => {
    const marks = memberMarks([m('a', 'Venkatesh Nair'), m('b', 'Meera Rao'), m('c', 'Anna Maria Lopez')]);
    expect(text(marks, 'a')).toEqual({ text: 'VN', showName: false });
    expect(text(marks, 'b')).toEqual({ text: 'MR', showName: false });
    expect(text(marks, 'c')).toEqual({ text: 'AL', showName: false });
  });

  it('ignores a note in brackets, which is not part of the name', () => {
    const marks = memberMarks([m('a', 'Priya (left Mar 2026)'), m('b', 'Meera')]);
    expect(text(marks, 'a')).toEqual({ text: 'P', showName: false });
  });

  it('gives two letters where two members share an initial, and no name', () => {
    const marks = memberMarks([m('a', 'Venkatesh'), m('b', 'Vijay'), m('c', 'Meera')]);
    expect(text(marks, 'a')).toEqual({ text: 'Ve', showName: false });
    expect(text(marks, 'b')).toEqual({ text: 'Vi', showName: false });
    expect(text(marks, 'c')).toEqual({ text: 'M', showName: false });
  });

  it('does the same for two who share both initials', () => {
    const marks = memberMarks([m('a', 'Venkatesh Nair'), m('b', 'Vijay Nair'), m('c', 'Meera Rao')]);
    expect(text(marks, 'a')).toEqual({ text: 'Ve', showName: false });
    expect(text(marks, 'b')).toEqual({ text: 'Vi', showName: false });
    expect(text(marks, 'c')).toEqual({ text: 'MR', showName: false });
  });

  it('shows the name where two letters still do not separate them', () => {
    const marks = memberMarks([m('a', 'Vinay Kumar'), m('b', 'Vinita Kumar'), m('c', 'Meera')]);
    expect(text(marks, 'a')).toEqual({ text: 'VK', showName: true });
    expect(text(marks, 'b')).toEqual({ text: 'VK', showName: true });
    expect(text(marks, 'c')).toEqual({ text: 'M', showName: false });
  });

  it('shows the name for two members called the same', () => {
    const marks = memberMarks([m('a', 'Asha'), m('b', 'Asha')]);
    expect(text(marks, 'a')).toEqual({ text: 'A', showName: true });
  });

  it('ignores case and surrounding space', () => {
    const marks = memberMarks([m('a', '  venkatesh  nair '), m('b', 'Meera')]);
    expect(text(marks, 'a')).toEqual({ text: 'VN', showName: false });
  });

  it('copes with a name that is empty', () => {
    expect(memberMarks([m('a', '')]).get('a')).toEqual({ text: '?', showName: false });
  });
});
