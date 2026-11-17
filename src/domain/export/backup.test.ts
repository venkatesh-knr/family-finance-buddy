import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportFixture } from './fixture.ts';
import { buildBackup } from './workbook.ts';

/**
 * XR-I12 — the complete backup is today's export, unchanged (docs/design/export-redesign.md section 1): every entity, every column, ids and refs, template
 * version 2. Its sheets for the fixture household are held to the file stored beside this test, which was written from the writer before it was renamed
 * `buildBackup`, so a change to what the backup holds shows here and is a decision, not a side effect.
 */

const STORED = readFileSync('src/domain/export/fixtures/backup-v2.json', 'utf8').replace(/\r\n/g, '\n');

describe('XR-I12 — the complete backup', () => {
  it('is byte for byte the stored output for the fixture household', () => {
    const { workbook, problems } = buildBackup(exportFixture(), { exportedAt: '2026-10-30T06:30:00.000Z', householdName: 'The Rao household', baseCurrency: 'INR', demo: false });
    const text = `${JSON.stringify({ problems, sheets: workbook.sheets }, (_key, value) => (value instanceof Date ? `date:${value.toISOString()}` : value), 2)}\n`;
    expect(text).toBe(STORED);
  });

  it('is template version 2, the version upload accepts as a backup', () => {
    expect(JSON.parse(STORED).sheets[0].rows[0]).toEqual(['Template version', 2]);
  });
});
