# Forecast Planner Rebuild Roadmap

## Goal

Rebuild the refactored page using the architecture in `script.js`, while preserving every user-facing input table and forecast feature from `ORIGINAL_P/planner.html`. Keep the application vanilla JavaScript, accessible, responsive, and browser-local with SQLite persistence.

The target page remains a single HTML page with these four navigable areas:

1. Forecast
2. Earnings
3. Loan Settings
4. Purchases

No input table is to be replaced by a summary-only widget.

## Current-state findings

### Refactored files (`index.html`, `new.css`, `script.js`)

- The HTML omits fixed costs, offset deposits, rental table headers/actions, interest-rate changes, loan summary, offset targets, forecast columns, and the report/update behavior.
- `DataRepository` only has complete CRUD for earnings, rentals, and purchases. Deposits, fixed costs, loan inputs, and forecast results are missing.
- `CostProjectorApp` renders only earnings, purchases, and rentals.
- The refactor's forecast is a short loan-only simulation. It does not apply earnings, rentals, fixed costs, deposits, purchases, rate changes, offset growth, redraw, milestones, or quarterly rows.
- Row persistence recreates purchase IDs and uses full-table delete/reinsert saves. This is acceptable for the first working rebuild, but IDs must remain stable before adding smarter saves.
- The original planner contains dead/duplicate code and inconsistent storage calls (`loadData`, `saveData`, and `STORAGE_KEYS` are not defined in the SQL version). Treat its calculations as behavior to verify, not code to copy blindly.

## Required HTML inventory

Restore these structures in `index.html`:

### Loan Settings page

- Six yearly interest-cost readonly fields.
- Six yearly offset-balance readonly fields.
- Loan summary: offset-equals-loan date, offset balance at milestone, total interest, interest saved, and time saved.
- Offset targets: target date/result and target amount/date realised.
- Editable loan inputs: start date, term, amount, interest rate; readonly weekly repayment.
- Interest-rate change input row: effective date, rate, calculated repayment, add row button, and saved change rows with delete controls.

### Earnings page

- Wage income table: from date, to date, weekly wage, weekly projected spend.
- Yearly fixed-cost table: start year, end year, total yearly fixed cost.
- Offset deposit table: deposit date, description, amount.
- Weekly rental income table: from date, to date, weekly rental, add/delete controls.

### Purchases page

- Purchase date, description, value, include checkbox, and included-purchase total.

### Forecast page

- Sticky quarterly table with period, spend, offset, loan outstanding, redraw, and gap.
- Update and Report actions.

Every input needs a visible `<label>` or an accessible table/header association. Navigation must use buttons with `data-page`; page switching must use `.app-page.active`, not inline styles.

## Phase 1 — Establish the application contract

1. Define one state shape:
   - `loanSettings`
   - `loanInputs`
   - `earnings`
   - `fixedCosts`
   - `deposits`
   - `rentals`
   - `purchases`
   - `forecast`
   - `targets`
   - `currentPage`
2. Define normalized record fields and stable IDs for every editable row.
3. Add repository methods for all tables and settings:
   - `get/saveSettings`
   - `get/saveEarnings`
   - `get/saveFixedCosts`
   - `get/saveDeposits`
   - `get/saveRentals`
   - `get/savePurchases`
   - `get/saveLoanInputs`
   - optional forecast-result persistence for report reuse.
4. Make database initialization awaitable. Do not render or read `db` before `repo.init()` completes.
5. Add a small schema/version check for existing `forecastDB` data. Preserve existing records where possible and map the old fixed-cost columns to `totalYearlyCost`.

**Exit criteria:** an initialized state can be loaded and saved without any UI code issuing SQL.

## Phase 2 — Rebuild the HTML and rendering

1. Expand `index.html` with the complete required HTML inventory above.
2. Keep static table headers in HTML; render only repeatable rows into their existing containers.
3. Add one renderer per table, backed only by state:
   - `renderLoanSettings`
   - `renderLoanInputs`
   - `renderEarnings`
   - `renderFixedCosts`
   - `renderDeposits`
   - `renderRentals`
   - `renderPurchases`
   - `renderForecast`
   - `renderMetrics`
