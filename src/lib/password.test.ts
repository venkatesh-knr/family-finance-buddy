import { describe, expect, it } from 'vitest';
import { passwordProblem } from './password.ts';

describe('a new password, checked where it is typed', () => {
  const good = 'Correct-Horse-9-Battery';

  it('accepts one that meets the project rule and matches its confirmation', () => {
    expect(passwordProblem(good, good)).toBeNull();
  });

  it('says it is too short before it says anything else', () => {
    expect(passwordProblem('Short1!', 'Short1!')).toBe('Use at least 12 characters.');
  });

  it('asks for both cases, a digit and a symbol, one at a time', () => {
    expect(passwordProblem('alllowercase-123456', 'alllowercase-123456')).toBe('Use both lower case and upper case letters.');
    expect(passwordProblem('NoDigitsInHere-Here', 'NoDigitsInHere-Here')).toBe('Include a digit.');
    expect(passwordProblem('NoSymbolsInHere12345', 'NoSymbolsInHere12345')).toBe('Include a symbol, such as ! or #.');
  });

  it('counts only ASCII punctuation as a symbol, as the server does: a space or a rupee sign is not one', () => {
    expect(passwordProblem('Spaces In Here 12345', 'Spaces In Here 12345')).toBe('Include a symbol, such as ! or #.');
    expect(passwordProblem('Rupees₹InHere12345', 'Rupees₹InHere12345')).toBe('Include a symbol, such as ! or #.');
    expect(passwordProblem('Accentéd-Letters-12345', 'Accentéd-Letters-12345')).toBeNull();
  });

  it('says the two are not the same only once the first is good', () => {
    expect(passwordProblem(good, good + 'x')).toBe('The two passwords are not the same.');
    expect(passwordProblem('short', 'different')).toBe('Use at least 12 characters.');
  });
});
