# Implementation Progress

## Iteration 1 – Store & actions
- Built a vanilla event-driven store with capture, estimation, history, settings, and logs slices.
- Reducers prepare estimation items, enforce confidence threshold defaults, and expose selectors for UI wiring.

## Iteration 2 – JSON schema & range math utils
- Added strict `parseEstimationResponse` validator and range utilities matching the five-level confidence mapping.
- Tests cover enum enforcement, totals discrepancy note, and ±% computations.

## Iteration 3 – PreprocessService
- Implemented a browser image pipeline with EXIF-aware `createImageBitmap`, WEBP export, and thumb generation.
- Canvas interactions are dependency-injected for Jest coverage.

## Iteration 4 – StorageService
- Persist meals and blobs in IndexedDB with separate stores; `listMeals` hydrates thumbnails for the history grid.
- Added deletion helpers for quota management and tests using `fake-indexeddb`.

## Iteration 5 – EstimationService
- Wrapped Gemini fetches with schema retry, strict JSON parsing, and blob→base64 conversion.
- Exported `runDemo` for offline demo scenarios.

## Iteration 6 – ImageCanvas widget
- Created a canvas overlay that renders scaled bounding boxes with confidence labels.
- Unit tests stub `createImageBitmap` to verify draw calls and overlay DOM.

## Iteration 7 – ResultView
- Wired capture → preprocess → estimate flow, editable item list, totals rule, and manual kcal reset.
- Save button persists meals with current image dimensions.

## Iteration 8 – HistoryView
- Implemented searchable thumbnail grid with highlighted matches and object URL management.
- Detail selection loads meals via storage and reuses estimation reducers.

## Iteration 9 – DetailView + Export
- Mirrored result editing controls, added CSV export, delete, and inline range note.
- Editing saved meals updates storage and keeps detail view in sync.

## Iteration 10 – Settings & onboarding
- Settings form covers API key, model variant, preprocess size, units, show boxes default, confidence threshold, logs, and wipe data.
- Demo runner seeds estimation pipeline with bundled sample data.

## Iteration 11 – Service Worker & caching
- Registered a stale-while-revalidate service worker covering shell assets and Pico CSS CDN fallback.
- Offline visits still show shell and history entries.

## Iteration 12 – Polishing & edge errors
- Added toast notifications, offline hint, About page, and log viewer toggle.
- Detail delete clears canvas and history refresh ensures consistent state.

## Iteration 13 – Camera-first landing
- Reworked the shell to launch directly into a live camera preview with floating import/capture/history controls.
- Added webcam capture pipeline with retry handling, error overlays, and bounding-box toggling from the preview stage.
- Relocated demo and bounding box defaults into the Settings overlay and refreshed layout styles to support the new flow.
