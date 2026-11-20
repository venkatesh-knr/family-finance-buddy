import type { ReactNode } from 'react';

/**
 * The mint tray a chart or a legend in the class colours sits on, at the foot of a lifted card (docs/tokens.md section 1, Depth; the owner, 20 November 2026).
 *
 * The class colours are tuned for a light panel and read 1.0 to 1.4:1 on the forest lift, so they are never drawn straight on it, and never changed for it: they sit on this.
 * The forest fades into the mint over 32px, with no hairline. **Nothing is drawn in the fade**: its middle is a mid-green where neither cream nor dark ink reaches 4.5:1,
 * so it holds no children, and the chart and its legend begin below it on full mint. Inside the tray the page's inks return. In dark the tray draws nothing and takes no room,
 * so no dark screen changes. It is the last thing in the card, and spans it edge to edge.
 */
export function LiftTray({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="lift-tray-fade" aria-hidden="true" />
      <div className="lift-tray">{children}</div>
    </>
  );
}
