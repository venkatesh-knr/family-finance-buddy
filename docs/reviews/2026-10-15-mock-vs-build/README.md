# Mock vs build, 15 October 2026

A snapshot, not a specification. For each screen the artboard in `docs/design/vibrant-canvas.html` beside the app
as it was that day (390px wide, dark theme, the seeded test household), with the 37 differences between them
numbered as in the Departures table of `docs/design/conformance.md`, and a recommendation on each.

Open `index.html` in a browser. It goes stale as screens are rebuilt; `conformance.md` is the live record, and a
screen's rows are removed from it when the screen matches its board. To make a fresh one, capture the board and
the screen the way `tests/e2e/screens.spec.ts` does and compare.
