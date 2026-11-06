# git:signals — follow the releases, periods and people behind software delivery

A local, zero-build Git evidence explorer with three connected ways into a repository: **the releases, a chosen period, or its contributors**. Tagged snapshots keep their complete code ancestry; authored activity remains a separate observation clock. Imported logs are processed locally in the browser, not uploaded to a service.

## Reordering reconciled identities

In **Review identities**, use the controls on each contributor card to move it
up, down, to the start or to the end of the list. For a contributor with
multiple linked author/provider identities, choose **Arrange linked identities**
to change their display order using accessible Up/Down controls. Both actions
are non-destructive: they do not change the Git author mapping or any release
attribution. Click **Build dashboard** to apply the new contributor order.

The chosen order is preserved in both `.json.gz` and legacy JSON session
exports, and restores on import. Contributor colours are derived from the
reconciled identity set so moving a card or rearranging its linked identities
does not change that person's colour. Existing contributor selections and
focused views are reconciled by identity when the cards move.

## Run

From this directory, serve the static app with:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` and choose **Explore demo dataset**, or use the generated `git log` command inside a Git repository. Confirm/merge contributor identities, then build the dashboard. GitHub publishers and Heroku release actors also appear as independently mergeable identities (marked by source); they can be matched with Git authors without fabricating authored commits. Use **Add identities** on a contributor to open a searchable multi-selector, tick as many Git author or provider identities as needed (including identities currently under other names), and **Move identities** to apply the batch. The picker previews affected commits and source groups; you can cancel, press Escape, or undo the most recent move. Splitting identities still works independently. The standard command uses macOS `pbcopy` and GitHub CLI (`gh`); on other systems remove the final pipe and copy the output yourself. All imported records, GitHub Release notes, and session exports remain local to your browser unless you choose to share them.

**Authored, not committed:** The generated command uses `%aI` (author timestamp), `%an` (author name) and `%ae` (author email). It intentionally **does not use `git log --since`**, which prunes using committer dates and can silently omit old-authored commits that were rebased/cherry-picked recently. Instead, it imports all history reachable from the current branch and tags and applies the **Initially show: 1–5 years** lookback *in the browser*, anchored to the most recent imported authored date. The scope's `All imported dates` preset remains available. For very large repositories this can produce substantial output, but avoids biasing the historical comparisons. To include commits reachable only from other branches, use `git log --all` in place of `git log HEAD --tags`; branches not included in the log cannot be analysed. The import also captures `%cI` to support follow-up evidence, without changing the author-time filtering.

**Capture command display and cache safety:** The current `TAG|…` + optional base64-encoded `GHRELEASE|…` + `COMMIT|…` capture command is printed directly inside the **Load repository history** panel and can be selected even if JavaScript fails. The Copy command button copies that exact text. Changing **Initially show** no longer modifies the capture command; it changes the dashboard's initial date filter only. CSS, the application entry point, and its ES-module imports have matching versioned URLs to prevent mixing a newer HTML document with older cached behaviour/Impact assets. When deploying future revisions without a build pipeline, advance the version query token consistently across those imports and `index.html`. If an older deployment appears to lack the new Impact sections, reload the document without cache. The Impact panel now displays a startup or error message rather than an unexplained blank chart.

**Large-history performance:** Git log parsing and full tag-ancestry/impact analysis run in a dedicated browser Web Worker. The top-right progress indicator reports parsing, contributor comparisons, release reconstruction (with a release count), and the stages of rendering; the page remains responsive while CPU-heavy calculations run. Release ancestry uses compact bitsets instead of repeatedly rebuilding large sets, and presentation-only changes reuse the computed evidence rather than rerunning Git analysis. A browser that cannot create module workers falls back to synchronous calculation with a visible progress notice; serving the app over HTTP as shown above is recommended. The dashboard's data never leaves the local browser. GitHub publisher and Heroku actor accounts appear as mergeable identities alongside Git author emails. Unique, well-supported matches are suggested automatically; ambiguous actors remain separate, manual merging takes precedence, and no provider account is counted as a Git author without an actual authored commit. Reopen the identity editor with **Review identities** on the dashboard. Legacy GitHub publisher overrides remain respected. These attribution choices are preserved by session export/import.

No build, install, backend, API key, or CDN for the browser application is needed. The optional Google Fonts request can fall back to local fonts offline. The **capture command** calls an authenticated local GitHub CLI when installed; credentials are handled by `gh`, not by git:signals.

## Three first-class perspectives

After importing history and confirming merged author identities, the app opens
**Observatory**, not the earlier standalone Stories experience. Use the main
navigation to switch perspectives without reimporting data:

- **Observatory — start with releases.** A release landscape shows aligned
  calendar-bucket lanes for release counts, contributor appearances and codebase
  area occurrences. Empty buckets remain visible, so quiet delivery periods
  cannot disappear. Browse **all tagged releases**, search by tag, filter by
  year and SemVer transition, or inspect release cohorts (patch/minor/major).
  Compare release cohorts by **SemVer transition, matched release driver or calendar year**. Select any release to open its **Release Anatomy**: complete Git-ancestry
  incremental commits, recorded contributors and their commit shares, the
  matched publisher/driver, changed code areas, commit-subject categories,
  GitHub publication details and notes, and the underlying hashes. The initial
  baseline tag is labelled non-incremental; releases with missing ancestry
  warn that their evidence may be incomplete. "Drove release" is a distinct
  GitHub publisher/tagger role, not a claim about who authored its code.
- **Periods — start with time.** Choose **7, 14, 30, 90 days, or any custom
  inclusive interval**. Switch between an immediately preceding equal-duration
  window, the same calendar period last year, a custom baseline or no
  comparison. The **period unfolding** timeline aligns authored commits,
  distinct contributors and tagged-release events at daily, weekly or monthly
  resolution. Select a time bucket to examine the exact recorded commits and
  releases. A zero-aware **contributor × top-level code area** matrix reveals
  who touched what; select a cell to inspect its commits, or follow a person,
  area or release. Short, supported period observations explain actual
  differences and explicitly flag incomplete comparison coverage. GitHub
  release notes provide *recorded* purpose, not invented motivation. Copy a
  traceable **Period Briefing** including scope, activity, released events,
  components, comparison and limitations.
- **Contributors — start with a person.** Select any **reconciled** contributor
  (all their merged author emails), then explore their **Delivery / Together / Focus /
  Behaviour / Evolution / Compare** views. The release portfolio distinguishes
  tagged releases they authored for, releases they drove, and both; rates use
  the same release-event population across compared people. **Together** shows
  which contributors authored changes in the same incremental tagged releases:
  shared release counts, the proportion of each person's release portfolio
  shared with the other, and symmetric Jaccard overlap (shared ÷ union).
  Choose a partner to inspect the actual shared tags, authorship counts and
  separately attributed release drivers; Compare also shows pairwise overlap
  for the selected people. Initial baseline and incomplete-ancestry tags are
  excluded from these overlap denominators, and co-participation does **not**
  establish direct collaboration. Focus shows where
  their authored files changed. Behaviour shows author-local 7×24 rhythms,
  internal active-day gaps and sample counts. Evolution displays separate
  monthly lanes for authorship, participation and release driving, and annual
  summaries. Compare two or three people over the *same* imported-history,
  365-day or selected period window, using measured values and separately
  normalised rhythm grids—not a composite productivity score.

**Follow the contribution.** A release, contributor, area or period is
selectable from the relevant views. The application preserves an investigation
trail in native browser Back/Forward history, with compact per-view URLs and keeps the selected period as context when
following a contributor or code area. **Codebase** is a contextual fourth
view, showing released areas, the contributors who touched them and related
release snapshots. The existing deep **Detailed analytical workbench** remains
available on demand, including the daily/monthly Activity Pulse, weekly
rhythm clock/grid/bars, annual seasonality, old impact matrices and recent
commit tables. It renders lazily rather than blocking the Observatory.

### Two explicit clocks, no silent truncation

A tagged release is defined by its **exact Git ancestry** (and the declared
merge/revert inclusion policy). It is not redefined when an individual opens a
fortnight or a contributor portrait. Release *events* are selected by GitHub
published date when available, otherwise annotated-tag date or a labelled
lightweight-tag approximation. An authored-period view selects commits by
**author timestamp**, including their original author-local hour; the same
period can independently contain releases whose introduced commits were
written much earlier. Personal focus changes the highlighted authorship,
not the complete contents or denominator of a release. Within the Detailed
analytical workbench the legacy author-date scope can deliberately narrow
release analytics; the UI labels that narrower perspective explicitly.

**Interpretation limits:** Git shows recorded contributions and reachable
release history—not hours worked, performance, business value, collaboration
outside Git, unpublished branches or reliable authored-to-shipped conversion.
Shared file touches do not establish ownership. Gaps are gaps in *matching
imported authorship*, not absences from work. No AI-generated statements or
unverified claims of intent are presented as facts.

**Implementation:** `assets/perspectives.js` builds the reusable, compact
release-first evidence index in `assets/analysis-worker.js` independently of
workbench author-date scope. `assets/perspective-view.js` renders the three
views and Codebase drill-down; `assets/perspective-state.js` restores bounded
navigation and durable contributor identity selections across session exports.
`assets/stories.js` and `assets/story-view.js` remain in the codebase for
compatibility with existing tests, but Stories is no longer the primary UX.
The app remains dependency-free and local-first.

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

## Detailed workbench: consistent authored-date selection

Within the **Detailed analytical workbench**, each chart is rendered from one shared `buildAnalysis(rawCommits, groups, scope)` result in `assets/domain.js`. Its author-date/selection rules are distinct from the primary complete-release Observatory, which preserves full tagged contents. The workbench applies the following, in this order:

1. **Identity** — reconcile any number of author emails into people using an explicit, searchable batch selector; select all, any subset, or one person (Solo). Moving identities changes only their contributor mapping, not the imported commits. Already-merged source groups lose only the selected emails; empty source groups disappear.
2. **Dates** — inclusive authored dates; all imported history, latest 90/365/730 days, calendar year or custom. Rolling presets anchor to the *latest imported authored commit or tag event*, not the computer's current date. Tag dates extend the available window without changing which commits are attributed by author date.
3. **Commit policy** — include/exclude merge commits and revert commits; excluded commits disappear from every view and from both the selection and the reference.
4. **Metric and presentation** — choose commits, active days, line additions/deletions/churn, file touches, VERSION-file changes, revert or merge commits. Display absolute totals, share of a reference group, per active contributor-day, or per calendar week.
5. **Reference** — entire imported cohort or only the selected people. This changes percentages and repository comparisons, never the selected commit set.

The **ranking, trend and comparison table** use the chosen metric and mode. The **activity pulse** can show that metric as monthly totals or as a daily calendar, always using absolute values and one shared intensity scale across selected people. Daily hovers show the day’s complete filtered commit list, change metrics and share of the selected reference group; click/tap pins a scrollable detail panel. **Working rhythm** includes an individual-focused explorer with a seven-column weekday chart and switchable **7×24 heatmap (default), seven-ring circular clock, and 168-hour continuous bar chart**. All three encodings use identical authored-local **timed commit counts**, not the global change-volume metric, and clearly mark missing authored-hour coverage; changes to global people, dates and merge/revert policy apply to all three. Focus switches only among globally selected contributors (or their combined group), without silently changing other charts. **Change-size footprint** remains a purpose-specific distribution of *the same filtered commits* with a labelled within-person percentage scale; neither view silently changes global filters. **File hotspots** always count file touches in the same selected commits against the chosen reference. **Recent commits** contains only filtered records. Searching a name in the picker only narrows that picker, not the underlying selection.

### Release gap × authored activity (Pulse)

The **activity pulse** offers four complementary lenses: **Authored activity**
(the existing raw totals, still the default), **Release gap × activity** (a warm,
0–100 attention signal), and **Contribution momentum** (a diverging, signed
trend against the same contributor's recent history), plus **Contribution
level** (an uncapped, log-scaled index that exposes sustained differences
between selected contributors). Each supports individual
**Daily / Monthly** cells without changing the globally filtered commit policy.

The release-gap factor is no longer a binary "last release resets everything"
clock: **the contributor's absolute authored text-line changes in each
incremental tagged release provide a partial or full reset.** Count additions
**plus** deletions for that contributor in the newly introduced ancestry of
the tag; do not use their percentage of a release's total changes. For the
credit calculation, `VERSION` marker files are excluded. Docs, tests, code and
other text-file changes count, subject to the usual merge/revert policy.
Binary changes and missing numstat counts cannot provide measurable credit.

Default reference points (all adjustable):

```
full release credit threshold = 200 changed text lines (choose 50/100/200/500)
full release-gap horizon     = 60 calendar days (choose 30/60/90)
busy authored day            = 4 commits (choose 2/4/6)
busy authored line churn     = 200 changed lines/day (choose 50/100/200/500)
active clock period          = 90 minutes (choose 60/90/120)
full per-period churn credit = 50 changed lines (choose 25/50/100)
meaningful workday threshold = 20 changed lines (choose 10/20/50)

