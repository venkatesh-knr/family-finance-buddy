/**
 * The identity of a statement line.
 *
 * Tested against the published SHA-256 vectors rather than against itself: a
 * hash that is merely self-consistent would pass every test while being the
 * wrong function, and this value is written into a column whose whole job is
 * to still match when the same file is imported in two years' time.
 */

import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash.ts';

describe('hashing a statement line', () => {
  it('matches the published vector for the empty string', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published vector for "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces the shape the column accepts', async () => {
    const hash = await sha256Hex('cams|10422158 / 45|INF179K01BC2|2024-04-05|Purchase-SIP|in500000|4512300000|#0');

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates two lines that differ only in their position', async () => {
    const first = await sha256Hex('cams|1|INF1|2024-06-05|Purchase-SIP|in500000|4350000000|#0');
    const second = await sha256Hex('cams|1|INF1|2024-06-05|Purchase-SIP|in500000|4350000000|#1');

    expect(first).not.toBe(second);
  });

  it('gives the same line the same hash every time', async () => {
    const line = 'cams|1|INF1|2024-06-05|Purchase-SIP|in500000|4350000000|#0';

    await expect(sha256Hex(line)).resolves.toBe(await sha256Hex(line));
  });
});
