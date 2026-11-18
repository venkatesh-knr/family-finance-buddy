import type { HouseholdRole } from '../../repo/types.ts';

/**
 * Which of the three files a role is offered (docs/design/export-redesign.md sections 1, 2 and 4; XR-I11).
 *
 * The database decides what a file may hold: every file is made from what the signed-in person can already read, so a contributor's report holds their own
 * entries and the household's figures the policies show them, and nothing of anybody else's private. This only decides what is *offered*, so nobody is shown a
 * button for a file that would be wrong for them:
 * A contributor is offered none of the three (decided by the owner, 18 November 2026): they have no Reports screen, and their figures are on the Summary and in Money.
 * - the **report** is for an owner and a partner, who read the household's figures;
 * - the **template** is for those who add to the household's records in bulk, which the upload that takes it back is limited to: an owner and a partner;
 * - the **complete backup** is the file kept for a restore, and a restore is of the whole household, so it is offered only to those who can read all of it.
 */
export interface ExportOffer {
  readonly report: boolean;
  readonly template: boolean;
  readonly backup: boolean;
}

export function exportOffer(role: HouseholdRole | null): ExportOffer {
  switch (role) {
    case 'owner':
    case 'partner':
      return { report: true, template: true, backup: true };
    case 'contributor':
    case 'viewer':
    case null:
      return { report: false, template: false, backup: false };
  }
}
