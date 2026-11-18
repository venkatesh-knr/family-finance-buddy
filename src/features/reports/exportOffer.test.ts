import { describe, expect, it } from 'vitest';
import { allowedScreen, moreFor, screensFor } from '../../domain/access.ts';
import { exportOffer } from './exportOffer.ts';

/** XR-I11 — a contributor is offered the report and not the template, and a role with nothing to read is offered nothing. */
describe('XR-I11 — what each role is offered', () => {
  it('offers an owner and a partner the report, the template and the complete backup', () => {
    for (const role of ['owner', 'partner'] as const) expect(exportOffer(role), role).toEqual({ report: true, template: true, backup: true });
  });

  it('offers a contributor the report and neither the template nor the backup', () => {
    expect(exportOffer('contributor')).toEqual({ report: true, template: false, backup: false });
  });

  it('offers a viewer, and a person with no role, nothing', () => {
    expect(exportOffer('viewer')).toEqual({ report: false, template: false, backup: false });
    expect(exportOffer(null)).toEqual({ report: false, template: false, backup: false });
  });

  it('never offers the template to a role the upload is not open to, and reaches no Reports screen for a contributor', () => {
    for (const role of ['contributor', 'viewer', null] as const) {
      expect(exportOffer(role).template, String(role)).toBe(false);
      expect([...screensFor(role), ...moreFor(role)]).not.toContain('reports');
      expect(allowedScreen(role, 'reports')).not.toBe('reports');
    }
  });
});
