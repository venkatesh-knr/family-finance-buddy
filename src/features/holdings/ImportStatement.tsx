/**
 * Importing a consolidated account statement.
 *
 * "Ship manual entry first and make it genuinely fast — imports are
 * accelerants, not prerequisites" (§791). Manual entry is built, and this is
 * the accelerant: every SIP instalment is a lot, so three years of a monthly
 * SIP is a hundred-odd rows nobody will ever type, and until they exist XIRR
 * and lot-level gains cannot turn on for that fund.
 *
 * ── the file never leaves this machine ──────────────────────────────────
 *
 * It is opened by the browser's own PDF engine, with your password, in this
 * page. Nothing is uploaded, and nothing about the file is stored: not the
 * file, not its name, not the password, and not the folio numbers it lists.
 * "A document listing every folio, your PAN and your address is never uploaded
 * anywhere. That is better than any server-side design, not a compromise with
 * one" (§894).
 *
 * What reaches the database is what the statement means: purchases, sales, the
 * last four characters of each folio, and a one-way hash of each line so the
 * same statement cannot be imported twice.
 *
 * ── nothing is written until you say so ─────────────────────────────────
 *
 * Every row is shown first, with what it will become and what it will not.
 * Rows can be left out. What cannot be done here is editing a figure: a
 * purchase whose cost is wrong is corrected on the holding afterwards, with
 * the editor that already exists, rather than in a second editor built into
 * this screen. That is a deliberate narrowing of "let every row be changed
 * before anything is written" — leaving a row out and fixing one afterwards
 * covers the same ground, and one editor is one place for that logic to be
 * right.
 */

