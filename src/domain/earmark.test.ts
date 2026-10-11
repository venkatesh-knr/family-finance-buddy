import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import {
  EARMARKS,
  EARMARK_LABELS,
  EXCLUDED_FROM_FIRE,
  LOCKED_SCHEMES,
  SCHEMES,
  SCHEME_LABELS,
  fireCorpus,
  coverMonths,
  earmarkedHoldings,
  isScheme,
  monthsOfCover,
  priorMonths,
  schemeAllowedFor,
  type CorpusHolding,
} from './earmark.ts';
import type { ValuationInput } from './networth.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const holding = (over: Partial<CorpusHolding> & { id: string }): CorpusHolding => ({
  currency: 'INR',
  earmark: 'none',
  scheme: null,
  isArchived: false,
  ...over,
});

const reading = (holdingId: string, amount: ReturnType<typeof inr>): ValuationInput => ({
  holdingId,
  date: '2026-09-30',
  amount,
});

describe('PF-C7 — the FIRE corpus leaves out emergency, child and house, and keeps retirement and none', () => {
  it('names exactly the three earmarks the design excludes', () => {
    expect([...EXCLUDED_FROM_FIRE].sort()).toEqual(['child', 'emergency', 'house']);
  });

  it('puts each earmark on the side the design says', () => {
    // The ₹100 holding for each earmark, one at a time, so a wrong side is named by its earmark
    // and not buried in a sum.
    const expectation: Record<(typeof EARMARKS)[number], 'in' | 'out'> = {
      emergency: 'out',
      child: 'out',
      house: 'out',
      retirement: 'in',
      none: 'in',
    };
    for (const earmark of EARMARKS) {
      const [total] = fireCorpus({
        holdings: [holding({ id: 'h', earmark })],
        valuations: [reading('h', inr(100))],
      });
      expect(total?.included.minor, earmark).toBe(expectation[earmark] === 'in' ? 10000n : 0n);
      expect(total?.excludedTotal.minor, earmark).toBe(expectation[earmark] === 'out' ? 10000n : 0n);
    }
  });

  it('sums what it leaves out by earmark, so the screen can say what it is leaving out', () => {
    const [total] = fireCorpus({
      holdings: [
        holding({ id: 'a', earmark: 'emergency' }),
        holding({ id: 'b', earmark: 'emergency' }),
        holding({ id: 'c', earmark: 'child' }),
        holding({ id: 'd', earmark: 'house' }),
        holding({ id: 'e', earmark: 'retirement' }),
        holding({ id: 'f' }),
      ],
      valuations: [
        reading('a', inr(300000)),
        reading('b', inr(200000)),
        reading('c', inr(400000)),
        reading('d', inr(1000000)),
        reading('e', inr(5000000)),
        reading('f', inr(250000)),
      ],
    });
    expect(total?.excluded.emergency.minor).toBe(50000000n);
    expect(total?.excluded.child.minor).toBe(40000000n);
    expect(total?.excluded.house.minor).toBe(100000000n);
    expect(total?.excludedTotal.minor).toBe(190000000n);
    expect(total?.included.minor).toBe(525000000n);
  });

  it('keeps the two sides summing to everything valued, so nothing is dropped', () => {
    const holdings = [
      holding({ id: 'a', earmark: 'emergency' }),
      holding({ id: 'b', earmark: 'retirement' }),
      holding({ id: 'c' }),
    ];
    const [total] = fireCorpus({
      holdings,
      valuations: [reading('a', inr(1)), reading('b', inr(2)), reading('c', inr(4))],
    });
    expect((total?.included.minor ?? 0n) + (total?.excludedTotal.minor ?? 0n)).toBe(700n);
  });

  it('keeps currencies apart, as the asset totals do', () => {
    const totals = fireCorpus({
      holdings: [
        holding({ id: 'a', earmark: 'house' }),
        holding({ id: 'b', currency: 'USD' }),
        holding({ id: 'c', currency: 'USD', earmark: 'emergency' }),
      ],
      valuations: [reading('a', inr(100)), reading('b', usd(50)), reading('c', usd(20))],
    });
    const byCurrency = new Map(totals.map((t) => [t.currency, t]));
    expect(byCurrency.get('INR')?.included.minor).toBe(0n);
    expect(byCurrency.get('INR')?.excludedTotal.minor).toBe(10000n);
    expect(byCurrency.get('USD')?.included.minor).toBe(5000n);
    expect(byCurrency.get('USD')?.excludedTotal.minor).toBe(2000n);
  });

  it('leaves an archived holding out of both sides, and counts a holding never read as neither', () => {
    const [total] = fireCorpus({
      holdings: [
        holding({ id: 'gone', earmark: 'emergency', isArchived: true }),
        holding({ id: 'unread', earmark: 'emergency' }),
        holding({ id: 'ok', earmark: 'retirement' }),
      ],
      valuations: [reading('gone', inr(999)), reading('ok', inr(10))],
    });
    expect(total?.excludedTotal.minor).toBe(0n);
    expect(total?.included.minor).toBe(1000n);
    expect(total?.unvalued).toBe(1);
  });

  it('uses the latest reading, not the sum of all of them', () => {
    const [total] = fireCorpus({
      holdings: [holding({ id: 'a', earmark: 'child' })],
      valuations: [
        { holdingId: 'a', date: '2026-01-31', amount: inr(100) },
        { holdingId: 'a', date: '2026-08-31', amount: inr(130) },
      ],
    });
    expect(total?.excluded.child.minor).toBe(13000n);
  });

  it('returns nothing for no holdings', () => {
    expect(fireCorpus({ holdings: [], valuations: [] })).toEqual([]);
  });
});

