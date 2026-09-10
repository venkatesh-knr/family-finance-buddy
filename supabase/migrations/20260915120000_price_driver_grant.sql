-- Family Finance Buddy — the one privilege the price driver needs.
--
-- `price` was created with `revoke all … from public, anon, authenticated` and
-- a select grant for members. That left the driver unable to write it, because
-- "the project has an event trigger that enables RLS on new tables and does
-- not auto-expose them" — and that is true of every role, service_role
-- included. Deny-by-default applies to the privileged role too, which is the
-- design working rather than the design in the way.
--
-- So the driver gets exactly one privilege: insert on the table of public
-- reference prices. Not select, which it never needs — it writes what the
-- vendor said and reads nothing back. Not update or delete, because prices are
-- appended and a revision is a new row. And nothing at all on any table
-- carrying household data.
--
-- ── the grant that is deliberately absent ───────────────────────────────
--
-- Postgres suggested the other fix itself. The failure arrived as:
--
--   permission denied for table instrument
--   HINT: Grant the required privileges to the current role with:
--         GRANT SELECT ON public.instrument TO service_role;
--
-- That hint is correct SQL and the wrong answer. The driver was reading
-- `instrument` to find out which schemes anybody holds, and taking the hint
-- would have given a key that bypasses every row policy a standing read over
-- every household's portfolio — permanently, to save one round trip.
--
-- The function no longer reads it. The caller already knows which instruments
-- it holds, because it just listed them under its own policies, so it sends
-- the identifiers and the driver fetches those. A caller can only name
-- instruments it can see, and naming one it cannot see would fetch a public
-- NAV for a fund — which is public knowledge and tells nobody who holds it.
--
-- What the secret key can now do, in total: append rows to a table of
-- published prices. That is a much smaller thing to be holding.

grant insert on table public.price to service_role;

comment on table public.price is
  'Dated prices from a driver. Reference data, not household data: a NAV is the same fact for everybody and says nothing about who holds it. Appended, never updated. Written only by the driver, which holds insert on this table and nothing else.';
