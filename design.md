# Design System --- AI Affiliate Automation Platform

> Product design direction: minimal, calm, practical, and
> workflow-first. The interface should help a solo creator make
> decisions and produce content quickly---not feel like a complicated
> enterprise dashboard.

## 1. Design Principles

1.  **Clarity over decoration.** Every screen has one primary task and a
    clear next step.
2.  **Progressive disclosure.** Show essential information first; place
    advanced settings in collapsible sections or secondary dialogs.
3.  **Consistent patterns.** Reuse the same page header, filters, forms,
    status labels, tables, drawers, and confirmation patterns.
4.  **Honest system states.** Clearly distinguish real data,
    user-entered data, estimates, stale data, unavailable integrations,
    and demo/mock data.
5.  **Actionable empty states.** Explain what is missing and provide one
    useful next action.
6.  **Accessible by default.** Keyboard-friendly controls, visible focus
    states, readable contrast, clear labels, and meaningful error
    messages.
7.  **Responsive and efficient.** Optimize desktop workflows while
    keeping essential actions usable on tablet and mobile.

## 2. Visual Direction

Use a modern minimal SaaS aesthetic inspired by clean productivity and
analytics products. Avoid copying a specific website.

-   Quiet, neutral surfaces with one restrained accent color.
-   Generous spacing, clear hierarchy, thin borders, and subtle shadows
    only when they clarify layers.
-   Use typography, alignment, and whitespace---not decorative
    cards---to create hierarchy.
-   Avoid gradients, glassmorphism, excessive rounded cards, neon
    colors, oversized headings, and unnecessary animation.
-   Do not place every piece of information inside a card.
-   Charts and status colors should communicate meaning, not decoration.

## 3. Color Tokens

Use CSS variables/design tokens instead of hardcoding colors throughout
components. Support light mode first and keep the token structure ready
for dark mode.

### Light theme defaults

-   `--background`: `#F8FAFC` --- app canvas
-   `--surface`: `#FFFFFF` --- panels and menus
-   `--surface-muted`: `#F1F5F9` --- subtle secondary surfaces
-   `--foreground`: `#0F172A` --- primary text
-   `--muted-foreground`: `#64748B` --- secondary text
-   `--border`: `#E2E8F0` --- separators and input borders
-   `--accent`: `#4F46E5` --- primary actions and selected states
-   `--accent-foreground`: `#FFFFFF`
-   `--accent-subtle`: `#EEF2FF`
-   `--success`: `#15803D`
-   `--success-subtle`: `#F0FDF4`
-   `--warning`: `#A16207`
-   `--warning-subtle`: `#FFFBEB`
-   `--danger`: `#B91C1C`
-   `--danger-subtle`: `#FEF2F2`
-   `--info`: `#0369A1`
-   `--info-subtle`: `#F0F9FF`

Check text/background contrast. Never rely on color alone to communicate
status; pair it with a label or icon.

## 4. Typography

-   Use a clean sans-serif system font stack, with a Thai-compatible
    font such as `Noto Sans Thai` where available.
-   Body text: 14--16px; dense table text should remain comfortably
    readable.
-   Page title: 24--28px, medium/semibold.
-   Section heading: 16--18px, semibold.
-   Labels and helper text: 12--14px; never make essential instructions
    too faint or tiny.
-   Use tabular numerals for prices, percentages, and metrics.
-   Keep line lengths moderate and use sentence case. Avoid all-caps
    labels except short technical identifiers.

## 5. Spacing, Layout, and Shape

Use a consistent 4px spacing scale: 4, 8, 12, 16, 24, 32, 40, 48.

-   Desktop sidebar: approximately 232--248px, collapsible.
-   Main content max width: approximately 1440px.
-   Main page padding: 24--32px desktop, 16--20px tablet, 12--16px
    mobile.
-   Form field height: approximately 40px.
-   Button height: 36--40px for standard actions.
-   Border radius: 6--10px for controls and panels; avoid overly
    pill-shaped UI except compact chips.
-   Use subtle 1px borders. Shadows should be rare and low contrast.
-   Keep consistent vertical rhythm between headings, content, and
    actions.

## 6. Application Shell and Navigation

Use a stable left sidebar on desktop and a compact drawer/menu on
smaller screens.

### Navigation order

1.  Overview
2.  Product Research
3.  Products
4.  Content Planner
5.  Script Studio
6.  Video Studio
7.  Asset Library
8.  Publishing
9.  Analytics
10. Settings

Navigation requirements: - Use simple, consistent line icons. - Keep
labels visible on desktop; collapsed mode may use tooltips. - Highlight
the current location clearly without a large colored block. - Put
account/profile controls at the bottom. - Do not show unfinished modules
as if they were fully operational. If a module is planned but
unavailable, label it as coming soon or hide it until useful. - On
mobile, keep the current task and primary action easy to reach.

