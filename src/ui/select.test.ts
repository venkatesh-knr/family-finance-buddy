import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';
import { optionsOf } from './Select.tsx';

/**
 * A choice takes `<option>` children as a native select does (docs/design/simple-layout.md section 3), so everything a native select
 * would offer must be offered: an option in a fragment, in an array, in an `<optgroup>`, or made by a component. The first version walked
 * only some of these and silently dropped every currency inside the group, which left a fund priced in euros with no way to say so.
 */

const option = (value: string, label = value) => createElement('option', { key: value, value }, label);

describe('what a choice offers', () => {
  it('reads plain options, with the value and the label', () => {
    expect(optionsOf([option('a', 'Alpha'), option('b', 'Beta')]).map((o) => [o.value, o.label])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ]);
  });

  it('reads options in a fragment and in nested arrays', () => {
    const found = optionsOf(createElement(Fragment, null, [option('a'), [option('b'), option('c')]]));
    expect(found.map((o) => o.value)).toEqual(['a', 'b', 'c']);
  });

  it('reads the options inside an optgroup, and keeps the group’s label with each', () => {
    const found = optionsOf([
      option('INR'),
      option('USD'),
      createElement('optgroup', { key: 'rest', label: 'Everything else' }, [option('EUR'), option('GBP')]),
    ]);
    expect(found.map((o) => o.value)).toEqual(['INR', 'USD', 'EUR', 'GBP']);
    expect(found.map((o) => o.group)).toEqual([null, null, 'Everything else', 'Everything else']);
  });

  it('reads the options a component makes, which is how the currency list is written', () => {
    const Currencies = () => createElement(Fragment, null, option('INR'), createElement('optgroup', { label: 'Everything else' }, option('JPY')));
    expect(optionsOf(createElement(Currencies)).map((o) => o.value)).toEqual(['INR', 'JPY']);
  });

  it('offers a currency that is neither INR nor USD in the list the holdings forms use', async () => {
    const { CurrencyOptions } = await import('../features/holdings/holdingParts.tsx');
    const codes = optionsOf(createElement(CurrencyOptions)).map((o) => o.value);
    expect(codes.slice(0, 2)).toEqual(['INR', 'USD']);
    // Every other code the runtime knows is there too, so a fund priced in euros can be recorded in euros.
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes.length).toBeGreaterThan(20);
  }, 30_000);

  it('marks a disabled option as disabled', () => {
    expect(optionsOf(createElement('option', { value: 'x', disabled: true }, 'X'))[0]?.disabled).toBe(true);
  });
});
