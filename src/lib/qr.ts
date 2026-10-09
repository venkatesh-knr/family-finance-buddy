/**
 * The markup of the authenticator's QR code, from what the auth server sends.
 *
 * Supabase's `totp.qr_code` is a data URI (`data:image/svg+xml;utf-8,` and then the
 * SVG), not SVG. Injected as markup, the browser printed the prefix as text above
 * whatever followed it. This turns it into what its consumer's name claims.
 *
 * Not an `<img src={dataUri}>`: the Content-Security-Policy applies to the built
 * bundle only, so a `data:` image would draw in development and be blocked by
 * `img-src` on Pages, a QR that breaks in production and nowhere anyone would look.
 * Markup needs no image request, so it needs no such rule.
 *
 * Because it is injected as markup, it is checked first. It comes from our own auth
 * server over TLS, but a string that becomes the page should be one that cannot run
 * anything: anything that is not a plain SVG, or has a script, an event handler, a
 * `javascript:` URL or a `foreignObject` in it, is refused, and the screen falls back
 * to typing the secret, which is always on offer.
 *
 * Null means "do not draw a code", never an empty box.
 */

const PREFIX = /^data:image\/svg\+xml(?:;(?!base64,)[a-z0-9=-]+)*(;base64)?,/i;

function decoded(rest: string, base64: boolean): string | null {
  if (base64) {
    try {
      return atob(rest);
    } catch {
      return null;
    }
  }
  // Raw markup starts with a tag. Anything else is percent-encoded; a `%` that is
  // not part of an escape means it was raw after all, and is left alone.
  if (rest.trimStart().startsWith('<')) return rest;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

const UNSAFE = /<script|<foreignobject|\son[a-z]+\s*=|javascript:/i;

export function svgMarkupFromQr(qr: string): string | null {
  const trimmed = qr.trim();
  let markup: string | null;

  const prefix = PREFIX.exec(trimmed);
  if (prefix !== null) {
    markup = decoded(trimmed.slice(prefix[0].length), prefix[1] !== undefined);
  } else if (trimmed.startsWith('data:')) {
    return null;
  } else {
    markup = trimmed;
  }

  if (markup === null) return null;
  const svg = markup.trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  return UNSAFE.test(svg) ? null : svg;
}
