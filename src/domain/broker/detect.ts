import type { ReadSheet } from '../export/workbook.ts';
import { tablesIn } from './common.ts';

/** Which broker's workbook this is, from its sheets and their headers; null for any other workbook. */
export type BrokerFile = 'zerodha_holdings' | 'zerodha_exits' | 'indmoney_holdings' | 'indmoney_trades';

const named = (sheets: readonly ReadSheet[], name: string): ReadSheet | undefined => sheets.find((sheet) => sheet.name.trim().toLowerCase() === name);

export function detectBroker(sheets: readonly ReadSheet[]): BrokerFile | null {
  if (sheets.some((sheet) => /^tradewise exits/i.test(sheet.name.trim()))) return 'zerodha_exits';
  for (const name of ['equity', 'mutual funds']) {
    const sheet = named(sheets, name);
    if (sheet !== undefined && tablesIn(sheet.rows, ['symbol', 'isin', 'average price']).length > 0) return 'zerodha_holdings';
  }
  const holdings = named(sheets, 'holdings report');
  if (holdings !== undefined && tablesIn(holdings.rows, ['symbol', 'quantity', '$ cost price']).length > 0) return 'indmoney_holdings';
  const trades = named(sheets, 'trades report');
  if (trades !== undefined && tablesIn(trades.rows, ['trade date', 'ticker', 'side']).length > 0) return 'indmoney_trades';
  return null;
}
