/**
 * A fund's registered name, split for a screen that is 360px wide.
 *
 * "Parag Parikh Flexi Cap Fund - Direct Plan Growth (formerly Parag Parikh Long Term
 * Value Fund)" is what the register calls it, and what a statement matches on, so
 * the stored name is left alone. What is read first is the fund. The plan and the
 * old name are real and are kept, on a second line in the quieter type, so nothing
 * is shortened to fit: every word is still on the screen.
 *
 * Pure, and it only ever splits: the parts joined back are the words that went in.
 */

export interface FundName {
  readonly title: string;
  /** The plan and the former name, or null when the name has neither. */
  readonly detail: string | null;
}

export function splitFundName(name: string): FundName {
  const whole = name.trim();
  if (whole === '') return { title: '', detail: null };

  let rest = whole;
  const parts: string[] = [];

  // A closing parenthetical: "(formerly …)", "(Growth)".
  const bracket = /\s*\(([^()]*)\)\s*$/.exec(rest);
  let bracketed: string | null = null;
  if (bracket !== null && bracket.index > 0) {
    bracketed = bracket[1]?.trim() ?? null;
    rest = rest.slice(0, bracket.index).trim();
  }

  // " - " with spaces either side separates the fund from its plan. A hyphen
  // inside a word (Small-Cap) has none, and is not a separator.
  const [first, ...plan] = rest.split(/\s+-\s+/);
  const title = (first ?? '').trim();
  if (title === '') return { title: whole, detail: null };

  for (const piece of plan) {
    if (piece.trim() !== '') parts.push(piece.trim());
  }
  if (bracketed !== null && bracketed !== '') parts.push(bracketed);

  return { title, detail: parts.length === 0 ? null : parts.join(' · ') };
}