import { useMemo, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { sha256Hex } from '../../lib/hash.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { formatQuantity } from '../../lib/quantity.ts';
import { PasswordNeeded, readStatementLines } from '../../lib/ecas-pdf.ts';
import { parseEcas, type EcasTransaction, type EcasFolio } from '../../domain/ecas.ts';
import { importStatement, alreadyImported, type ImportKind, type PlannedFolio } from '../../repo/imports.ts';
import type { HoldingListing } from '../../repo/types.ts';
import { Button, Card, Field, Notice, PasswordField, Pill, Problem, Table } from '../../ui/primitives.tsx';

/** What a parsed line becomes, decided once and shown in the preview. */
type Fate = 'purchase' | 'sale' | 'not-recorded' | 'already-in';

interface PreviewRow {
  readonly txn: EcasTransaction;
  readonly hash: string;
  readonly fate: Fate;
  /** Why a row is not recorded, in a few words. */
  readonly because: string | null;
}

interface PreviewFolio {
  readonly folio: EcasFolio;
  readonly rows: readonly PreviewRow[];
}

function fateOf(txn: EcasTransaction): { fate: Fate; because: string | null } {
  switch (txn.kind) {
    case 'purchase':
    case 'switch_in':
    case 'dividend_reinvest':
      return { fate: 'purchase', because: null };
    case 'redemption':
    case 'switch_out':
      return { fate: 'sale', because: null };
    case 'charge':
      return { fate: 'not-recorded', because: 'A charge, not a purchase — no table holds one yet' };
    case 'dividend_payout':
      return { fate: 'not-recorded', because: 'A payout waits on the dividend table' };
    default:
      return { fate: 'not-recorded', because: 'This description matches nothing the parser knows' };
  }
}

export function ImportStatement({
  listing,
  onImported,
}: {
  listing: HoldingListing | null;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [folios, setFolios] = useState<readonly PreviewFolio[] | null>(null);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [registrar, setRegistrar] = useState<'cams' | 'kfintech' | 'unknown'>('unknown');
  const [unread, setUnread] = useState<readonly string[]>([]);
  const [memberOf, setMemberOf] = useState<Readonly<Record<string, string>>>({});
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState<string | null>(null);

  const viewerMemberId = listing?.viewer.memberId ?? '';
  const canRecord = listing?.viewer.canRecord ?? false;
  const members = useMemo(() => (listing?.members ?? []).filter((m) => !m.isArchived), [listing]);

  const counts = useMemo(() => {
    const rows = (folios ?? []).flatMap((f) => f.rows);
    const willWrite = rows.filter((r) => (r.fate === 'purchase' || r.fate === 'sale') && !left.has(r.hash));
    return {
      purchases: willWrite.filter((r) => r.fate === 'purchase').length,
      sales: willWrite.filter((r) => r.fate === 'sale').length,
      alreadyIn: rows.filter((r) => r.fate === 'already-in').length,
      notRecorded: rows.filter((r) => r.fate === 'not-recorded').length,
    };
  }, [folios, left]);

  async function read() {
    if (file === null || listing === null) return;

    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const { lines } = await readStatementLines(await file.arrayBuffer(), password);
      const statement = parseEcas(lines);

      if (statement.folios.length === 0) {
        setProblem(
          'No folios were found in that file. It may be a summary rather than a transaction statement, or a layout this parser has not met.',
        );
        setFolios(null);
        return;
      }

      // Hash every line first, then ask the database which it already holds, so
      // the preview can say "already in" rather than the import reporting it.
      const hashed = await Promise.all(
        statement.folios.map(async (folio) => ({
          folio,
          rows: await Promise.all(
            folio.transactions.map(async (txn) => ({
              txn,
              hash: await sha256Hex(txn.identity),
              ...fateOf(txn),
            })),
          ),
        })),
      );

      const present = await alreadyImported(
        listing.household.id,
        hashed.flatMap((f) => f.rows.map((r) => r.hash)),
      );

      setFolios(
        hashed.map((f) => ({
          folio: f.folio,
          rows: f.rows.map((r) => ({
            ...r,
            fate: present.has(r.hash) ? ('already-in' as const) : r.fate,
          })),
        })),
      );
      setMemberOf(Object.fromEntries(hashed.map((f) => [f.folio.folio, viewerMemberId])));
      setPeriod(statement.period);
      setRegistrar(statement.registrar);
      setUnread(statement.unread.map((u) => u.line));
      setLeft(new Set());
    } catch (error) {
      if (error instanceof PasswordNeeded) setProblem(error.message);
      else setProblem(error instanceof Error ? error.message : 'That file could not be read.');
      setFolios(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (folios === null || listing === null) return;

    setBusy(true);
    setProblem(null);
    try {
      const planned: PlannedFolio[] = folios.map((entry) => ({
        scheme: entry.folio.scheme === '' ? 'Unnamed scheme' : entry.folio.scheme,
        isin: entry.folio.isin,
        folioLast4: entry.folio.folioLast4,
        memberId: memberOf[entry.folio.folio] ?? viewerMemberId,
        currency: 'INR',
        purchases: entry.rows
          .filter((row) => row.fate === 'purchase' && !left.has(row.hash))
          .map((row) => ({
            acquiredOn: row.txn.date,
            quantity: formatQuantity(row.txn.units),
            costMinor: row.txn.amountMinor,
            sourceHash: row.hash,
            note: row.txn.description,
          })),
        sales: entry.rows
          .filter((row) => row.fate === 'sale' && !left.has(row.hash))
          .map((row) => ({
            disposedOn: row.txn.date,
            quantity: formatQuantity(row.txn.units),
            proceedsMinor: row.txn.amountMinor,
            sourceHash: row.hash,
            note: row.txn.description,
          })),
      }));

      const kind: ImportKind = registrar === 'kfintech' ? 'ecas_kfintech' : 'ecas_cams';

      const outcome = await importStatement({
        householdId: listing.household.id,
        kind,
        label: label.trim() === '' ? null : label.trim(),
        period,
        folios: planned,
      });

      setDone(
        `${String(outcome.purchasesWritten)} purchases and ${String(outcome.salesWritten)} sales recorded, across ${String(outcome.holdingsCreated)} new positions.`,
      );
      setFolios(null);
      setFile(null);
      setPassword('');
      onImported();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That statement could not be imported.');
    } finally {
      setBusy(false);
    }
  }

  if (!canRecord) return null;

  return (
    <Card
      title="Import a statement"
      collapsible
      defaultOpen={false}
      summary="A CAMS or KFintech eCAS, read on this device. Every SIP instalment becomes a purchase."
    >
      <p className="note">
        The file is opened here, by the browser, with your password. It is never uploaded, and
        nothing about it is kept — not the file, not its name, not the password, and not your folio
        numbers. What is recorded is what it means: purchases, sales, the last four characters of
        each folio, and a one-way fingerprint of each line so the same statement cannot be imported
        twice.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="micro-label">The statement</span>
          <input
            className="field"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFolios(null);
              setDone(null);
            }}
          />
        </label>

        <PasswordField
          label="Its password"
          hint="An eCAS is password-protected. The email it came with says what the password is."
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        <Field
          label="Call this import"
          hint="Optional, and for you — never the file's name, which often carries a PAN."
          value={label}
          placeholder="Three years of SIPs"
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />

        <div>
          <Button
            type="button"
            disabled={file === null || busy}
            onClick={() => {
              void read();
            }}
          >
            {busy ? 'Reading…' : 'Read the file'}
          </Button>
        </div>
      </div>

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}

      {done !== null && (
        <p className="note mt-3" role="status">
          {done} Figures that came out wrong can be corrected on the holding itself.
        </p>
      )}

      {folios !== null && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
            {period === null
              ? 'The file states no period.'
              : `Covering ${formatIsoDate(period.from)} to ${formatIsoDate(period.to)}.`}{' '}
            {counts.purchases} purchases and {counts.sales} sales will be recorded.
            {counts.alreadyIn > 0 && ` ${String(counts.alreadyIn)} lines are already in from an earlier import.`}
            {counts.notRecorded > 0 && ` ${String(counts.notRecorded)} are not recorded at all — each says why.`}
          </p>

          {unread.length > 0 && (
            <Notice tone="due" names={unread} namesLabel="Show the lines">
              {unread.length} line{unread.length === 1 ? '' : 's'} could not be read. Nothing was
              guessed at — check these against the file, and record anything that matters by hand.
            </Notice>
          )}

          {folios.map((entry) => (
            <div key={entry.folio.folio}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-body font-semibold">
                  {entry.folio.scheme === '' ? 'Unnamed scheme' : entry.folio.scheme}
                </h3>
                <span className="note">
                  Folio ending {entry.folio.folioLast4}
                  {entry.folio.isin !== null && ` · ${entry.folio.isin}`}
                </span>
              </div>

              <label className="mt-2 flex flex-wrap items-center gap-2">
                <span className="micro-label">Whose holding</span>
                <select
                  className="field w-auto"
                  value={memberOf[entry.folio.folio] ?? viewerMemberId}
                  onChange={(event) => {
                    setMemberOf((was) => ({ ...was, [entry.folio.folio]: event.target.value }));
                  }}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2">
                <Table label={`Transactions in folio ending ${entry.folio.folioLast4}`}>
                  <thead>
                    <tr>
                      <th scope="col">Include</th>
                      <th scope="col">Date</th>
                      <th scope="col">What the statement says</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col" className="num">Units</th>
                      <th scope="col">Becomes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.rows.map((row) => {
                      const writable = row.fate === 'purchase' || row.fate === 'sale';
                      return (
                        <tr key={row.hash}>
                          <td>
                            <input
                              type="checkbox"
                              checked={writable && !left.has(row.hash)}
                              disabled={!writable}
                              aria-label={`Include ${row.txn.description} on ${row.txn.date}`}
                              onChange={(event) => {
                                setLeft((was) => {
                                  const next = new Set(was);
                                  if (event.target.checked) next.delete(row.hash);
                                  else next.add(row.hash);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td>{formatIsoDate(row.txn.date)}</td>
                          <td>{row.txn.description}</td>
                          <td className="num">{formatMoney(money(row.txn.amountMinor, 'INR'))}</td>
                          <td className="num">
                            {row.txn.units === 0n ? '—' : formatQuantity(row.txn.units)}
                          </td>
                          <td>
                            {row.fate === 'purchase' && <Pill tone="ok">A purchase</Pill>}
                            {row.fate === 'sale' && <Pill tone="warn">A sale</Pill>}
                            {row.fate === 'already-in' && <Pill tone="neutral">Already in</Pill>}
                            {row.fate === 'not-recorded' && (
                              <span className="note">{row.because}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={busy || counts.purchases + counts.sales === 0}
              onClick={() => {
                void commit();
              }}
            >
              {busy ? 'Recording…' : `Record ${String(counts.purchases + counts.sales)} rows`}
            </Button>
            <button
              type="button"
              className="note underline"
              disabled={busy}
              onClick={() => {
                setFolios(null);
                setDone(null);
              }}
            >
              Leave it for now
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
