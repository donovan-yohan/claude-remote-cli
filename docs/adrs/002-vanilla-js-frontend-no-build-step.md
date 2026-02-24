# ADR-002: Vanilla JS Frontend with No Build Step

## Status
Superseded by Svelte 5 migration (2026-02-24)

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
The frontend needs to render terminal sessions in the browser, handle PIN authentication, manage a session sidebar with filtering, and relay keyboard input over WebSocket. These requirements are well within the capability of plain browser APIs. Introducing a framework (React, Vue, Svelte) or a bundler (Vite, webpack) would add tooling complexity, increase the contributor onboarding cost, and create a build step that must be maintained. The project targets a single-page interface with a small number of UI components.

## Decision
The frontend MUST be a single-page application using plain HTML, CSS, and JavaScript in the `public/` directory. There MUST NOT be a build step, transpiler, or bundler.

- All application logic MUST reside in `public/app.js` as a single IIFE
- Styles MUST be in `public/style.css`
- The HTML entry point MUST be `public/index.html`
- Vendor dependencies (xterm.js, xterm-addon-fit) MUST be self-hosted as pre-built files in `public/vendor/` and loaded via `<script>` tags
- The frontend MUST use ES5-compatible syntax (var declarations, function expressions, `.then()` chains instead of async/await) to maximize browser compatibility without transpilation
- DOM manipulation MUST use `document.getElementById`, `document.createElement`, and event listeners directly -- no virtual DOM or template engine

## Consequences

### Positive
- Zero build tooling to install, configure, or maintain
- `npm start` serves the frontend immediately via `express.static` with no pre-build step
- The entire frontend can be understood by reading three files
- No node_modules bloat for frontend dependencies; vendor files are checked into version control
- Works in any browser that supports xterm.js (all modern browsers)

### Negative
- No component abstractions; UI patterns like the session list item are built imperatively with `createElement` calls, which is more verbose than JSX or templates
- No TypeScript type checking on the frontend code
- ES5 constraint means no destructuring, arrow functions, or template literals in `app.js`, making code slightly more verbose than modern JS
- Adding significant new UI features (e.g., split panes, settings panels) will increase `app.js` size without module boundaries

### Risks
- If the frontend grows beyond approximately 1000 lines, the single-file approach may become difficult to maintain and a module system (ES modules or a bundler) should be reconsidered