release credit     = min(contributor's changed release lines / 200, 1)
aged gap           = min(1, gap after last release + days elapsed / 60)
gap on release day = aged gap * (1 - release credit)
quiet commits      = max(1 - that day's authored commits / 4, 0)
quiet churn        = max(1 - non-VERSION line changes authored today / 200, 0)
distributed credit = authored-clock span factor * capped churn in periods beyond the largest
combined signal    = 100 * current weighted gap * quiet commits * quiet churn
                   * (1 - 0.15 * distributed credit)
```

Thus 20 changed lines soften an accumulated gap by 10%, 100 by 50%, and 200+
fully reset it. Two small releases can compound their reductions. Critically,
**age is capped before applying credit**, so even a tiny release after a very
long gap always makes an immediate, visible difference. Between releases the
remaining gap increases by one horizon-day per calendar day, up to 100%.
Daily authored commit activity **and** non-VERSION text churn independently
soften the score. Four commits or 200 changed lines in a day fully neutralise
its quiet-day factor, even if the weighted release gap is long. This daily
churn is distinct from the **release-included** churn that earns clock credit;
commits not yet shipped can still demonstrate active work. VERSION markers
never earn daily churn relief, but their commits remain in the authored-commit
count (the same policy used by the original Pulse). Churn-weighted **time
distribution** may reduce the remaining score by **at most 15%** and never
resets release credit. Missing or non-comparable timestamps earn no additional
relief; they cannot erase the day's regular commit/churn evidence.

No score is shown before a contributor's **first measurable authored release
contribution**. When the first such release occurs, any earlier unknown gap is
conservatively treated as fully elapsed *before its credit is applied*; a small
first contribution therefore yields a nonzero gap, while a substantial one
starts at zero. This is an observational convention, **not** an inferred
historical absence of work. Publishing/tagging alone, a baseline tag, a
VERSION-only change, or a release with no measurable text-line changes
does not establish credit or reset the gap. Incomplete tag ancestry and
unavailable line statistics limit confidence.

Daily cells expose the actual calendar days since the latest credited tag,
its absolute authored additions/deletions, reset-credit percentage, **effective
weighted gap days** (which need not equal literal days since the last tag),
daily commits, non-VERSION churn and combined signal. The individual summary reports the latest
credited release and line count, literal and effective gaps, mean score and
number of weekdays at **50+**. Hover details also show the authored-clock
span, active time periods, churn-weighted distribution and incremental relief.
Monthly cells contain the arithmetic mean of
**eligible weekday daily scores**, not a snapshot of month-end gap. Days
outside imported history, weekends and days without a prior measurable
release contribution are unscored (hatched), not zero. Filtering the visible
authored dates does not erase release credits: releases always come from the
full imported, policy-filtered release index. The release and shared temporal settings, lens and granularity persist across
session export/import; older sessions restore missing settings to their
documented defaults.

### Absolute velocity: fixed-scale recorded contribution (Pulse)

**Absolute velocity** is the fourth Pulse lens. It shows how much activity was
*recorded* per calendar day on an absolute, consistent index rather than a
ratio to peers or a change relative to the contributor's own previous period.
It replaces the oversized horizontal peer-distribution bars. **Momentum**
continues to measure the change between a person's own two preceding windows,
which may correctly remain near zero for a consistently active contributor.

The index itself is the previously established uncapped Contribution Level
formula. Its fixed colour thresholds, not the score, are the new behaviour:

```
V(day) = 0.25 * ln(1 + authored_commits) / ln(5)
       + 0.45 * ln(1 + non_VERSION_changed_lines) / ln(201)
       + 0.20 * ln(1 + authored_lines_in_incremental_releases) / ln(201)
       + 0.10 * churn_weighted_distribution
```

The reference inputs (4 commits, 200 changed lines, 200 release-included lines,
full distributed activity) produce a composite index of **1.0**; this is a
unit-calibration example, **not a quota or performance target**. Values above
1.0 remain uncapped and retain diminishing logarithmic returns. Lines can be
inflated by generated changes or rework and do not establish delivery quality.

- **Daily cells:** numeric index directly in each cell; the colour at 0.5,
  1.0 or 2.0 is identical for every contributor, date range and selection.
  One substantial commit retains its ordinary churn credit even without
  measurable activity spread. Weekends with authored activity are included.
- **Monthly cells:** average daily index over *covered calendar days*,
  including zero-activity days. Numeric value printed in each wider cell;
  partial months use only covered dates.
- **Fixed legend:** reference marks 0, 0.25, 0.5, 1, 1.5, 2 and 3+;
  exact scores above 3 are still shown, not capped.
- **Recent velocity table:** selected-period mean plus separate trailing
  5/10/20-workday pace with authored commits, non-VERSION churn,
  release-included line changes and consistency as transparent evidence.
- **Unavailable vs quiet:** unobserved history stays hatched and displays
  `—`; genuinely covered dates with no evidence show 0.

The horizontal peer bars, median reference line and leader highlighting have
been removed. Directional Momentum may still show a neutral peer reference in
its optional summary; its calculation has not changed. Absolute velocity is
an observable Git-change index, **not hours worked, quality or productivity**.

### Compare every dimension: incremental tagged releases

The contributor scorecard now distinguishes actual **tag-ancestry release
participation** from VERSION-file edits. It shows the count of incremental
canonical tagged releases containing the contributor's authored commits,
introduced authored commits in those releases, and authored non-VERSION
changed text lines introduced in those releases. An independent count of
GitHub publisher / annotated-tag actor events is metadata only; it does not
claim authored contribution or deployment. VERSION touches remain, explicitly
labelled as a weaker supporting proxy.

Release columns use the **release-event date** (GitHub publication date if
available, otherwise tag/tagged-commit date) and full reconstructed ancestry;
ordinary contributor columns use **authored dates**. Both respect the same
merge/revert policy, but a released commit may have been authored outside the
selected period. The baseline tag is not an incremental delivery event.
Aliases resolving to one commit count as one release. Incomplete ancestry is
flagged in the table footnote; missing tag evidence displays `—`, not zero.
Binary changes cannot add measurable lines, and the release count may include
re-introductions of changes on divergent Git lineages. All new columns support
sorting and the **Copy visible table as CSV** action.

### Activity spread, churn-weighted windows and consistency (all Pulse lenses)

**Activity Spread** records the time between a contributor's earliest and
latest timestamped commit *on the same authored-local date*, and how many
distinct active time periods have commits. It is **clock range, not hours
worked**. One timed commit cannot establish a span and is displayed as
**unmeasurable**; missing hours or minutes are explicitly identified. If Git
records different timezone offsets on the same authored date, the span and
distribution credit are suppressed as non-comparable, while commit counts and
churn remain available.

**Churn-weighted active periods** refine spread. Divide each day into fixed
90-minute intervals (adjustable to 60 or 120). For each period, cap credited
non-VERSION text churn at 50 changed lines (adjustable 25/50/100). Rather than
just multiplying raw `span × churn` or `commits × churn`, distribute credit:

```
span factor        = min(author-local first-to-last minutes / 360, 1)
period count factor= min(max(distinct timed periods - 1, 0) / 3, 1)
raw spread         = span factor * period count factor
period credit[b]   = min(changed non-VERSION lines in period b / 50, 1)
extra credit       = sum(period credit) - largest period credit
distribution       = raw spread * min(extra credit / 3, 1)
```

`distribution` is in 0–1 where measurable. It only becomes large when **multiple
separated time periods** contain substantial recorded changes. One huge commit
followed by one token change earns almost no distribution bonus; two tiny
commits many hours apart do not imply a sustained workday. Unknown clocks
mean **unmeasurable distribution**, not zero activity. The Activity Pulse now
shows a small time-window ribbon, its period-by-period churn intensity, raw
clock span, active periods, capped churn-period units and time coverage in
daily details. A separate summary reports measured multi-commit-day spans,
meaningful-day consistency and distributed-day incidence, using only covered
weekdays. Monthly Activity cells retain their original absolute-count colours;
the summary and month hover provide the temporal context instead of silently
changing the established metric.

**Activity Consistency** is the share of covered workdays with at least 20
non-VERSION changed lines (adjustable 10/20/50), irrespective of timestamp
availability. A *distributed day* additionally has measurable distribution of
at least 0.04 using the above rule. Both appear in the summaries and the two
rolling Momentum windows. The 0.04 cut-off is a conservative descriptive
classification, **not** a cut-off for acceptable work. Holidays, leave and
unobserved non-Git work are not accounted for; no ranking or individual
performance inference is intended.

The expandable **Temporal evidence** control applies the same period length,
per-period line cap and meaningful-day definition to all four lenses. The
controls persist in session archives and default safely for older sessions.
Recalculation uses the complete scoped, policy-filtered evidence and caches
per-contributor day fingerprints rather than reparsing Git history on every
selection.

### Contribution momentum (Pulse)

**Contribution momentum** describes the *direction of observable contribution*,
not the amount, the release gap, or a contributor ranking. The Momentum summary
now also provides **recent Contribution Level and peer reference** so a
persistently high contributor does not disappear behind a steady directional
score. Its fixed, bounded
workday evidence mix balances quantity, distribution and delivery without
multiplying raw commit count by elapsed clock time:

```
daily units = 0.25 * min(authored commits / 4, 1)
            + 0.45 * min(non-VERSION authored changed lines / 200, 1)
            + 0.15 * churn-weighted time distribution
            + 0.15 * min(authored changes in tagged releases / 200, 1)

consistency = workdays with >=20 non-VERSION changed lines / N workdays
pace        = 0.75 * mean daily units + 0.25 * consistency

recent pace   = pace over the most recent N workdays (including this day)
previous pace = pace over the immediately preceding N workdays
momentum      = 100 * (recent pace - previous pace) /
                      (recent pace + previous pace + 0.1)
```

Meaningful-day **consistency contributes 25%** of the window comparison,
stronger than the 15% *daily* distribution component. This means someone
maintaining substantive activity on many separate workdays can develop
momentum even if each day has only one commit. Churn and release lines count
independently of recorded timestamps; a single large commit is **not**
misclassified as a zero-output day. Substantive activity is a Git-recorded
threshold, not an assertion about work on days below it.

The default compares **10 vs 10 workdays**; choose **5 / 10 / 20** for each
window. The **0.1 smoothing term** prevents tiny changes around zero from
producing an exaggerated score. Scores run from −100 to +100; **positive**
means more recorded throughput than the preceding period (building), **negative**
means less (cooling), and near zero means little change. The descriptive labels
use a ±15-point threshold. Zero may also mean *no observed contribution in
either window*, which is explicitly called out rather than presented as a
positive judgement.

Tagged-release credit uses incremental ancestry and the contributor's own
additions plus deletions, excluding baselines, driver-only events and VERSION
markers. A weekend tag is credited on the following workday for this lens;
weekday authored activity is unchanged. **No release tag is necessary** to
observe activity momentum: commits and lines still count. These weighting
constants are fixed across contributors; the adjustable gap/churn thresholds in
the *other* lens do not silently change this one.

A day is scored only with **2N complete, in-coverage weekdays** in the full
imported history. Narrowing the displayed date filter does not erase either
comparison period. Weekends, outside-history days and incomplete warm-up
periods are hatched as *unscored*. Monthly cells average the **signed daily
scores**, so a month with building and cooling phases may average near zero;
hover text reports both counts. Daily hover/focus/click evidence includes both
windows' commits, churn, shipped lines, normalised units and that day's Git
activity. The per-person summary shows the latest directional reading, average,
building/cooling day counts, and the number of comparable weekdays.

Neither metric is a performance appraisal. Rework, pairing, reviews, non-Git
work, vacations, squashes, binary files and generated-file churn affect what
these numbers can and cannot reveal. Momentum, window size, and daily churn
settings persist in exported sessions; old sessions default to Authored activity
and the new thresholds.

This is **not a measure of productivity, performance or delivery value**.
Large generated-file diffs can inflate raw churn; reviews, pairing, planning,
binary file work, squash attribution, leave and untracked contributions are
not represented. A high signal is an invitation to inspect evidence, never a
ranking or conclusion about an individual.

In the **Rhythm explorer**, select a contributor chip or click **Explore** in the compact comparison. The **Which days?** column chart stays visible while the week view switches between **Grid / Circle / Bars**; these are alternate, not cumulative, representations of exactly the same 168 hour-of-week bins. Hover or keyboard-focus a weekday or hourly cell for counts, within-focus share, unique authored dates, file touches, line additions/deletions, reference share (when the benchmark differs), and a few recent matching commits. Click/tap pins the details; Escape or **Unpin** releases them. Arrow keys move between hour cells, and the weekly bars/grid scroll horizontally on narrow screens. The circular chart is a radial heatmap (Mon innermost ring → Sun outermost, midnight at top), not a misleading 168-wedge pie chart. All weekday/hours counts are restricted to commits with a parsable authored local hour; date-only Git records remain in every other dashboard metric but never get assigned to guessed hour bins. Differences in contributors' authored UTC offsets are not normalised, and these visuals are not measures of hours worked.

### Comparing years and seasonality

Under **The Working Rhythm**, switch between **Weekly patterns**, **Across years**, and **Seasonality** without altering the global contributor/date/merge/revert cohort. The contributor focus picker is shared across all three tabs: inspect any globally selected individual or the combined selection. A separate multi-year chip picker restricts **only the years displayed**, not the eligible commits or reference group. The selected tab, historical measure and visible years survive session export/import.

**Across years** displays a Jan–Dec **Year × Month** heatmap, an annual behavioural scorecard, same-scale **7 × 24** weekly-hour heatmaps for each year, and a contributor × year matrix when several people are selected. The annual scorecard separates commits/week from active calendar-day frequency, commits per active day, weekend share, evening share, and timestamp coverage. Weekday-hour grids always show each cell as a **share of that year's *timed* commits** (same colour scale across years) so a change in annual volume cannot masquerade as a change in rhythm. Clicking or keyboard-focusing a month/hour reveals counts, author dates, changed files/lines, reference-share context, and recent matching commit subjects. **View this month across dashboard** explicitly changes the global date window and updates every other visualisation; merely inspecting or hiding a year never does.

**Seasonality** overlays January–December profiles for each visible year; missing months break the line and partial months have hollow dots. Choose one historical scale for the Year × Month and seasonal charts:

- **Commits/week:** actual commits normalised to seven *observed calendar days*, including zero-activity days. Raw counts remain available on inspection; this is the best volume comparison for unequal month lengths.
- **Within year %:** the percentage of that year's scoped authored commits falling in each observed month. Partial years are flagged; an undefined total is not plotted as zero.
- **Seasonal index:** each month's authored commits/day divided by that year's authored commits/day. A value of **1×** means average for the *observed portion* of the year, not proof of a seasonal effect. Zero-count years have an undefined index.

Annual **year-on-year changes** compare only the calendar-day intersection in adjacent years (e.g. January–October against January–October), with rates computed from their real exposure. An established multi-year mean is shown only where **at least three fully observed years** support it; fewer years are explicitly described as exploratory patterns, not proven seasonality. All coverage is bounded by the earliest/latest *imported author dates*. There is no reliable inference about earlier employment, unimported Git branches or actual working hours. Author-local hour analysis retains the UTC offset recorded on each commit; contributors in different zones are not adjusted to one clock.

The daily pulse uses columns for calendar weeks and rows for Monday–Sunday; its horizontal scroll includes every day in the global date range, including days without commits. Activity details use the selected people, date window, merge/revert policy and reference cohort with no additional filters. Daily metrics include commits, adds/removals, churn, net line change, file touches, distinct paths, binary changes, VERSION touches, merge/revert counts, authored clock range, temporal spread and churn-weighted periods, top-level areas, all changed file paths (expandable), and every matching commit (scroll within the detail card for long days). Zero reference metrics have undefined shares, not 0%. A cell is keyboard focusable; click/tap pins the detail and Escape dismisses it.

Trend views offer trailing four-week windows (default), raw calendar weeks and cumulative values. Rates and shares in rolling/cumulative views are computed from the **sums of their numerators and denominators**, never from averages of percentages; tooltips show the plotted values. Week boundaries are clipped to the selected date window. Shares or per-active-day rates with no valid denominator show **—** or gaps rather than misleading zeros.

### Reading numeric colour intensity

Every value-encoded activity heatmap uses the same **zero-aware sequential palette**, independently of the measure being plotted. The dedicated **release gap × activity** overlay is the documented exception: it has a fixed 0–100 warm scale, because a high combined attention signal must not be confused with high activity. **Observed zero** is light neutral grey; **any measured positive value** is unmistakably green; increasingly large positive values progress from light green to dark green. Positive shades have a **high-contrast, perceptually spaced light-to-dark range** (OKLab interpolation). They track the **logarithm of the actual ratio** between the smallest and largest positive values in that view's shared comparison group; a 10× change occupies a consistent visual distance regardless of whether it is 1 → 10 or 100 → 1,000. The full contrast range is used only when observed positives vary at least **4×**. When positives differ only slightly (e.g. 10 vs 11), the range is correspondingly compressed rather than making those values falsely look very different. One isolated positive is coloured at the low-positive end, not at the darkest extreme.

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

**Export session** now downloads a lossless, gzip-compressed file named
`git-signals-session-YYYY-MM-DD_HH-mm-ss.json.gz`, using your browser's local
clock. The compact JSON payload preserves the full Git, GitHub and Heroku
capture, merged identities, selections, filters, navigation state and all
other session settings; it is merely compressed, not abbreviated. Session
compression and decompression run in the existing Web Worker when available,
with visible progress. Nothing is uploaded to a server.

**Import session** accepts both the new `.json.gz` archives and all existing
`.json` exports, including legacy session schema versions. It identifies gzip
by the file contents, validates decompressed JSON and restores it through the
same existing import path. Malformed or truncated archives display an error,
with a 1 GiB decompressed-size safety limit. Native browser gzip streams
are used, with no third-party library. On a browser without gzip compression,
export falls back to the original `.json` format; a browser without gzip
*decompression* can still import legacy JSON, or a `.json.gz` file can first
be unpacked with `gunzip -k session.json.gz` and the resulting JSON imported.
You can also unpack exported archives with `gunzip` or `gzip -d` outside the app.

**Export all · CSV** for People & Releases remains plain CSV, named
`git-signals-release-matrix-YYYY-MM-DD_HH-mm-ss.csv`. Its format is unchanged.
Export filenames remain short, descriptive and never contain imported Git text,
release notes, identities or other user content.

## Source and tests

- `index.html` — semantic layout and controls.
- `assets/app.css` — bespoke responsive visual style.
- `assets/app.js` — unified state, view rendering, session handling and events.
- `assets/domain.js` — pure parser, filtering, aggregation, scope and date logic.
- `assets/impact.js` — tag ancestry, release classification and evidence aggregation.
- `assets/impact-view.js` — accessible impact timelines, matrices and detail views.
- `assets/release-gap.js` — pure individual absolute-line-weighted release credit × authored-day metric, bounded temporal relief, monthly aggregation and coverage rules.
- `assets/temporal-activity.js` — shared, cached pure authored-clock spread, distinct windows, churn-weighted distribution and consistency summaries.
- `assets/momentum.js` — bounded, self-relative contribution direction with rolling meaningful-day consistency.
- `assets/contribution-level.js` — uncapped logarithmic recorded-contribution index and recent-window references.
- `assets/absolute-velocity.js` — immutable cohort-independent index palette, numeric cell labels and fixed legend.
- `assets/release-scorecard.js` — pure per-contributor canonical tagged-release participation and release-date totals.
- `assets/impact-window.js` — pure viewport, zoom, pan and release reveal logic.
- `assets/co-release.js` — complete-release co-participation and evidence by pair.
- `assets/download-names.js` — bounded descriptive export filenames with local timestamps.
- `assets/session-archive.js` — browser-native gzip session archive export/import with legacy JSON compatibility.
- `assets/demo-data.js` — deterministic demonstration dataset.
- `tests/` — dependency-free Node checks and regression tests.

Run `npm test` to exercise the core aggregation, scope, parsing, rate and static-contract tests. Run `node --check assets/app.js` for a quick syntax check.

### Exploring all tagged releases in People & Releases

The contributor-by-release matrix **browses the complete globally scoped release history** by default, 18 columns at a time (choose 36 or 54 if useful). Use **Older/Newer** or **Oldest/Latest** to navigate, filter its displayed columns by release year, or **Jump to release** for any tag. **Latest 18** is now a quick view, not a hard limit. An **Export all · CSV** action includes every release/contributor pair in the current global scope, irrespective of matrix page, year or quick view. Matrix navigation does not modify global contributor/date/merge/revert filters. Its value-to-colour scale is calculated across *all* globally scoped releases, so colours remain comparable when browsing pages. The matrix is windowed to avoid rendering hundreds of columns simultaneously.


## Heroku deployment evidence (optional)

The **Copy command** captures **up to 3,000 Heroku release records per environment** from Git remotes `STAG`, `BETA`, and `PROD`. It reads the newest 1,000 using the authenticated Heroku CLI (`heroku releases --json --num 1000 -r REMOTE`); when necessary, a small bounded Python helper uses the authenticated Heroku Platform API to retrieve at most **two more 1,000-record pages** by release version. The API limits an individual page to 1,000: simply passing `--num 3000` would not guarantee historical coverage. A functioning Python 3 and `heroku auth:token` are needed for pages two and three. If pagination fails, the first page remains usable and the import is explicitly marked `partial`; an exact 3,000-record capture is also treated as potentially truncated. STAG and BETA are interchangeable QA environments; no assumed promotion chain exists. Missing remotes, CLI authentication errors, and incomplete histories do not prevent Git-only analysis. Release output is captured locally in the clipboard, then parsed in the existing Web Worker. **No config variable values are requested.** In the Python capture path, config-variable names are also removed from descriptions before importing.

The primary Observatory now introduces **Published versus production** with a plain-language description of tag/release publication versus real Heroku events, separate code/config lanes, a status glossary, linked GitHub release versions and Heroku event numbers, and actor/contributor links. **First observed snapshot** means code was present *by* a recorded date; **code change** means a resolvable revision change; **unknown** means SHA or ancestry coverage is insufficient. Clicking any linked tag or Heroku v-number opens its evidence.

The primary Observatory shows aligned published-versus-deployed lanes and PROD events. Each Release Anatomy shows first observed STAG/BETA/PROD inclusion of its tag's commit ancestry. The Period Explorer separates Heroku events from author-date commits and published-release dates; the Contributor Portrait shows new code observed in PROD, attributed to reconciled Git authors. **Deployment history** is an additional contextual view with a filterable, paged event browser, deployment anatomy, new contributor/area footprints, and partial-history disclaimers. The period briefing includes deployment events too.

`Deploy <sha>` records or explicit SHA fields are resolved against imported Git hashes. The importer also identifies Heroku descriptions such as `Set ASK_AI_CONFIGURATION_ACTIVATIONS_ENABLED config vars`, `Unset ... config vars` and `Config ...` as **configuration events**. Only the action (Set/Unset/Update config vars) is kept in the analysed record; individual variable names are redacted. A Heroku event actor email becomes a distinct identity if it cannot be reconciled with an existing contributor; editing those mappings never changes the authorship of Git commits. A configuration-described Heroku release can inherit its last observed code SHA *as an inference*. A same-SHA event isn't called a config update without a description. Rollbacks using a historical Heroku version are resolved only when that version and its SHA were observed. A missing or ambiguous SHA remains unresolved; no change delta or attribution is fabricated. First imported code snapshots establish **presence by** a date, never the exact first production date; subsequently introduced code requires complete, comparable SHA ancestry. Config events never count as new code. First-observed production commits are deduplicated across deployments. Large or truncated Heroku histories are explicitly labelled.

An import created before Heroku support remains valid. Run the updated capture command to enrich it, then review identities; session exports already carry the raw capture records and retain the chosen deployment view.

## Deployment ancestry outside HEAD and tags

Heroku may point to a commit on an earlier QA branch, a rolled-back branch,
 or an untagged deployment that is not reachable from `HEAD --tags`. The copyable
capture command now inspects *only targeted deployment SHAs*, rather than doing
`git log --all` or fetching every remote branch:

- Heroku events are now captured in a bounded 3,000-record window per environment. The latest **eight distinct
  candidate SHAs per environment** are considered, preferring PROD, and **18
  distinct SHAs total** are inspected. Only candidates in the release data
  are considered, never arbitrary hashes in free-form text.
- For SHA objects already available locally, it captures up to **175 commits
  per target** not reachable from HEAD or a local tag. Git deduplicates imported
  records when the same commit is reachable from multiple targets. Fetching
  all remote branches is unnecessary.
- To additionally try up to **four direct-SHA network fetches**, opt in before
  running the copy command:

  ```sh
  export GIT_SIGNALS_FETCH_DEPLOYMENT_SHAS=1
  ```

  Fetches use `git fetch --no-tags --depth=80 --filter=blob:none origin SHA`.
  GitHub may refuse a SHA that is not fetchable through its advertised refs;
  network fetches may also alter local shallow-repository metadata. They do
  **not** switch branches or touch the working tree. Clear the variable with
  `unset GIT_SIGNALS_FETCH_DEPLOYMENT_SHAS` afterward.
- The import records whether the side-history was available or hit its bound.
  Actual shallow Git boundaries are marked, so truncated parents cannot
  masquerade as complete ancestry. The Deployment Explorer shows coverage;
  unresolved or incomplete graphs do **not** acquire made-up authorship or
  first-production credit. If an event is older than the captured set of
  release records, it may still be unresolved.

## Browser navigation, permalinks and multiple tabs

Observatory, Periods, Contributors, Codebase and Deployments now use compact
URLs, and cross-entity navigation is made from **real links**. Browser
**Back/Forward**, Cmd/Ctrl-click, middle-click, context-menu Open in New Tab,
and Copy Link are supported. View state is pushed into native browser history
on navigation, without rerunning Git ancestry analysis. Presentation-only
controls update the current URL without filling the Back stack on every edit.

URLs encode view and selection (e.g. release SHA, selected author's canonical
email, date range, codebase area or deployment event) **but never the Git log,
GitHub release notes, Heroku records, or config values**. Be aware that
contributor email identifiers may appear in your browser history and copied
links; avoid sharing those links where the identities are confidential.

Because git:signals has no backend, a link **cannot by itself carry the
repository evidence**. For a new tab or a bookmarked link to reopen the exact
analysis, click **Enable multi-tab links**. This explicitly saves the current
session to this browser's IndexedDB; the URL receives a short random dataset
key. A different tab on the same origin can restore the session locally and
resolve the selected release/person/date. Links cannot reconstruct the dataset
on another device: import the corresponding exported session there. Saving is
optional; the current tab's browser Back/Forward works without it. Use
**Update saved history** after changing contributor identity merges or
important saved settings. **Forget local copy** removes the stored session.
Saved links expire 30 days after they are saved; expired entries are
removed when opened. Browser storage can be unavailable or quota-limited,
which is reported rather than silently implying the link can be reopened.