## 7. Shared Page Patterns

Every major page should follow a consistent structure:

1.  Breadcrumb or section context when needed.
2.  Page title and short explanatory subtitle.
3.  Primary action aligned consistently near the title.
4.  Search, filters, and sorting grouped together.
5.  Main content with loading, empty, error, and success states.
6.  Pagination or load-more behavior where appropriate.

Prefer a single strong primary action per screen. Secondary actions
should use neutral styling. Destructive actions must be clearly
differentiated and confirmed when appropriate.

## 8. Components

### Buttons

-   Primary: accent fill, used for the main action.
-   Secondary: neutral outline or subtle surface.
-   Tertiary: text/ghost style for low-priority actions.
-   Destructive: danger styling, only for destructive operations.
-   Include disabled, loading, hover, active, and keyboard-focus states.
-   Button labels should describe the action: "Import CSV", "Generate
    script", "Render video".

### Forms

-   Use visible labels above fields; do not rely on placeholders as
    labels.
-   Show required/optional status when it is not obvious.
-   Place validation messages next to the relevant field.
-   Preserve entered values when validation fails.
-   Group long forms into logical sections and reveal advanced fields
    only when needed.
-   Explain why a field is needed when the purpose is not obvious.

### Tables and Lists

-   Use tables for scanning and comparing products or jobs.
-   Keep columns focused on decisions; move secondary details to a
    detail page or drawer.
-   Align prices and numeric metrics consistently.
-   Use sticky headers only for long tables.
-   Support search, sort, filters, pagination, and clear reset behavior
    when relevant.
-   On mobile, convert dense tables into readable stacked rows or a
    limited-column layout.
-   Avoid excessive gridlines and overly dense rows.

### Cards

Use cards only when they group related information or provide a
meaningful summary. Avoid wrapping every field in a separate card. Keep
card styles consistent and compact.

### Status Indicators

Use text labels with restrained color: - Draft - Needs review -
Approved - Queued - Processing - Ready - Published - Failed -
Unavailable - Stale data

Do not imply that an action succeeded before the backend confirms
success.

### Dialogs and Drawers

-   Use dialogs for short confirmations or focused tasks.
-   Use drawers for contextual editing that benefits from keeping the
    parent page visible.
-   Use full pages for complex workflows such as editing a video
    project.
-   Include clear cancel/save behavior and protect against accidental
    loss of unsaved work.

### Feedback

-   Toasts for brief confirmations.
-   Inline messages for errors that require action.
-   Progress indicators for long-running jobs.
-   Retry actions when retry is safe.
-   Do not hide important errors only inside a toast.

## 9. Key Screens

### 9.1 Overview Dashboard

Purpose: show what needs attention and help the user continue work.

Prioritize: - "Continue workflow" / pending review items - Recent render
jobs and their actual statuses - Products needing review or with
stale/missing data - Recent published content and available performance
metrics - Recorded costs and commissions only when real data exists

Do not fill the dashboard with decorative KPI cards. Start with a small
number of useful summaries and a recent activity/work queue. Empty
metrics should say "No data yet", not display fabricated zeroes.

### 9.2 Product Research

Purpose: find and evaluate products using evidence.

Include: - Search and category/source filters - Import CSV and add
product actions - Table with product, source, price, commission (if
available), freshness, opportunity score, and status - Clear indication
of missing/unverified values - Filters for data source, category,
freshness, and review status - Bulk actions only when they are
implemented and safe

The opportunity score must be explainable. Provide a detail view showing
component scores, evidence, confidence, and missing data. Never present
the score as a guarantee of sales.

### 9.3 Product Detail

Use a clear summary section followed by tabs or grouped sections: -
Overview - Source and data history - Trend signals - Content ideas -
Scripts and videos - Performance

Display source, retrieval date, freshness, and verification status near
important facts. Make the affiliate URL easy to copy and verify.

### 9.4 Content Planner

Use a guided workflow: 1. Choose product 2. Choose content
objective/template 3. Choose platform and target duration 4. Generate a
draft 5. Review and edit

Avoid presenting too many configuration controls at once. Provide
sensible defaults and an advanced settings section.

### 9.5 Script Studio

Use a readable editor with distinct sections for: - Hook - Narration -
Scene-by-scene storyboard - On-screen text and subtitles - Caption, CTA,
and affiliate disclosure - Claims requiring verification

Allow regeneration of a selected section where feasible, rather than
forcing the user to regenerate the entire script. Clearly mark
AI-generated and unverified content.

### 9.6 Video Studio

This is a core screen and should prioritize the preview.

