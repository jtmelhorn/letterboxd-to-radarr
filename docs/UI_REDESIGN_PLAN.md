# UI/UX Redesign Plan — letterboxdarr

## Goal
A cleaner, calmer, premium dark dashboard that improves information hierarchy, spacing, and interaction flow without touching the sync/Radarr/Letterboxd backend logic.

## Current component map

| Area | Files |
|------|-------|
| Page shell / orchestration | `web/app/page.tsx` |
| Layout + global styles | `web/app/layout.tsx`, `web/app/globals.css` |
| Navigation | `web/app/components/DashboardNav.tsx` |
| Shared UI primitives | `web/app/components/ui.tsx` |
| Movie grid + cards | `web/app/components/MovieGrid.tsx`, `web/app/components/PosterCard.tsx` |
| Movie detail | `web/app/components/MovieDetailModal.tsx` |
| Settings / sync config | `web/app/components/SettingsModal.tsx`, `web/app/components/SyncConfigurationPanel.tsx`, `web/app/components/ControlPanelForm.tsx`, `web/app/components/SyncFilterControls.tsx` |
| Side panels | `web/app/components/ActivityPanel.tsx`, `web/app/components/SyncedPanel.tsx`, `web/app/components/ApprovalsPanel.tsx` |
| Dialogs / gates | `web/app/components/RemoveMovieDialog.tsx`, `web/app/components/AuthGate.tsx`, `web/app/components/DashboardEmptyState.tsx` |
| Icons | `web/app/components/icons.tsx` |

## Biggest UX problems found

1. **Dashboard is visually noisy.** Stat cards, alerts, filter bar, and grid compete for attention with no clear hierarchy.
2. **Filter/search area is large and disconnected.** Rating chips, genre dropdown, scope selector, and search sit in one long wrapping row that overwhelms the grid.
3. **Movie cards lack clear state language.** Added/error/loading states are present but subtle; hover action discoverability varies by pointer.
4. **Movie detail modal is a centered, admin-style panel.** Poster and metadata fight for space; actions look like stacked generic buttons.
5. **Sync configuration modal is a giant vertical scroll.** Reviewer pool, group creation, and every group editor are shown simultaneously with deep nesting.
6. **Settings modal repeats controls.** Sync config, approvals summary, blocklist, and Radarr form are stacked in one scroll.
7. **Inconsistent primitives.** Inputs, buttons, badges, and cards redefine similar styles in every file.

## Proposed new layout

### Dashboard
- Fixed, simplified top nav with brand, sync action, and utility icons.
- Below nav: a compact, **sticky** filter toolbar.
  - Left: scope selector + result count.
  - Center: rating chips, collapsible "Advanced filters" button for genre/year.
  - Right: prominent search input.
- Movie grid is the dominant focus, with improved cards and empty/error states.
- Status alerts are stacked above the toolbar but kept compact.

### Movie cards
- Poster-first card with 2:3 aspect ratio preserved.
- Top-left: rating badge.
- Top-right: status indicator (synced / failed / pending / idle).
- Hover/focus reveals a single primary action and a "more" path (detail drawer).
- Bottom title area cleaner with better overflow handling.

### Movie detail
- Desktop: **right-side drawer** (`max-w-xl`) with large poster, clean metadata sections, reviewer notes, and clear action buttons.
- Mobile: full-screen modal/drawer.
- Status shown as a prominent banner; destructive action distinct and still confirms through the existing `RemoveMovieDialog`.

### Sync groups / Settings
- `SettingsModal` gains tabs: **Sync Groups**, **Radarr Connection**, **Blocklist**.
- `SyncConfigurationPanel` becomes a cleaner two-column manager:
  - Left: reviewer pool + "Create group" form.
  - Right: group list where each group is a card. Filters and reviewer assignment are grouped visually but remain editable without extra scrolling layers.
- `ControlPanelForm` keeps its current field set but uses the shared design-system classes for a consistent look.

### Activity / approvals / synced panels
- Use the same drawer shell as the movie detail.
- Cleaner rows, consistent badges, and polished empty states.

## Components to refactor

1. **Shared primitives** (`ui.tsx` + `globals.css`)
   - `Button`, `IconButton`, `Input`, `Select`, `Badge`, `Card`, `Panel`, `Drawer`, `ModalShell`, `EmptyState`.
2. **Dashboard** (`DashboardNav.tsx`, `page.tsx`, `MovieGrid.tsx`, `PosterCard.tsx`)
3. **Movie detail** (`MovieDetailModal.tsx`)
4. **Settings / sync config** (`SettingsModal.tsx`, `SyncConfigurationPanel.tsx`, `ControlPanelForm.tsx`, `SyncFilterControls.tsx`)
5. **Panels** (`ActivityPanel.tsx`, `SyncedPanel.tsx`, `ApprovalsPanel.tsx`)
6. **Dialogs / gates** (`RemoveMovieDialog.tsx`, `AuthGate.tsx`, `DashboardEmptyState.tsx`)

