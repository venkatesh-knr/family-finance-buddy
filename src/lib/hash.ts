/**
 * The identity of a statement line, as something a column can hold.
 *
 * `lot.source_hash` is "sha256 of the statement line this row came from,
 * computed on the device", and this is where that happens. It is not in
 * `src/domain` with the parser, because the parser is pure and this is not:
 * Web Crypto is asynchronous and belongs to the platform, not to the
 * arithmetic.
 *
 * Why a hash rather than the text. The identity of an eCAS line includes the
 * folio number, and a folio is an account identifier — "account identifiers
 * keep last four digits only". A hash keeps the one property the column needs,
 * that the same line is recognised on a re-import, and throws away the ability
 * to read back what it was made of.
 */

/**
 * sha256 of a string, lower-case hex.
 *
 * Matches the shape `lot.source_hash` and `disposal.source_hash` check for:
 * sixty-four characters of `[0-9a-f]`.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