describe('the liquid corpus — the other named output of the one classification', () => {
  const liquidOf = (holdings: CorpusHolding[], values: number[]) =>
    fireCorpus({
      holdings,
      valuations: holdings.map((h, i) => reading(h.id, inr(values[i] ?? 0))),
    })[0]?.liquid.minor;

  it('names the schemes that lock money in', () => {
    expect([...LOCKED_SCHEMES].sort()).toEqual(['kvp', 'nsc', 'po_td', 'pomis', 'ppf', 'scss', 'ssy']);
  });

  it('counts ordinary holdings and the emergency fund, which is the most liquid money there is', () => {
    expect(
      liquidOf([holding({ id: 'a' }), holding({ id: 'b', earmark: 'emergency' })], [100, 50]),
    ).toBe(15000n);
  });

  it("leaves out money that is committed or is somebody else's: a child's savings and a house deposit", () => {
    expect(
      liquidOf([holding({ id: 'a', earmark: 'child' }), holding({ id: 'b', earmark: 'house' })], [100, 50]),
    ).toBe(0n);
  });

  it('leaves out a locked scheme even when it counts toward FIRE: a PPF is in the corpus and not liquid', () => {
    const [total] = fireCorpus({
      holdings: [holding({ id: 'ppf', scheme: 'ppf' }), holding({ id: 'fd', scheme: 'fd' })],
      valuations: [reading('ppf', inr(100)), reading('fd', inr(40))],
    });
    expect(total?.included.minor).toBe(14000n);
    expect(total?.liquid.minor).toBe(4000n);
  });

  it('is a subset of nothing: an SSY earmarked for a child is out of both', () => {
    const [total] = fireCorpus({
      holdings: [holding({ id: 'ssy', scheme: 'ssy', earmark: 'child' })],
      valuations: [reading('ssy', inr(100))],
    });
    expect(total?.included.minor).toBe(0n);
    expect(total?.liquid.minor).toBe(0n);
  });
});

describe('PF-C9 — months of cover is null, never 0 and never infinite, when it cannot be stated', () => {
  const months = (n: number, rupees: number) =>
    Array.from({ length: n }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, spent: inr(rupees) }));

  it('divides the emergency total by the average monthly expense', () => {
    const cover = monthsOfCover({ emergency: inr(600000), monthlyExpenses: months(6, 50000) });
    expect(cover).toBe(12);
  });

  it('is null with fewer than three complete months', () => {
    expect(monthsOfCover({ emergency: inr(600000), monthlyExpenses: months(2, 50000) })).toBeNull();
    expect(monthsOfCover({ emergency: inr(600000), monthlyExpenses: [] })).toBeNull();
  });

  it('is stated at exactly three months', () => {
    expect(monthsOfCover({ emergency: inr(300000), monthlyExpenses: months(3, 50000) })).toBe(6);
  });

  it('is null, not infinite, when the average is zero', () => {
    expect(monthsOfCover({ emergency: inr(600000), monthlyExpenses: months(4, 0) })).toBeNull();
  });

  it('is zero only when there is an expense history and nothing set aside', () => {
    expect(monthsOfCover({ emergency: inr(0), monthlyExpenses: months(4, 50000) })).toBe(0);
  });

  it('uses the trailing twelve months when there are more', () => {
    // Twelve months at 10,000 after six at 1,000,000: only the last twelve count.
    const old = Array.from({ length: 6 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, spent: inr(1000000) }));
    const recent = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, spent: inr(10000) }));
    expect(monthsOfCover({ emergency: inr(120000), monthlyExpenses: [...old, ...recent] })).toBe(12);
  });

  it('refuses a mixed currency rather than guessing', () => {
    expect(
      monthsOfCover({ emergency: usd(1000), monthlyExpenses: months(4, 50000) }),
    ).toBeNull();
  });
});

