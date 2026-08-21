# Forecast Planner — Project Handoff

## Project locations

- Local root: `/home/budflux/Documents/VSCODE/costProjector`
- GitHub: `https://github.com/budflux/Forecast-Planer`
- Published app: `https://budflux.github.io/Forecast-Planer/`
- Branch: `master`
- Supabase project ref: `kthbwzwyijigzctgahcv`
- Supabase URL: `https://kthbwzwyijigzctgahcv.supabase.co`

The app is static HTML/CSS/vanilla JavaScript hosted by GitHub Pages. Supabase provides email authentication, Postgres storage, and per-user Row Level Security.

## Important security rule

`Banking/` and `Transaction-listing-*.pdf` are ignored by Git. They contain private banking data and must remain local. Never commit them. The frontend uses only the public Supabase publishable key; never add a service-role key.

## Main files

- `index.html` — GitHub Pages entry point.
- `model.html` — duplicate local entry page; keep UI changes synchronized with `index.html`.
- `script.js` — Supabase repository, PDF parser, forecast engine, rendering, authentication, and event handling.
- `new.css` — main application styling.
- `ExcelStyleWeekly.html`, `report.js`, `report.css` — weekly report.
- `supabase-config.js` — public Supabase URL/publishable key.
- `supabase/migrations/` — remote database migrations.
- `.gitignore` — protects local banking statements and Supabase temporary files.

## Current database state

The planner tables use `user_id` and RLS so each authenticated user sees only their own data.

Important migrations:

- `20260820112634_create_planner_tables.sql` — planner tables and RLS.
- `20260821094350_actual_weekly_spend.sql` — old manual weekly actual-spend table.
- `20260821182208_statement_daily_spend.sql` — current statement daily-spend table.
- `20260821182730_remove_manual_actual_spend.sql` — drops the obsolete manual actual-spend table.

### Migration status requiring confirmation

The daily-spend migration was reported as applied. The user then attempted to apply the table-removal migration but hit an IPv6 connection refusal. Confirm whether `20260821182730_remove_manual_actual_spend.sql` has been applied.

Retry safely from the project root:

```bash
read -rsp "Supabase database password: " SUPABASE_DB_PASSWORD
echo
export SUPABASE_DB_PASSWORD
bunx supabase db push --dns-resolver https
unset SUPABASE_DB_PASSWORD
```

Do not truncate the database. The frontend no longer queries `actual_weekly_spend`, so it remains functional even if the drop migration is still pending.

## Statement import

The header **Upload statement** button accepts multiple PDFs. PDF.js parses files locally; raw statement transactions are never uploaded. Only daily totals are saved to `statement_daily_spend`.

Supported local formats:

- Amplify Platinum monthly statements.
- St.George transaction-listing PDF.

Parsing behavior:

- Uses each statement's exact start/end date.
- Creates a database row for every covered date, including `$0` days.
- Excludes payment transactions.
- Refunds/credits reduce spending.
- Multiple files are combined before one confirmation preview.
- Identical overlapping dates are deduplicated.
- Conflicting overlapping daily totals stop the import.

All 12 PDFs in `Banking/` were extraction-tested together: 904 transactions, 365 covered dates, and 85 zero-spend dates.

After the daily migration, statements must be re-uploaded so daily coverage is populated. Old weekly PDF totals are obsolete.

## Weekly spending logic

Weeks run Monday–Sunday. The forecast itself starts on the Monday of the configured loan-start week.

For a historical week:

```text
weekly spend = statement spending on covered dates
             + projected weekly spend × uncovered days / 7
```

Consequences:

- Fully statement-covered week: statement total only.
- Fully covered week with no transactions: `$0`.
- Partially covered week: exact statement values plus prorated forecast for uncovered days.
- Historical week with no statement coverage: full projected weekly spend.
- Current and future weeks: full projected weekly spend.

Purchases remain independent from weekly spending.

## Forecast cash-flow formula

For each week:

```text
offset change = wage income
              - resolved weekly spend
              - yearly fixed costs / 52
              - loan repayment (while loan remains)
              + rental income
              + deposits
              - included purchases
```

Offset is floored at zero. Interest is calculated on:

```text
max(0, loan balance - offset balance)
```

Large statement weeks can legitimately reduce the offset quickly. The local statements include several large weeks, including an automotive transaction above $3,500.

## Weekly report

The report includes separate **Purchases** and **Weekly Spend** columns. Weekly Spend is:

- Red when statement-resolved spending exceeds projected spending.
- Green when below projected spending.
- Default colour when no historical statement coverage exists or values are equal.

The report table header is sticky.

## Other current behavior

- Interest Cost Per Year and Offset Balance show horizontally scrollable yearly cards through 2035.
- Their scrollbars are hidden, but wheel/touch/swipe scrolling remains enabled.
- Target Amount uses forecast `gap = offset - loan balance`.
- Offset Date reports the last date offset remained below the loan.
- Calculated dates use `DD/MM/YYYY` and blue text.
- Date inputs validate complete dates and reject end dates before start dates.
- Database saves are serialized to prevent overlapping delete/reinsert races.

## DevTools diagnostics

On app load and when wage configuration changes, the console shows:

```text
[database] X wage-income rows loaded
[forecast wage audit] 2025–2026
```

Expand the wage audit table. `NO MATCH` means that forecast week is outside all configured earning date ranges.

## Build and checks

No build step is required.

```bash
cd /home/budflux/Documents/VSCODE/costProjector
bun run check
```

`bun test` currently reports that no test files exist. Parser and forecast changes have been checked with temporary assertion scripts; `script.js` also contains a statement-parser self-check.

Run locally with VS Code Live Server. GitHub Pages can cache assets briefly; use a hard refresh or private tab when the live site appears stale.

## Git and restore points

Current remote commit before this document: `6e0b515 Remove manual actual spend model`.

Most recent full restore archive:

```text
/home/budflux/Documents/VSCODE/NEW/Forecast-Planer-restore-20260821-165300.tar.gz
```

That restore predates the PDF daily-spend model, so prefer Git history for recent code recovery.

## Immediate next steps

1. Confirm/apply the pending `remove_manual_actual_spend` migration.
2. Re-upload all monthly statements together.
3. Confirm the preview reports 365 covered dates for the complete set.
4. Open the weekly report and inspect Weekly Spend and offset behavior.
5. Use the wage audit if any historical week unexpectedly has zero income.
