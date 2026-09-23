/**
 * What an asset class is called on screen.
 *
 * The database stores `mutual_fund`; a person reads "Mutual funds". Two
 * screens now name the same classes — Overview totals them, Holdings filters
 * by them — and two copies of this map would drift into calling the same
 * thing two things, which on a screen that says "showing Bonds" above a list
 * headed "bond" is exactly the sort of small wrongness that makes an app feel
 * unfinished.
 *
 * Labels only. What the classes are, and which exist, belongs to
 * `INSTRUMENT_KINDS` in the repository layer.
 */
export const INSTRUMENT_KIND_LABEL: Record<string, string> = {
  equity: 'Equity',
  etf: 'ETF',
  mutual_fund: 'Mutual funds',
  bond: 'Bonds',
  deposit: 'Deposits',
  other: 'Other',
};

/** The label for one kind, falling back to the stored value rather than to nothing. */
export function kindLabel(kind: string): string {
  return INSTRUMENT_KIND_LABEL[kind] ?? kind.replace('_', ' ');
}

/**
 * What a tax asset class is called, in the words the editor's own dropdown uses.
 *
 * A person sets the class in "Correct this holding" and reads it back on the
 * Tax screen; the two saying different things for one class is how somebody
 * decides the second is a different setting.
 */
export const TAX_ASSET_CLASS_LABEL: Record<string, string> = {
  listed_equity: 'Listed equity',
  equity_fund: 'Equity mutual fund',
  debt_fund: 'Debt fund',
  gold: 'Gold',
  foreign_equity: 'Foreign shares or ETF',
  unlisted_equity: 'Unlisted shares',
  property: 'Property',
};

export function taxClassLabel(assetClass: string): string {
  return TAX_ASSET_CLASS_LABEL[assetClass] ?? assetClass.replace('_', ' ');
}
