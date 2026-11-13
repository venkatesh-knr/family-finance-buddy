/**
 * The ledger's refusals, in words (docs/design/ledger-income.md section 12). The provider's codes stay inside the repository layer: a
 * screen is given a sentence, never a constraint's name.
 */

export interface ProviderError {
  readonly code?: string;
  readonly message: string;
}

/** A row that is already there: the same due date confirmed twice, the same balance typed twice. A caller can tell it from a failure. */
export class AlreadyRecordedError extends Error {
  constructor() {
    super('That is already recorded: check whether it was entered once already.');
    this.name = 'AlreadyRecordedError';
  }
}

export function asLedgerError(error: ProviderError): Error {
  switch (error.code) {
    case '42501':
      return new Error('Your role here does not allow that, or that row is not yours to change.');
    case '23505':
      return new AlreadyRecordedError();
    case '23503':
      return new Error('That does not belong together: an account must be one of this household’s, and in the same currency.');
    case '23514':
      return new Error('That does not fit: check the amount, the date and the category.');
    case '23502':
      return new Error('Something that is needed is missing.');
    default:
      return new Error(error.message);
  }
}
