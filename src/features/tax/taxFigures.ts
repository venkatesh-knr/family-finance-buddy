import { capitalGainsTax, netCapitalGains } from '../../domain/capital-gains.ts';
import { taxLotsFor } from './taxLots.ts';

/**
 * One person's capital gains for a tax year, netted, and the tax on them.
 *
 * The three steps the Tax screen has always taken, in one place so that More can say what the year comes to
 * without a second copy of them to drift: the lots the person's sales were made from, the gains netted across
 * asset classes under the set-off rules, and the tax on what is left after the allowance.
 */
export function taxFigures(options: Parameters<typeof taxLotsFor>[0]) {
  const lots = taxLotsFor(options);
  const gains = netCapitalGains({
    parcels: lots.parcels,
    assetClassOf: lots.assetClassOf,
    disposalKindOf: options.disposalKindOf,
    rules: options.rules,
    fy: options.fy,
  });
  const tax = capitalGainsTax(gains, options.rules);
  return { lots, gains, tax };
}
