/**
 * What a new password has to be, said before it is sent.
 *
 * The project's own rule is in `supabase/config.toml` (twelve characters or more, with lower and upper case
 * letters, digits and symbols), and the server is the one that enforces it. This is the same rule written down
 * where a person types, so they are told what is wrong in a sentence and not by a refusal from the other end. It
 * never sees a password it does not need to: nothing here stores, logs or returns one.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** The first thing wrong with a new password and its confirmation, or null when nothing is. */
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return 'Use both lower case and upper case letters.';
  }
  if (!/[0-9]/.test(password)) return 'Include a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include a symbol, such as ! or #.';
  if (password !== confirmation) return 'The two passwords are not the same.';
  return null;
}
