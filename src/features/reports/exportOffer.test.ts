import { describe, expect, it } from 'vitest';
import { allowedScreen, moreFor, screensFor } from '../../domain/access.ts';
import { exportOffer } from './exportOffer.ts';

/** XR-I11 — a contributor is offered no file (decided by the owner, 18 November 2026), and neither is a role with nothing to read. */
describe('XR-I11 — what each role is offered', () => {
  it('offers an owner and a partner the report, the template and the complete backup', () => {
    for (const role of ['owner', 'partner'] as const) expect(exportOffer(role), role).toEqual({ report: true, template: true, backup: true });
  });

  it('offers a contributor, a viewer, and a person with no role, nothing', () => {
    for (const role of ['contributor', 'viewer', null] as const) expect(exportOffer(role), String(role)).toEqual({ report: false, template: false, backup: false });
  });

  it('reaches no Reports screen for a role that is offered nothing', () => {
    for (const role of ['contributor', 'viewer', null] as const) {
      expect([...screensFor(role), ...moreFor(role)]).not.toContain('reports');
      expect(allowedScreen(role, 'reports')).not.toBe('reports');
    }
  });
});
