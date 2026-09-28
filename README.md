# Git Activity Tracker — refactored

A framework-free, zero-build refactor of the supplied Git Activity Tracker.

## Structure

- `index.html` — semantic document structure only; no inline event handlers or application script.
- `assets/app.css` — bespoke component/visualisation CSS and accessibility states.
- `assets/tailwind.config.js` — Tailwind browser configuration retained from the original zero-build setup.
- `assets/app.js` — UI state, rendering and delegated DOM event handling.
- `assets/domain.js` — pure git-log parsing, aggregation and streak calculations; no DOM dependencies.
- `assets/demo-data.js` — deterministic synthetic three-year demo data.
- `tests/` — dependency-free Node smoke/regression tests.

## Run

Because the JavaScript uses ES modules, serve the directory rather than opening `index.html` via `file://`:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Verify

No package installation is required:

```sh
npm test
```

## Intentional compatibility choice

The original uses Tailwind's browser CDN. This refactor keeps that zero-build characteristic so the delivery remains a directly runnable static bundle. For a production deployment, the next infrastructure step would be compiling Tailwind at build time and self-hosting the generated CSS/fonts; that is deliberately separate from this behavior-preserving source refactor.