describe('PF-C5 — a scheme is meaningful only on a deposit', () => {
  it('allows a scheme on a deposit and on nothing else', () => {
    expect(schemeAllowedFor('deposit')).toBe(true);
    for (const kind of ['equity', 'etf', 'mutual_fund', 'bond', 'other']) {
      expect(schemeAllowedFor(kind), kind).toBe(false);
    }
  });

  it('knows its own values', () => {
    for (const scheme of SCHEMES) expect(isScheme(scheme)).toBe(true);
    expect(isScheme('epf')).toBe(false);
    expect(isScheme('')).toBe(false);
  });
});

describe('PF-C6 — every scheme and every earmark resolves to a label', () => {
  it('labels each earmark, by iterating the list', () => {
    for (const earmark of EARMARKS) {
      expect(EARMARK_LABELS[earmark], earmark).toBeTruthy();
      expect(EARMARK_LABELS[earmark], earmark).not.toBe(earmark === 'none' ? '' : earmark);
    }
  });

  it('labels each scheme, by iterating the list', () => {
    for (const scheme of SCHEMES) {
      expect(SCHEME_LABELS[scheme], scheme).toBeTruthy();
    }
  });

  it('has a label for nothing else', () => {
    expect(Object.keys(EARMARK_LABELS).sort()).toEqual([...EARMARKS].sort());
    expect(Object.keys(SCHEME_LABELS).sort()).toEqual([...SCHEMES].sort());
  });
});

describe('PF-C9 — the window is whole months with spending in them, at most twelve', () => {
  // today = 2026-10-11. The thirteen before it run 2025-09 (the probe) to 2026-09.
  const today = '2026-10-11';

  it('leaves out the month in progress and the month spending began in', () => {
    expect(coverMonths({ today, spendMonths: ['2026-06', '2026-07', '2026-08', '2026-09'] })).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('is empty when nothing has been spent, and when the first spend is last month', () => {
    expect(coverMonths({ today, spendMonths: [] })).toEqual([]);
    expect(coverMonths({ today, spendMonths: ['2026-09'] })).toEqual([]);
    // A first month that has only just ended is one day of data, not a month of it.
    expect(coverMonths({ today: '2026-10-01', spendMonths: ['2026-09'] })).toEqual([]);
  });

  it('does not count a month with nothing recorded as a month of spending nothing', () => {
    // June, July and August are empty: three months of spending, not seven.
    expect(coverMonths({ today, spendMonths: ['2026-03', '2026-04', '2026-05', '2026-09'] })).toEqual([
      '2026-04',
      '2026-05',
      '2026-09',
    ]);
  });

  it('keeps the oldest month in the window when recording began before it', () => {
    const window = coverMonths({ today, spendMonths: ['2025-09', '2025-10', '2025-11', '2026-09'] });
    expect(window).toEqual(['2025-10', '2025-11', '2026-09']);
    // The probe is not part of the window, but it settles that 2025-10 is a whole month.
    expect(window).not.toContain('2025-09');
  });

  it('is at most twelve months, and crosses a year end', () => {
    const everyMonth = priorMonths('2026-02-03', 13);
    const window = coverMonths({ today: '2026-02-03', spendMonths: everyMonth });
    expect(window).toHaveLength(12);
    expect(window[0]).toBe('2025-02');
    expect(window[11]).toBe('2026-01');
  });
});

describe('earmarkedHoldings — which holdings are earmarked, apart from how much', () => {
  it('counts each excluded earmark and how many have never been read', () => {
    const result = earmarkedHoldings({
      holdings: [
        holding({ id: 'a', earmark: 'emergency' }),
        holding({ id: 'b', earmark: 'emergency' }),
        holding({ id: 'c', earmark: 'house' }),
        holding({ id: 'd', earmark: 'retirement' }),
        holding({ id: 'e' }),
        holding({ id: 'f', earmark: 'child', isArchived: true }),
      ],
      valuations: [reading('a', inr(1)), reading('d', inr(1))],
    });
    expect(result.count).toEqual({ emergency: 2, child: 0, house: 1 });
    expect(result.unvalued).toBe(2);
    expect(result.unvaluedBy).toEqual({ emergency: 1, child: 0, house: 1 });
  });

  it('is all zero for a household that has earmarked nothing', () => {
    const result = earmarkedHoldings({ holdings: [holding({ id: 'a' })], valuations: [] });
    expect(result.count).toEqual({ emergency: 0, child: 0, house: 0 });
    expect(result.unvalued).toBe(0);
  });
});