Suggested desktop layout: - Main area: video preview and playback
controls - Side panel: scene list and selected-scene settings - Bottom
or secondary panel: narration/subtitle timeline when useful

Core actions: - Edit scene text - Replace asset - Reorder scenes -
Adjust supported timing - Preview - Render / rerender - Download MP4,
subtitles, and thumbnail

Show render progress and the real job status. Explain missing assets,
TTS configuration, and validation failures near the affected action. Do
not simulate a completed render.

### 9.7 Asset Library

Use a searchable grid/list with preview, type, source,
license/attribution status, and usage references.

Flag assets with unknown licensing. Do not silently imply that an asset
is safe for commercial use. Make replacement and removal behavior clear.

### 9.8 Publishing

Show each platform connection and its actual connection/permission
status.

For each post, show: - Video and destination platform - Caption and
affiliate disclosure - Approval status - Scheduled/published status when
available - External post URL or ID when returned by the platform -
Errors and next actions

If automated publishing is not configured, provide a useful manual
export workflow. Never display a connected/published status without
backend confirmation.

### 9.9 Analytics

Prioritize trends and decisions over decorative charts: - Views/watch
metrics - Clicks and conversions when data is available - Confirmed
commissions and recorded costs - Comparison by product, creative
template, hook, platform, and date range

Every chart needs a title, understandable axes, units, date range, and
useful empty state. Show source and freshness. Do not calculate CTR or
conversion rate when the required denominator is missing. Avoid strong
conclusions from small samples.

### 9.10 Settings

Group settings into: - Profile - AI provider - TTS - Storage and
rendering - Platform integrations - Usage and cost limits - Data
import/export

Never expose API secrets in client UI or logs. Show whether a provider
is configured and tested without revealing credentials.

## 10. Data Trust and Transparency

This product relies on external product data and AI-generated content,
so trust is part of the design.

Use explicit labels: - Verified source data - User supplied - Imported -
AI generated - Estimate - Stale - Unavailable - Requires review

For each important external value, show its source and last-updated time
where practical. Provide a clear path to correct or refresh stale data.
Do not use color alone for verification status.

## 11. Motion and Interaction

Keep motion subtle and purposeful: - Short transitions for menus,
dialogs, and state changes. - Skeletons for content loading where they
help. - Progress feedback for imports and renders. - No constant
animated backgrounds, decorative motion, or distracting effects. -
Respect reduced-motion preferences. - Avoid layout shifts during
loading.

## 12. Accessibility and Responsive Behavior

-   Use semantic headings and landmarks.
-   Ensure all actions work with keyboard navigation.
-   Provide visible focus indicators.
-   Associate form labels and errors with their inputs.
-   Provide accessible names for icon-only controls.
-   Ensure adequate contrast and readable font sizes.
-   Do not rely on color alone.
-   Support browser zoom and narrow screens.
-   On mobile, prioritize the current task and essential actions; avoid
    simply shrinking the desktop layout.

## 13. Technical Implementation Rules

-   Implement design tokens as CSS variables and reuse them
    consistently.
-   Build reusable components for buttons, inputs, selects, tables,
    status labels, dialogs, empty states, and page headers.
-   Use the existing UI library if the repository already has one that
    works; do not introduce duplicate component systems without a
    reason.
-   Keep visual components separate from business logic and API calls.
-   Use real backend state and clear loading/error/empty states.
-   Do not create fake metrics, fake integrations, non-functional
    buttons, or misleading placeholder screens.
-   Do not add dependencies solely for visual effects.
-   Maintain TypeScript strictness and responsive behavior.
-   Add tests for critical interactions when the project's test setup
    supports them.

## 14. Definition of Done for UI Work

A screen is complete only when: - It matches this design direction and
shared component system. - It works at desktop and mobile sizes. -
Loading, empty, error, disabled, and success states are considered. -
Forms validate and display actionable errors. - Buttons perform their
advertised action. - Data is clearly labeled by source and
reliability. - Keyboard focus and readable contrast are present. - No
important content is hidden behind decorative UI. - No mock data is
presented as real. - The page has been checked against the project's
actual build and lint scripts.

## 15. Instruction to Claude Code

Before implementing or redesigning screens: 1. Inspect the existing
repository and identify the current UI stack and component library. 2.
Reuse existing working components where appropriate. 3. Summarize the
planned design changes and shared tokens. 4. Implement the design system
incrementally, beginning with the application shell and shared
components. 5. Apply it to one core workflow at a time: Product Research
→ Content Planner → Script Studio → Video Studio. 6. Verify
functionality and responsive behavior before moving on. 7. Keep this
file as the design source of truth. If implementation constraints
require a deviation, explain the reason and update this document rather
than silently drifting.