4. Use `DocumentFragment` or direct DOM construction for rows. Do not rebuild unrelated pages on every keystroke.
5. Preserve focused input and cursor position when a forecast/metric update occurs.
6. Use event delegation for add, delete, navigation, update, report, and row input events.
7. Make empty tables create one blank input row where the original page did so.

**Exit criteria:** all original input tables are visible, editable, addable, and deletable without inline event handlers.

## Phase 3 — Restore the financial engine

Port the original behavior into pure functions that receive data and return data. Keep SQL and DOM out of the engine.

1. Loan calculations: weekly repayment, interest, principal, remaining balance, zero-rate handling, and term limits.
2. Effective rate changes: select the latest rate change on or before each forecast date; use its optional repayment.
3. Weekly inputs: wage, projected spend, rental income, fixed costs, deposits, and included purchases.
4. Offset calculation: apply weekly surplus and deposits, subtract included purchases, clamp to zero.
5. Loan calculation: interest on `max(loanBalance - offsetBalance, 0)`, repayment, principal, and payoff.
6. Redraw calculation and loan/offset gap.
7. Weekly result records containing all values required by the forecast table and report.
8. Summary metrics:
   - yearly interest cost
   - yearly ending offset
   - offset-equals-loan milestone
   - total interest and interest saved
   - time saved
   - target-date offset
   - target-amount realisation date.
9. Quarterly aggregation for the forecast page.

Use date-only normalization consistently. Invalid or incomplete rows must contribute zero rather than producing `Invalid Date` or `NaN` results.

**Exit criteria:** the engine returns deterministic results for the same state and supports all original forecast outputs.

## Phase 4 — Connect events, persistence, and rendering

1. On input/change, update the matching state record by stable row ID.
2. Save only the changed collection initially; do not add speculative abstractions or a complex reactive framework.
3. Recalculate the forecast after relevant changes.
4. Update only affected row totals, metrics, and forecast output.
5. Implement rental delete behavior and purchase include-total updates.
6. Implement loan-change add/delete behavior and repayment preview.
7. Implement the Update action as an explicit full recalculation; normal edits may also recalculate.
8. Implement Report using the current forecast data. If the report page is retained, add and validate its HTML separately; otherwise provide a downloadable CSV as the minimum working report.
9. Keep page switching independent from database readiness and make the active navigation state accessible.

**Exit criteria:** reload preserves every table, navigation works, and no action throws an undefined-function or missing-element error.

## Phase 5 — Verification

### Automated checks

- `bun run check`: JavaScript syntax check and required-file checks.
- Add one small engine test or runnable self-check covering:
  - zero-interest repayment
  - a weekly deposit/purchase
  - a fixed-cost year range
  - a rate change
  - offset reducing interest.

### Manual acceptance checklist

- Open the page with an empty database.
- Confirm all four pages switch correctly.
- Add/edit/reload at least two rows in every input table.
- Add and delete a rate-change row and rental row.
- Toggle purchase inclusion and verify the total.
- Set loan settings and verify weekly repayment, forecast rows, yearly metrics, milestones, redraw, and gap.
- Change a rate and confirm later weeks use it.
- Confirm target date and target amount outputs.
- Confirm the report uses the latest forecast.
- Test mobile and desktop layouts and keyboard navigation.

## Implementation order

1. Repository/schema and state contract.
2. Complete static HTML and accessible headers/labels.
3. Row renderers and delegated events.
4. Pure financial engine.
5. Forecast/metrics rendering.
6. Report and migration compatibility.
7. Automated/manual verification.

## Out of scope for the first working rebuild

- Framework migration.
- New dependencies beyond the existing sql.js CDN.
- Smart per-cell SQL updates if collection-level saves are reliable.
- Authentication, server storage, or multi-user collaboration.
- Production deployment configuration; add GitHub Pages setup after the page works locally.
