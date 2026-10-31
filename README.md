# git:signals — comparable Git activity, from one source of truth

A local, zero-build dashboard to compare one or more Git contributors with the **same selection and denominator in every view**. It runs entirely in your browser; imported logs are not uploaded to a server.

## Run

From this directory, serve the static app with:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` and choose **Explore demo dataset**, or use the generated `git log` command inside a Git repository. Confirm/merge contributor identities, then build the dashboard. Use **Add identities** on a contributor to open a searchable multi-selector, tick as many Git author emails as needed (including identities currently under other names), and **Move identities** to apply the batch. The picker previews affected commits and source groups; you can cancel, press Escape, or undo the most recent move. Splitting identities still works independently. The example command uses macOS `pbcopy`; on other systems, remove that final pipe and paste the result yourself.

No build, install, backend, API key, or CDN for JavaScript is needed. The optional Google Fonts request can fall back to local fonts offline.

## Consistent selection model

**Every view** is rendered from one `buildAnalysis(rawCommits, groups, scope)` result in `assets/domain.js`. It applies the following, in this order:

1. **Identity** — reconcile any number of author emails into people using an explicit, searchable batch selector; select all, any subset, or one person (Solo). Moving identities changes only their contributor mapping, not the imported commits. Already-merged source groups lose only the selected emails; empty source groups disappear.
2. **Dates** — inclusive authored dates; all imported history, latest 90/365/730 days, calendar year or custom. Rolling presets anchor to the *latest imported commit*, not the computer's current date.
3. **Commit policy** — include/exclude merge commits and revert commits; excluded commits disappear from every view and from both the selection and the reference.
4. **Metric and presentation** — choose commits, active days, line additions/deletions/churn, file touches, VERSION-file changes, revert or merge commits. Display absolute totals, share of a reference group, per active contributor-day, or per calendar week.
5. **Reference** — entire imported cohort or only the selected people. This changes percentages and repository comparisons, never the selected commit set.

The **ranking, trend and comparison table** use the chosen metric and mode. The **activity pulse** can show that metric as monthly totals or as a daily calendar, always using absolute values and one shared intensity scale across selected people. Daily hovers show the day’s complete filtered commit list, change metrics and share of the selected reference group; click/tap pins a scrollable detail panel. **Working rhythm** and **change-size footprint** are purpose-specific distributions of *the same filtered commits* and have explicitly labelled within-person percentage scales; they don't silently switch filters. **File hotspots** always count file touches in the same selected commits against the chosen reference. **Recent commits** contains only filtered records. Searching a name in the picker only narrows that picker, not the underlying selection.

The daily pulse uses columns for calendar weeks and rows for Monday–Sunday; its horizontal scroll includes every day in the global date range, including days without commits. Activity details use the selected people, date window, merge/revert policy and reference cohort with no additional filters. Daily metrics include commits, adds/removals, churn, net line change, file touches, distinct paths, binary changes, VERSION touches, merge/revert counts, authored clock range, top-level areas, all changed file paths (expandable), and every matching commit (scroll within the detail card for long days). Zero reference metrics have undefined shares, not 0%. A cell is keyboard focusable; click/tap pins the detail and Escape dismisses it.

Trend views offer trailing four-week windows (default), raw calendar weeks and cumulative values. Rates and shares in rolling/cumulative views are computed from the **sums of their numerators and denominators**, never from averages of percentages; tooltips show the plotted values. Week boundaries are clipped to the selected date window. Shares or per-active-day rates with no valid denominator show **—** or gaps rather than misleading zeros.

## Interpreting metrics

- **Active days** are distinct authored dates *per person*. Adding them across people gives *contributor-days*, which differs from unique team calendar days.
- **Per active day** divides a contributor's measure by their active authored days (and team totals by contributor-days). **Per calendar week** divides by all elapsed days in the selection / 7, including quiet days.
- **File touches** are changed-file entries across commits, **not** unique paths. **Line churn** is added + removed text lines; binary modifications contribute touches but no line counts.
- **VERSION touches** are commits modifying a `VERSION` file, **not** authenticated releases. **Reverts** are counted as events, never subtracted from commit totals. Merge detection uses parents when available, otherwise the subject heuristic.
- A share's denominator is **the same metric** in the selected reference group and time period. The selected group may be a single person, a subset, or everyone.
- Commit sizes and Git activity aren't reliable measures of individual effectiveness, value, or productivity.

## Session import/export

**Export session** saves the input Git log, merged identities and filters (including the chosen trend and monthly/daily pulse preference) into a JSON file. **Import session** restores it in the browser. v1 exports remain accepted.

## Source and tests

- `index.html` — semantic layout and controls.
- `assets/app.css` — bespoke responsive visual style.
- `assets/app.js` — unified state, view rendering, session handling and events.
- `assets/domain.js` — pure parser, filtering, aggregation, scope and date logic.
- `assets/demo-data.js` — deterministic demonstration dataset.
- `tests/` — dependency-free Node checks and regression tests.

Run `npm test` to exercise the core aggregation, scope, parsing, rate and static-contract tests. Run `node --check assets/app.js` for a quick syntax check.
