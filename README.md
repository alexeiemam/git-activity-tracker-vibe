# git:signals — comparable Git activity, from one source of truth

A local, zero-build dashboard to compare one or more Git contributors with the **same selection and denominator in every view**. It runs entirely in your browser; imported logs are not uploaded to a server.

## Run

From this directory, serve the static app with:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` and choose **Explore demo dataset**, or use the generated `git log` command inside a Git repository. Confirm/merge contributor identities, then build the dashboard. Use **Add identities** on a contributor to open a searchable multi-selector, tick as many Git author emails as needed (including identities currently under other names), and **Move identities** to apply the batch. The picker previews affected commits and source groups; you can cancel, press Escape, or undo the most recent move. Splitting identities still works independently. The standard command uses macOS `pbcopy` and GitHub CLI (`gh`); on other systems remove the final pipe and copy the output yourself. All imported records, GitHub Release notes, and session exports remain local to your browser unless you choose to share them.

**Authored, not committed:** The generated command uses `%aI` (author timestamp), `%an` (author name) and `%ae` (author email). It intentionally **does not use `git log --since`**, which prunes using committer dates and can silently omit old-authored commits that were rebased/cherry-picked recently. Instead, it imports all history reachable from the current branch and tags and applies the **Initially show: 1–5 years** lookback *in the browser*, anchored to the most recent imported authored date. The scope's `All imported dates` preset remains available. For very large repositories this can produce substantial output, but avoids biasing the historical comparisons. To include commits reachable only from other branches, use `git log --all` in place of `git log HEAD --tags`; branches not included in the log cannot be analysed. The import also captures `%cI` to support follow-up evidence, without changing the author-time filtering.

**Capture command display and cache safety:** The current `TAG|…` + optional base64-encoded `GHRELEASE|…` + `COMMIT|…` capture command is printed directly inside the **Load repository history** panel and can be selected even if JavaScript fails. The Copy command button copies that exact text. Changing **Initially show** no longer modifies the capture command; it changes the dashboard's initial date filter only. CSS, the application entry point, and its ES-module imports have matching versioned URLs to prevent mixing a newer HTML document with older cached behaviour/Impact assets. When deploying future revisions without a build pipeline, advance the version query token consistently across those imports and `index.html`. If an older deployment appears to lack the new Impact sections, reload the document without cache. The Impact panel now displays a startup or error message rather than an unexplained blank chart.

**Large-history performance:** Git log parsing and full tag-ancestry/impact analysis run in a dedicated browser Web Worker. The top-right progress indicator reports parsing, contributor comparisons, release reconstruction (with a release count), and the stages of rendering; the page remains responsive while CPU-heavy calculations run. Release ancestry uses compact bitsets instead of repeatedly rebuilding large sets, and presentation-only changes reuse the computed evidence rather than rerunning Git analysis. A browser that cannot create module workers falls back to synchronous calculation with a visible progress notice; serving the app over HTTP as shown above is recommended. The dashboard's data never leaves the local browser. Published GitHub Release accounts are automatically matched to the *already-merged* contributors only for unambiguous exact GitHub noreply, email-username or author/name matches; ambiguous cases are clearly marked for review and a manual choice (including explicit exclusion) always takes precedence. These attribution choices are preserved by session export/import.

No build, install, backend, API key, or CDN for the browser application is needed. The optional Google Fonts request can fall back to local fonts offline. The **capture command** calls an authenticated local GitHub CLI when installed; credentials are handled by `gh`, not by git:signals.

## Git + GitHub Impact Explorer: tag-first delivery evidence

**Source of truth:** Git tags are the primary release **code boundaries**. Published GitHub Releases enrich those boundaries with the GitHub publication timestamp, title, publisher account, notes and URL. GitHub's `created_at` is **not** treated as a release date. Missing/draft GitHub Releases leave the Git-only tag evidence intact. `release publisher = assumed driver` is a stated **assumption**, not proof of deployment responsibility. GitHub publishers are automatically linked to existing merged Git author groups when an exact, unambiguous identity is available (GitHub noreply email, unique email username, or exact author/contributor name). Ambiguous or unknown publishers remain unassigned rather than guessed. The **People & releases** view provides a reviewable publisher → contributor matcher; explicit overrides and exclusions persist in exported sessions, by author email, across identity merges.

Neither a merge commit nor a `VERSION` edit is required. VERSION file touches are rendered as
secondary, sometimes spurious signals. The importer now captures *all tag refs*
and commits reachable from `HEAD` **or any tag**, including parent hashes,
author time and committer time. It handles lightweight and annotated tags:

- **Annotated tag:** tagger date is the fallback release-event date if no published GitHub Release exists (not a verified deployment time).
- **Lightweight tag:** Git does not preserve tag-creation time or tagger identity, so in the absence of a published GitHub Release we explicitly label the tagged commit's **committer date as an approximation**.
- **Multiple names at one commit:** collapsed into one release snapshot, with
  alias tags visible on inspection. SemVer-shaped names (including `v8.9.1`)
  classify major/minor/patch/pre-release *transitions*; other tags remain
  available as unclassified release candidates. A SemVer tier is **not** an
  amount of impact. Non-monotonic versions and divergent branches are marked.
- **Membership:** for each tagged commit, compare the commits reachable from it
  against those reachable from its nearest preceding tagged ancestor. This
  works with fast-forward, squash and multi-parent merge history. Release
  publications can occur out of chronological order; Git ancestry takes
  precedence when choosing an earlier code baseline. A squash
  merge only exposes the resulting commit's recorded author; the original
  unreachable commits and unimported co-author trailers cannot be credited. An initial
  lineage tag is a **baseline snapshot**, not an individual release increment.
  If parents are missing (shallow/incomplete import), the UI warns and does not
  claim fully observed follow-up.

Release events displayed use **GitHub published dates when available**, otherwise tagger dates (annotated tags), or tagged-commit committer dates (lightweight tag approximation).
The contributors, dates and merge/revert policy applied to release evidence are
precisely those used by every other visualisation: *commit attribution is by
**author date***. These two clocks are shown explicitly. In particular, a
commit authored months before a release is not reclassified as work authored
on the release date. The initial and available date bounds include imported GitHub publication dates for matched tag names; a release published after the newest authored commit is not silently excluded.

The four connected perspectives are:

1. **Impact Timeline:** tag events, coloured by version transition, plotted by
   release-event date and the selected measure. The lower band separately
   shows **all scoped authored activity (including unreleased work)** and
   distinct VERSION touches. Click or keyboard-activate a tag to inspect its
   introduced commits, files and changes. A selection also updates the release
   dropdown and detail. The timeline and contributor/release matrix share a
   selectable measure: commits, within-reference commit share, line churn,
   distinct paths or top-level codebase areas. Shares have explicit reference
   denominators; paths/areas can overlap between contributors.
   **Timeline navigation:** **All releases** is the default, fitted to the
   entire available timeline; **Latest 18** focuses the time axis on those
   18 tagged releases (not just their markers). Use **+ / −** to zoom,
   **From / To** dates to choose a precise range, and the history navigator
   slider to pan without altering any global filters. The small overview
   indicates the current viewing window across all available history.
   Choosing a release in the dropdown or a comparison table highlights its
   marker and brings it into view, panning the timeline if it lies outside
   the selected range; on narrow displays the timeline scrolls horizontally
   to the selected marker. The current timeline view is saved in session
   exports. Authored-activity bars are reaggregated from daily commits so
   partial-month zooms never show whole-month totals.
2. **People & releases:** consistent contributor-by-release matrix. Only the
   globally selected contributors are rows. Percentages are scoped to the
   globally chosen reference group, not the whole repo unless requested.
   Clicking a cell opens that release's full evidence.
3. **Codebase reach:** contributor × top-level area matrix with absolute file
   touches or *within-person* percentages, heuristic commit categories, same-
   commit test accompaniment and commonly co-changed areas. Uses a **deduplicated
   union of matching commits introduced by displayed tagged releases**, not
   unshipped commits or duplicate credit across branching tags. File co-change
   suggests revisitation patterns, not architectural coupling or influence.
4. **Change evolution:** distinct paths touched by a release revisited in the
   next descendant tagged snapshot, plus 30/90/180-day file revisit cohorts
   where Git has enough subsequent reachable history. The later commits are
   subject to the same authored-date/contributor-reference and merge/revert
   rules. Only fully observed windows receive percentages; `—` means missing
   follow-up, *not* 0%. These are measures of *file revisitation*, **not line
   survival, quality, customer impact or deployed software usage**. Rewrites,
   deletions, renames and long-lived files require deeper Git evidence; exact
   surviving-line counts cannot be derived from numstat and are deliberately
   not invented.

The "Delivery supporting signals" section reports distinct paths, VERSION
edits, explicit reverts, conventional-commit category hints, documentation
file touches and whether commits changing code also changed test files. These
signals are imperfect, particularly when tests are committed separately.

### Import compatibility and repository scope

The generated command uses portable shell syntax (compatible with macOS zsh
and Bash) and resolves the GitHub repository explicitly from `origin`, without
shell `case` patterns. It produces a compact text
stream of `TAG|...` records, optional `GHRELEASE|<base64 UTF-8 JSON>` and
`GHSTATUS|...` records, followed by `COMMIT|...` and Git `--numstat` records.
It attempts `git fetch origin --tags` first, then calls `gh api --paginate`
with `GH_REPO` taken explicitly from the GitHub `origin` remote. Run `gh auth login`
first to access private repositories. Failures to fetch or to reach GitHub leave
locally available tags and commits usable, with source status displayed.
GitHub notes are UTF-8/base64 encoded before being pasted, so arbitrary
newlines and `|` separators cannot corrupt the commit parser. The dashboard
never calls GitHub from JavaScript or requires authentication tokens. It uses `git log HEAD --tags` to cover the current branch and tagged
histories, not every unmerged local branch. To capture other branches, change
that portion to `git log --all ...`; doing so also changes the repository
activity cohort. Remove `| pbcopy` to print output to a terminal or pipe it to
a text file instead. Import and session export run locally in the browser.

Older COMMIT-only logs and v1/v2 session exports still import and retain all
legacy activity visualisations. An old import without TAG records shows a
clear Impact Explorer re-import prompt rather than fabricated releases.
Export/import includes the selected impact tab, release, matrix measure,
area-mode, expanded-tag presentation and timeline window/zoom, plus the
explicit GitHub publisher → contributor mappings and focused impact contributor. **Do not use any of these metrics to
rank employees by productivity.** Git alone cannot measure customer value,
production adoption, review effort or engineering correctness.

### Individual release impact

The **People & releases** tab separates **releases driven** (GitHub publishers
explicitly matched to Git author groups, or annotated tagger email fallback)
from **releases contributed to** (author-date scoped commits introduced by a
release's tagged Git graph boundary). A person may occupy both roles, neither,
or just one. It shows distinct releases, the overlap of both roles, released
commits deduplicated across branches, median per-release commit share and
codebase reach. The release matrix displays driver badges independently of the
numeric metric, so a release driver with zero authored commits still appears.
The release inspector shows publisher identity, publication time, title,
notes, a safe GitHub link, and per-person shipped change evidence.

**Caveats:** Publishing a GitHub Release does not establish who tagged it,
approved or deployed it; bots can publish releases. Annotated-tag email is a
fallback, and lightweight Git tags cannot identify who created them. A release
record without an imported tag cannot establish a code boundary and is shown
as unmatched metadata, not a reconstructed release. Baseline tags include
reachable prior history, not just a release-sized increment. Shares and lead
times always use the existing contributor/date/merge/revert/reference scope.
No combined impact score is calculated.

## Consistent selection model

**Every view** is rendered from one `buildAnalysis(rawCommits, groups, scope)` result in `assets/domain.js`. It applies the following, in this order:

1. **Identity** — reconcile any number of author emails into people using an explicit, searchable batch selector; select all, any subset, or one person (Solo). Moving identities changes only their contributor mapping, not the imported commits. Already-merged source groups lose only the selected emails; empty source groups disappear.
2. **Dates** — inclusive authored dates; all imported history, latest 90/365/730 days, calendar year or custom. Rolling presets anchor to the *latest imported authored commit or tag event*, not the computer's current date. Tag dates extend the available window without changing which commits are attributed by author date.
3. **Commit policy** — include/exclude merge commits and revert commits; excluded commits disappear from every view and from both the selection and the reference.
4. **Metric and presentation** — choose commits, active days, line additions/deletions/churn, file touches, VERSION-file changes, revert or merge commits. Display absolute totals, share of a reference group, per active contributor-day, or per calendar week.
5. **Reference** — entire imported cohort or only the selected people. This changes percentages and repository comparisons, never the selected commit set.

The **ranking, trend and comparison table** use the chosen metric and mode. The **activity pulse** can show that metric as monthly totals or as a daily calendar, always using absolute values and one shared intensity scale across selected people. Daily hovers show the day’s complete filtered commit list, change metrics and share of the selected reference group; click/tap pins a scrollable detail panel. **Working rhythm** includes an individual-focused explorer with a seven-column weekday chart and switchable **7×24 heatmap (default), seven-ring circular clock, and 168-hour continuous bar chart**. All three encodings use identical authored-local **timed commit counts**, not the global change-volume metric, and clearly mark missing authored-hour coverage; changes to global people, dates and merge/revert policy apply to all three. Focus switches only among globally selected contributors (or their combined group), without silently changing other charts. **Change-size footprint** remains a purpose-specific distribution of *the same filtered commits* with a labelled within-person percentage scale; neither view silently changes global filters. **File hotspots** always count file touches in the same selected commits against the chosen reference. **Recent commits** contains only filtered records. Searching a name in the picker only narrows that picker, not the underlying selection.

In the **Rhythm explorer**, select a contributor chip or click **Explore** in the compact comparison. The **Which days?** column chart stays visible while the week view switches between **Grid / Circle / Bars**; these are alternate, not cumulative, representations of exactly the same 168 hour-of-week bins. Hover or keyboard-focus a weekday or hourly cell for counts, within-focus share, unique authored dates, file touches, line additions/deletions, reference share (when the benchmark differs), and a few recent matching commits. Click/tap pins the details; Escape or **Unpin** releases them. Arrow keys move between hour cells, and the weekly bars/grid scroll horizontally on narrow screens. The circular chart is a radial heatmap (Mon innermost ring → Sun outermost, midnight at top), not a misleading 168-wedge pie chart. All weekday/hours counts are restricted to commits with a parsable authored local hour; date-only Git records remain in every other dashboard metric but never get assigned to guessed hour bins. Differences in contributors' authored UTC offsets are not normalised, and these visuals are not measures of hours worked.

### Comparing years and seasonality

Under **The Working Rhythm**, switch between **Weekly patterns**, **Across years**, and **Seasonality** without altering the global contributor/date/merge/revert cohort. The contributor focus picker is shared across all three tabs: inspect any globally selected individual or the combined selection. A separate multi-year chip picker restricts **only the years displayed**, not the eligible commits or reference group. The selected tab, historical measure and visible years survive session export/import.

**Across years** displays a Jan–Dec **Year × Month** heatmap, an annual behavioural scorecard, same-scale **7 × 24** weekly-hour heatmaps for each year, and a contributor × year matrix when several people are selected. The annual scorecard separates commits/week from active calendar-day frequency, commits per active day, weekend share, evening share, and timestamp coverage. Weekday-hour grids always show each cell as a **share of that year's *timed* commits** (same colour scale across years) so a change in annual volume cannot masquerade as a change in rhythm. Clicking or keyboard-focusing a month/hour reveals counts, author dates, changed files/lines, reference-share context, and recent matching commit subjects. **View this month across dashboard** explicitly changes the global date window and updates every other visualisation; merely inspecting or hiding a year never does.

**Seasonality** overlays January–December profiles for each visible year; missing months break the line and partial months have hollow dots. Choose one historical scale for the Year × Month and seasonal charts:

- **Commits/week:** actual commits normalised to seven *observed calendar days*, including zero-activity days. Raw counts remain available on inspection; this is the best volume comparison for unequal month lengths.
- **Within year %:** the percentage of that year's scoped authored commits falling in each observed month. Partial years are flagged; an undefined total is not plotted as zero.
- **Seasonal index:** each month's authored commits/day divided by that year's authored commits/day. A value of **1×** means average for the *observed portion* of the year, not proof of a seasonal effect. Zero-count years have an undefined index.

Annual **year-on-year changes** compare only the calendar-day intersection in adjacent years (e.g. January–October against January–October), with rates computed from their real exposure. An established multi-year mean is shown only where **at least three fully observed years** support it; fewer years are explicitly described as exploratory patterns, not proven seasonality. All coverage is bounded by the earliest/latest *imported author dates*. There is no reliable inference about earlier employment, unimported Git branches or actual working hours. Author-local hour analysis retains the UTC offset recorded on each commit; contributors in different zones are not adjusted to one clock.

The daily pulse uses columns for calendar weeks and rows for Monday–Sunday; its horizontal scroll includes every day in the global date range, including days without commits. Activity details use the selected people, date window, merge/revert policy and reference cohort with no additional filters. Daily metrics include commits, adds/removals, churn, net line change, file touches, distinct paths, binary changes, VERSION touches, merge/revert counts, authored clock range, top-level areas, all changed file paths (expandable), and every matching commit (scroll within the detail card for long days). Zero reference metrics have undefined shares, not 0%. A cell is keyboard focusable; click/tap pins the detail and Escape dismisses it.

Trend views offer trailing four-week windows (default), raw calendar weeks and cumulative values. Rates and shares in rolling/cumulative views are computed from the **sums of their numerators and denominators**, never from averages of percentages; tooltips show the plotted values. Week boundaries are clipped to the selected date window. Shares or per-active-day rates with no valid denominator show **—** or gaps rather than misleading zeros.

### Reading numeric colour intensity

Every value-encoded heatmap now uses the same **zero-aware sequential palette**, independently of the measure being plotted. **Observed zero** is light neutral grey; **any measured positive value** is unmistakably green; increasingly large positive values progress from light green to dark green. Positive shades have a **high-contrast, perceptually spaced light-to-dark range** (OKLab interpolation). They track the **logarithm of the actual ratio** between the smallest and largest positive values in that view's shared comparison group; a 10× change occupies a consistent visual distance regardless of whether it is 1 → 10 or 100 → 1,000. The full contrast range is used only when observed positives vary at least **4×**. When positives differ only slightly (e.g. 10 vs 11), the range is correspondingly compressed rather than making those values falsely look very different. One isolated positive is coloured at the low-positive end, not at the darkest extreme.

Legends explicitly identify zero, the **actual positive minimum and maximum** (with units), and the log-by-value mapping; smaller positives that would round to 0 in a compact label are shown with extra precision. The seven legend swatches are **illustrative points on a continuous scale**, not quantiles, ranks or seven rigid data categories. Heatmap colours are not linear counts, measures of importance, or an implied productivity score.

Within a given visualisation the scale is **shared across all displayed people, periods and releases**; there is no secret per-person normalisation. Where the underlying measure is a percentage or rate, any positive fractional value is still coloured. **Unavailable/undefined** is visibly hatched, never presented as observed zero; year/month cells outside the observation window remain hatched separately. Counts and percentages in hover/details, not the colour, remain authoritative. Categorical colours (contributor identity, release type, change-size bands) and non-colour encoded bars/lines are unaffected.

## Interpreting metrics

- **Active days** are distinct authored dates *per person*. Adding them across people gives *contributor-days*, which differs from unique team calendar days.
- **Per active day** divides a contributor's measure by their active authored days (and team totals by contributor-days). **Per calendar week** divides by all elapsed days in the selection / 7, including quiet days.
- **File touches** are changed-file entries across commits, **not** unique paths. **Line churn** is added + removed text lines; binary modifications contribute touches but no line counts.
- **VERSION touches** are commits modifying a `VERSION` file, **not** authenticated releases. **Reverts** are counted as events, never subtracted from commit totals. Merge detection uses parents when available, otherwise the subject heuristic.
- A share's denominator is **the same metric** in the selected reference group and time period. The selected group may be a single person, a subset, or everyone.
- Commit sizes and Git activity aren't reliable measures of individual effectiveness, value, or productivity.

## Session import/export

**Export session** saves the input Git log, merged identities and filters (including trend, monthly/daily pulse, weekly rhythm presentation, historical tab/mode/year selection, the focused contributor (by identity email), and the Impact Explorer tab, measure, release, timeline range, and footprint presentation) into a JSON file. **Import session** restores it in the browser. v1 exports remain accepted.

## Source and tests

- `index.html` — semantic layout and controls.
- `assets/app.css` — bespoke responsive visual style.
- `assets/app.js` — unified state, view rendering, session handling and events.
- `assets/domain.js` — pure parser, filtering, aggregation, scope and date logic.
- `assets/impact.js` — tag ancestry, release classification and evidence aggregation.
- `assets/impact-view.js` — accessible impact timelines, matrices and detail views.
- `assets/impact-window.js` — pure viewport, zoom, pan and release reveal logic.
- `assets/demo-data.js` — deterministic demonstration dataset.
- `tests/` — dependency-free Node checks and regression tests.

Run `npm test` to exercise the core aggregation, scope, parsing, rate and static-contract tests. Run `node --check assets/app.js` for a quick syntax check.
