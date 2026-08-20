# Roadmap: Restoring Functionality (Efficiently)

The primary goal is to restore the original functionality of the application while maintaining the new, clean, modular architecture. We will avoid the "spaghetti" approach of 2000+ lines of duplicate DOM code.

## Phase 1: Data Model & Repository Completion
- [ ] Define CRUD methods in `DataRepository` for all remaining tables (`earnings`, `rentals`, `purchases`, `deposits`, `fixed_costs`).
- [ ] Implement a centralized `loadData` / `saveData` interface for these tables.

## Phase 2: Component-Based UI Rendering
Instead of dedicated `add*Row` functions for every entity, we will build a generic `FormManager` or `RowBuilder` class.
- [ ] **Earnings Component:** Handle wage/spend logic.
- [ ] **Rentals Component:** Handle rental income inputs.
- [ ] **Purchases Component:** Handle list management + total calculation.
- [ ] **Loan Inputs Component:** Handle interest rate variations.
- [ ] **Forecast Component:** Re-implement the table rendering with performant DOM updates (no innerHTML-thrashing).

## Phase 3: Financial Engine Integration
- [ ] Wire the `FinancialEngine` methods into the `CostProjectorApp.render()` cycle.
- [ ] Re-implement `runWeeklyForecast()` to work with the new state object, ensuring it pulls data from the `DataRepository` via the application state rather than direct DB calls.

## Phase 4: Event Delegation & Persistence
- [ ] Consolidate all change listeners into the `bindEvents` delegation logic.
- [ ] Implement "Smart Saves": Only persist changed records to SQLite, rather than `DELETE ALL` -> `INSERT ALL` pattern.

## Guidelines for Rebuilding
1. **DRY (Don't Repeat Yourself):** If you are writing a function that looks like another function, make it a generic method.
2. **State-Driven UI:** UI updates must be reactive to `this.state` changes.
3. **Strict Separation:** No SQL inside UI components; no DOM manipulation inside the `FinancialEngine`.

---
*Status: Architecture foundation laid. Awaiting execution of Phase 1.*