The final result should feel calm, minimal, consistent, and easy to use.
Favor a working workflow over decorative complexity.

## 16. Implementation Notes and Deviations

Recorded per §15.7. Last updated 2026-10-20.

-   **Token names (§3).** The UI uses shadcn/ui, whose components read
    `--primary`, `--accent`, `--destructive`, `--card`, `--muted`. To
    avoid forking every component, the design tokens are mapped in
    `src/app/globals.css`: design `--accent` → `--primary`,
    `--accent-subtle` → `--primary-subtle` (also shadcn `--accent`,
    used for hover/selected backgrounds), `--danger` → `--destructive`
    (+ `--destructive-subtle`), `--surface`/`--surface-muted` are
    defined as-is and aliased to `--card`/`--muted`. Values are exactly
    the §3 light defaults; `.dark` keeps the same structure.
-   **Typography (§4).** System sans stack for Latin text with
    `Noto Sans Thai` (next/font) for Thai glyphs. Body 14px.
-   **Shared components (§13).** `src/components/shared/`: `PageHeader`
    (+ breadcrumb), `SectionHeader`, `EmptyState`, `ErrorState`,
    `Notice` (inline error/warning/success/info), `StatusBadge`
    (workflow statuses), `TrustBadge` (data-trust labels, §10), `Chip`,
    `Field` + `NativeSelect`, `ConfirmDialog`, `CopyButton`,
    `DataTable`/`Th`/`Td`/`Tr` (with `hideBelow` for limited-column
    mobile tables). Shell: `src/components/layout/app-shell.tsx`, nav
    order in `nav-config.ts`.
-   **Planned modules in navigation (§6).** Content Planner, Script
    Studio, Video Studio, Asset Library, Publishing and Analytics have no
    backend yet. They appear in the sidebar as non-interactive items
    labelled "เร็วๆ นี้" with the delivering milestone in a tooltip; no
    placeholder pages exist.
-   **Product Research vs Products.** `/research` is for evaluation
    (filters: source, category, freshness, missing data; sort by price /
    commission). `/products` is catalogue management (search, add, edit,
    import). /research shows the Opportunity Score (number + confidence
    in words) and can sort by it; the product page has a "คะแนนโอกาส"
    tab with components, evidence, missing data and limitations. The
    score is never labelled as a sales forecast.
-   **Research sub-pages.** Sources/freshness and trends live under
    Product Research as a tab row (`/research`, `/research/sources`,
    `/research/trends`) so the sidebar keeps the §6 order. Product
    Detail gains a "สัญญาณเทรนด์" tab (§9.3) once trend data exists.
-   **Content Planner / Script Studio (§9.4–9.5).** `/content` lists
    projects; `/content/new` is the guided form (advanced = title).
    `/studio/[id]` keeps the approval panel beside the editor on large
    screens and above it on small ones. "Regenerate section" resets one
    scene from its template (no AI provider yet). Product Detail adds
    "ข้อเท็จจริง" and "คอนเทนต์" tabs.
-   **Video Studio (§9.6).** `/videos/[storyboardId]` puts the video
    first (rendered file, else the live Remotion preview) with the render
    panel, downloads and QA report beside it; on small screens the
    render panel comes first. Scene editing stays in Script Studio
    (approved scripts are locked; edits = new version, then render).
    Progress is the worker's real stage/percentage; a queued job with no
    worker shows how to start it.
-   **Asset Library (§9.7).** `/assets` keeps upload above a filterable
    card grid; each card shows preview, source, a license chip coloured
    by the licensing verdict (with the reason in text) and usage count.
    License defaults to "ไม่ทราบสิทธิ์". Scenes pick assets in Script
    Studio; a picked asset replaces the product card full-screen.
-   **Usage & limits (§9.10).** Settings adds today/month spend,
    30-day usage per provider and daily/monthly caps; the rate in use is
    stated, and the copy says free work is never blocked.
-   **Product Detail tabs (§9.3).** Only tabs with real data are shown:
    Overview, and Source & data history. Trend signals, content ideas,
    scripts/videos and performance tabs are added when their milestones
    land.
-   **Route-level loading skeletons (§11).** Not used. With Next.js
    15.5 / React 19.1 in this app, adding `loading.tsx` caused client
    navigations (server-action redirects, tab changes) to never commit —
    reproduced three ways and fixed by removing the file. Navigation
    therefore keeps the current page visible until the next one is
    ready (no layout shift). Long operations (CSV import) show explicit
    progress. Revisit when upgrading Next.js.
-   **Unsaved work (§8 Dialogs).** The product form warns via
    `beforeunload` when leaving with unsaved edits; client-side link
    navigation is not intercepted (Next.js has no stable API for it).