## Files expected to change

- `web/app/globals.css`
- `web/app/components/ui.tsx`
- `web/app/page.tsx`
- `web/app/components/DashboardNav.tsx`
- `web/app/components/MovieGrid.tsx`
- `web/app/components/PosterCard.tsx`
- `web/app/components/MovieDetailModal.tsx`
- `web/app/components/SettingsModal.tsx`
- `web/app/components/SyncConfigurationPanel.tsx`
- `web/app/components/ControlPanelForm.tsx`
- `web/app/components/SyncFilterControls.tsx`
- `web/app/components/ActivityPanel.tsx`
- `web/app/components/SyncedPanel.tsx`
- `web/app/components/ApprovalsPanel.tsx`
- `web/app/components/RemoveMovieDialog.tsx`
- `web/app/components/AuthGate.tsx`
- `web/app/components/DashboardEmptyState.tsx`
- `docs/UI_REDESIGN_PLAN.md` (this file)

Tests will be updated only if component structure changes in a way that affects selectors; the goal is to keep existing selectors working where possible.

## Risks and non-goals

### Risks
- Changing markup can break `screen.getByLabelText` / `screen.getByRole` tests. Mitigation: preserve key accessible labels and placeholders, and update tests only for intentional structural changes.
- Heavy global CSS changes can affect unintended components. Mitigation: keep new classes additive and replace per-component styles incrementally.
- Drawer layout may shift focus-trap containers. Mitigation: keep `modalRef`/`panelRef` semantics and focus-trap hooks unchanged.

### Non-goals
- No backend rewrite, no API route changes, no sync/Radarr/Letterboxd logic changes.
- No data-model changes beyond minimal additive fields if a clear UI bug requires one (none identified).
- No new runtime dependencies.
- No removal of existing features (Radarr settings, blocklist, approvals, manual add/remove, refresh metadata, etc.).

## What actually changed

1. **Shared design system** (`globals.css`, `ui.tsx`)
   - Added semantic utility classes for panels, cards, buttons, inputs, selects, badges, chips, status banners, empty states, modals, and drawers.
   - Exported reusable React primitives: `Button`, `IconButton`, `Input`, `Select`, `Badge`, `EmptyState`, `ModalHeader`, `DrawerHeader`.
2. **Dashboard** (`page.tsx`, `DashboardNav.tsx`, `MovieGrid.tsx`, `PosterCard.tsx`, `DashboardEmptyState.tsx`)
   - Simplified nav and made icon buttons consistent.
   - Replaced the sprawling filter bar with a compact, sticky toolbar: scope selector + count on the left, rating/genre/hide-added filters in the center, search on the right.
   - Collapsible filters on mobile via a "Filters" button.
   - Cleaner movie cards with badge-style rating and status, clearer hover/focus overlay, and preserved poster aspect ratio.
   - Empty/loading states now use the shared `EmptyState` and `ui-card` styles.
3. **Movie detail** (`MovieDetailModal.tsx`)
   - Now renders as a right-side drawer on desktop (`md:`) and a bottom-sheet/full-screen modal on mobile.
   - Larger poster area, cleaner metadata layout, status banner, and action buttons using shared variants.
   - Destructive "Remove from Radarr" stays visually distinct and still opens the existing confirmation dialog.
4. **Settings / sync config** (`SettingsModal.tsx`, `SyncConfigurationPanel.tsx`, `ControlPanelForm.tsx`, `SyncFilterControls.tsx`)
   - `SettingsModal` now uses a tabbed layout: Sync groups, Radarr connection, Blocklist.
   - `SyncConfigurationPanel` uses the shared design system but keeps the reviewer pool/group list structure and all accessible labels so existing tests still pass.
   - `ControlPanelForm` and `SyncFilterControls` adopt the new input/select/button styles.
5. **Panels** (`ActivityPanel.tsx`, `SyncedPanel.tsx`, `ApprovalsPanel.tsx`)
   - Unified drawer shell and header.
   - Consistent search inputs, badges, empty states, and button variants.
   - Preserved all action labels tested in `ApprovalsPanel.test.tsx`.
6. **Dialogs / gates** (`RemoveMovieDialog.tsx`, `AuthGate.tsx`)
   - Applied shared card, input, and button styles.

## Verification

- `npm run typecheck` passed with no errors.
- `npm test` passed (44 tests; integration/repo tests that require native SQLite modules were skipped by the project).
