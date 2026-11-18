# DRAFT: stated spend, the boards and where they depart

Drawn on 17 November 2026 for `spending-capture.md` §11 (SC-I14 to SC-I19). The pictures
are in `docs/design/stated-spend-boards.html`:

| Board | Shows |
|---|---|
| StateSpend, StateSpendLinen | The form at 375px, states (a) to (e), dark and Linen |
| StateSpend200 | State (b) at 200% text, dark and Linen |
| StateSpendDesktop | The form as a dialog over Money at 1280px, dark and Linen |
| MoneyMonthStated, MoneyMonthStatedLinen | The month card: stated; from balances and itemised only beside it; the cross-check; itemised more than stated; a contributor; a viewer |
| MoneyMonthStatedDesktop | Stated and the cross-check side by side at 880px, dark and Linen |
| MonthCloseNoAccounts, MonthCloseNoAccountsDesktop | The close's last step for a household with no accounts |
| MonthsOfCoverStated | The emergency fund card with the months by source, at 351px and at the Overview column's 564px |
| LinenTokens | The proposed light theme (`docs/drafts/linen-light-theme.md`) |

Every light board is drawn in **Linen**, the light theme the owner chose on 17 November
2026 in place of Mist. `tokens.md` is still to be changed.

## Proposed departures

Each row is in `conformance.md` format, with the status `proposed`.

| What | The prototype | The app | Why | Status |
|---|---|---|---|---|
| Light theme | Mist (`tokens.md`) | Linen: a linen ground and off-white panels; a forest app header and bottom menu, dark at the screen's edge and lighter towards the content, with lime rules and a lime pill for the current place; a lifted card from deep forest at the top to a fresher green at its foot, with cream text and a lime pressed state; soft panels warming to faint linen at their foot | The owner asked for the light version to follow loophealth.com's colours, and chose option A, Linen, with the coloured header and menu, on 17 November 2026. It needs new `--lift-*`, `--btn` and `--bar-*` tokens (see below). **Decided by the owner, 17 November 2026.** | decided |
| State the spend, desktop | (no desktop form drawn anywhere) | A 520px dialog over Money, focus kept inside it, Cancel and Save at its foot, right-aligned | A short form does not need a page on a wide screen, and the month card it changes stays in view behind it. On a phone it is a full screen, as AddCredit is. | proposed |
| The linked fields | (new) | *Spent in total* and *or just the rest*, each with a real label. The total carries a caption with its working (*₹52,000 itemised + ₹30,000 more*), and the rest carries *Typing either one fills the other.* | The person sees what will be saved, a total, whichever field they typed in (§11.3) | proposed |
| Total below itemised, in the form | (new) | The rest field stays visible, empty, with *Nothing to add: this total is less than what is itemised*, and an information line in body ink with the caveat marker, never red | §11.2: neither figure is clamped, and nothing is an error. The person is not being audited. | proposed |
| Saving | (no saving state drawn before) | The fields become read-only, and Save reads *Saving…* with `aria-busy`. No spinner. | No new icon is needed (`icons.md` has none for progress) | proposed |
| The Note field | a one-line input | A text area that grows with its text | At 200% text a one-line note is cut off (StateSpend200) | proposed |
| The source on the month figure | *itemised so far* under Spent | Every Spent carries its source in words under the figure: *stated*, *from balances, 3 of 3 accounts* or *itemised so far*. Saved carries *rough*, *from balances* or *from what you entered*. *stated* and *rough* are in bold. | SC-I15 and SC-I18: the source is always a word, and never a colour | proposed |
| Where the form opens | (new) | A quiet *State October's spend* under the card of a month that has ended and is itemised only, with the line *Only what was itemised. If you know what October cost, you can say it.* A stated month has *Change* in the same place. | §11.3: the form is on the month card. *Change* opens the same form, which voids and states again (SC-I14). | proposed |
| The cross-check | (new) | One sentence of body text under the figures, *Spent ₹91,000 from balances. You said ₹82,000.* No colour, no icon. | SC-I17: balances win, and the stated figure is beside them, never an error | proposed |
| Itemised more than stated | (new) | Spent shows the stated figure. A sentence names both figures and the gap in rupees: *₹55,000 itemised, which is ₹5,000 more than the ₹50,000 you stated. Both are shown; neither is changed.* | SC-I16 | proposed |
| A contributor's month card | (none) | *Spent by you, ₹14,200, itemised by you*, and a line saying the household's month is kept by the owner and the partner. No action. | SC-I19: a contributor reads no stated figure. The card says why, so it reads as intended, not broken. | proposed |
| A viewer | (none) | Nothing on Money: a viewer has the Summary screen alone (conformance, *Screens by role*). Its lifted card says Money and spending are not part of it. | SC-I19, and the existing rule on screens by role | proposed |
| The close, no accounts | the close ends *itemised only* | Step 2 of 2, *Close October: what did the month cost?*, with the same linked fields and hint. The primary button is *Close October*; the quiet one is *Keep it itemised only*. Both are full width on a phone. | §11.3. Keeping it itemised stays a choice, not a dead end. | proposed |
| Months of cover caveat | the sub-line ends at *with spending recorded* | A second line, with the caveat marker: *Of the last twelve months: 4 from balances, 3 stated, 5 itemised only. Itemised-only months read low, which makes the cover read high.* | §11.4. The second sentence says why the count matters. | proposed |

## Screen 7, the note

A contributor and a viewer never see a stated figure, the form or *Change*. That is
SC-I19: an owner or a partner reads and writes it, and a household total is not a
contributor's to read.

- **A contributor** opens Money and sees their own month: what they itemised, labelled
  *itemised by you*, and one line saying who keeps the household's month.
- **A viewer** never reaches Money. Their Summary card says what it covers.

Neither has a disabled button or an empty card.

## For `tokens.md` and `icons.md`

Asked for separately, and **not changed here**:

- **`tokens.md`, because Linen was chosen:**
  - the Linen light block;
  - seven new tokens for what sits on the lifted surface: `--lift-ink`, `--lift-ink-2`,
    `--lift-muted`, `--lift-press`, `--lift-press-ink`, `--lift-track` and
    `--lift-track-line`. They are needed because the Linen lift is dark under a light
    theme;
  - `--btn` and `--btn-ink`, because the primary button is forest in Linen, not ink;
  - `--bar`, `--bar-ink`, `--bar-muted`, `--bar-rule`, `--bar-pill` and
    `--bar-pill-ink`, for the forest header and bottom menu.

  In dark, each new token takes the value the screens already draw. Values and contrast
  are in `docs/drafts/linen-light-theme.md`.
- **`icons.md`:** no change. The boards use only the caveat marker (the circle with a
  lowercase *i*), the chevron and the back arrow. The validation error uses words and the
  coral underline, not the exclamation circle, which `icons.md` §3 warns is too close to
  the caveat marker.
