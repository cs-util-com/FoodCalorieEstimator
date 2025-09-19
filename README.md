# CalorieCam – Application Specification (v1)

## 1) Product summary

Single-photo calorie estimator for multi-item meals. A vision-LLM (Gemini 2.5) identifies foods, estimates per-item kcal and optional bounding boxes, then shows a **confidence-based kcal range** for the meal. Local history with full images is stored on device. No server; user supplies a provider key in Settings.

### Goals

* One-tap flow: pick/take a photo → result with **range** and **per-item list**.
* Detect multiple items; draw **bounding boxes**; labels show **name + confidence**.
* Allow **rename**, **include/exclude**, **add/remove items**, **manual kcal edits** (with original preserved).
* **History**: grid gallery with search; detail view with **CSV per-meal** export.
* **BYOK** Gemini only (default: **2.5 Flash**, toggle to **Pro** in Settings).
* **No build step**: vanilla JS modules, ESM via **unpkg.com**, UI via **Pico.css**.

### Non-goals (v1)

* No barcode scanning, menu matching, or nutrition DB grounding.
* No server, no cloud proxy, no analytics beyond local logs.
* No face blurring, no encryption of local data, no crops.

---

## 2) UX overview

### Navigation

* **Tabs (default = Camera)**: **Camera**, **History**, **Settings**.

### Camera (native chooser)

* Uses `<input type="file" accept="image/*" capture>`.
* On select, image is normalized (EXIF-upright) and preprocessed (WEBP, 1536px long edge, q≈0.8), EXIF stripped.

### Result

* **Header**: Meal **kcal range** (derived from `meal_confidence`) and small badge stating that estimates may vary (About page only; no inline disclaimer).
* **Image**: Bounding boxes **start visible**; label = **name + confidence**. **Tap image toggles** boxes on/off.
* **Per-item list**:

  * Shows `name`, `kcal`, `confidence`, optional `estimated_grams`, and **used scale ref** indicator if set.
  * **Rename**, **include/exclude**, **delete**, **add item** (name, optional grams, kcal).
  * **Manual kcal edits** are allowed; **original vs. edited** preserved with **Reset**.
* **Totals rule**: UI **sums item kcals**. If model `total_kcal` differs by >10%, show both totals and a short note (“Using item sum; model total was …”).
* **Low-confidence handling**: items with `confidence < 0.35` are **excluded by default** (greyed; tap to include).
* **Save**: explicit **Save** button; nothing is stored until tapped.

### History

* **Grid gallery** (2-column on mobile) of thumbnails with kcal overlay and date.
* **Search bar** (top): case-insensitive **substring** over item names; highlights matches.
* Tapping an entry opens **Detail**:

  * Photo (bbox toggle via tap), range + totals note if applicable.
  * Per-item list with the same edit capabilities as Result (rename, include/exclude, add/remove, manual kcal with original preserved).
  * **Export**: **CSV per-meal** (`id, createdAt, totalKcal, mealConfidence, itemsCount, itemsList`).
  * **Delete** meal.

### Settings (Power bundle)

* **Provider**: **Gemini only**. **Model variant toggle**: **2.5 Flash** (default) ⇄ **2.5 Pro**.
* **Image preprocess** selector (1024/1536) and **units** (default kcal; can switch to kJ).
* **Default “Show boxes”** toggle.
* **Confidence threshold** slider (affects include/exclude; default 0.35).
* **Demo/sample image** runner.
* **Local logs** viewer (recent errors/debug).
* **Wipe all data** action.
* **About** page link (disclaimers live here).

### Onboarding

* **Demo-first**: Camera shows a “Try demo image” card (runs canned JSON). Adding a key unlocks real estimation.

---

## 3) Model & output

### Provider & profile

* **Gemini 2.5** (BYOK, browser calls). Default: **Flash**; switchable to **Pro** in Settings.
* Inference profile (**Balanced**): temperature **0.2**, top-p **0.9**, max tokens **900**, 1 retry on schema violation, timeout **15s**.

### Exclusions policy

* Exclude **plain water** and **unsweetened black coffee/tea** by default. Count other beverages.

### Confidence → range mapping (5-level enum)

* `very-high` → **±10%**
* `high` → **±15%**
* `medium` → **±25%**
* `low` → **±35%**
* `very-low` → **±40%**

### JSON schema (v1.1; strict, single response)

*All numbers are integers unless noted. Boxes are optional but encouraged.*

```json
{
  "version": "1.1",
  "model_id": "gemini-2.5",
  "meal_confidence": "very-low|low|medium|high|very-high",
  "total_kcal": 0,
  "items": [
    {
      "name": "string",
      "kcal": 0,
      "confidence": 0.0,
      "estimated_grams": 0,
      "used_scale_ref": false,
      "scale_ref": "fork|spoon|credit_card|plate|chopsticks|other",
      "bbox_1000": { "x": 0, "y": 0, "w": 0, "h": 0 },
      "notes": "string"
    }
  ]
}
```

**Constraints**

* `items` length **1–12**.
* `total_kcal` **0–5000**; `items[].kcal` **0–4000**.
* `items[].confidence` **0–1** (≤2 decimals).
* `items[].estimated_grams` **0–2000** (rounded; optional but recommended).
* `bbox_1000` fields are **0–1000**, box must lie within image.
* `notes` ≤ **120 chars**; optional.
* If totals disagree by >10%, UI trusts **sum(items\[].kcal)** and shows both.

### System prompt (single-pass, few-shot)

* **Must** output **valid JSON** only (`responseMimeType: application/json` with the above schema).
* **Use visible reference objects** to improve portion size (e.g., forks, credit cards, chopsticks, plates). If none are present, infer from typical plate geometry.
* **Do**: count only visible food; include sauces/dressings if clearly visible as an item; cap items at 12; set `used_scale_ref` and `scale_ref` when applicable; provide `bbox_1000` for each item whenever possible.
* **Don’t**: guess brands; invent invisible items; exceed numeric bounds; include plain water or unsweetened black coffee/tea.
* **Few-shot scenarios** embedded:

  1. **Burger + fries** on a tray; ketchup packet visible (scale); expect a small low-confidence ketchup item.
  2. **Pasta bolognese + parmesan**; no strong scale object; rely on plate; note density caveat in `notes`.
  3. **Sushi (8 nigiri)** with chopsticks; count pieces; ginger/wasabi often excluded (<0.35).
  4. **Mixed breakfast** (scrambled eggs, toast, avocado); butter pat as scale ref.

---

## 4) Architecture

### Runtime & dependencies

* **PWA** (vanilla JS, no build tools).
* **ESM from CDN**: **unpkg.com** for `langchain` and `@google/generative-ai`. Pico.css via CDN.
* **CSP (relaxed)**: allow inline scripts/styles (trade-off accepted for build-less simplicity).

### Component boundaries

#### Pattern

* **Central Store** (“single source of truth”): plain JS object with `dispatch(action)` and `subscribe(selector)`.

#### State slices

* `ui`: `{ activeTab, showBoxes, toasts, modals }`
* `settings`: `{ provider: 'gemini', geminiKeyMasked, modelVariant: 'flash'|'pro', preprocess: 1536, units: 'kcal'|'kJ', defaultShowBoxes, confidenceThreshold }`
* `capture`: `{ imageFullBlob, imageThumbBlob, status: 'idle|loading|ready|error', error? }`
* `estimation`: `{ requestId, jsonRaw, parsed, status: 'idle|running|ok|error', error? }`
* `history`: `{ items: MealMeta[], searchQuery }`
* `sw`: `{ updateReady: boolean }`

#### Actions (lean lifecycle)

* UI: `UI/TAB_SET`, `UI/TOGGLE_BOXES`
* Capture: `CAPTURE/START` → `CAPTURE/DONE|ERROR`
* Estimate: `ESTIMATE/START` → `ESTIMATE/SUCCESS|ERROR`
* History: `HISTORY/SAVE`, `HISTORY/DELETE`, `HISTORY/SEARCH_SET`
* Settings: `SETTINGS/SET` (provider key, variant, preprocess, units, boxes, threshold)
* SW: `SW/UPDATE_READY`, `SW/RELOAD`

#### Views, Widgets, Services

* **Views**: CameraView, ResultView, HistoryView, SettingsView (dumb; dispatch actions; subscribe to store).
* **Widgets**: ImageCanvas (draw/flip bboxes), ItemList (edits & badges), ProviderKeyForm, Toasts/Dialogs.
* **Services**:

  * **PreprocessService**: EXIF-upright, resize to 1536 WEBP, generate thumbnail.
  * **EstimationService**: Gemini via LangChain.js; strict JSON; retries on schema violation (1).
  * **StorageService**: IndexedDB (split stores: `meals`, `images`), localStorage for API key & prefs.
  * **ExportService**: per-meal CSV generation; browser download.
  * **SWService**: handles update lifecycle (silent auto-update).

---

## 5) Data & storage

### Local persistence

* **Images + results saved** locally on Save (full-res + thumbnail).
* **Schema**:

  * `meals` (metadata/JSON): `{ id, createdAt, provider: 'gemini', modelId, totalKcal, mealConfidence, items[], jsonRaw, hasBoxes, imageId }`
  * `images`: `{ imageId, fullBlob, thumbBlob }`
  * Index on `meals.createdAt`.
* **History capacity**: **no fixed cap**. Provide quick action “Delete oldest **X** entries” (user enters X; optional Y range in UI copy).
* **Security**: **plain storage** (no encryption). API key stored in **localStorage** (BYOK). “Wipe all data” available in Settings.

### Offline

* **Basic offline**: app opens and **History** works offline; **Capture/Estimate** disabled when offline.
* **Service Worker**: **stale-while-revalidate** app shell + small runtime cache (≤5 MB) for CDN modules (LRU). **Silent auto-update**.

---

## 6) Error handling & recovery

* **Estimation errors** (network, invalid JSON, provider):

  * Inline banner in Result with **Retry** and **Back to Camera**; keep image in view.
  * Local log entry (viewable in Settings).
* **Totals mismatch** (>10%): show both totals with a note; compute total from items.
* **Low-confidence exclusions**: default threshold 0.35; excluded items are clearly greyed and clickable to include.
* **CSP/permission issues**: toast with brief explanation and link to Settings or About if needed.
* **Storage quota**: on write failure, show dialog with option **“Delete oldest X entries”**.

---

## 7) Security & privacy

* **No server**; keys and images never leave device (except provider calls).
* **CSP (relaxed)** to support build-less ESM + inline; `object-src 'none'`, `frame-ancestors 'none'`.
* **EXIF** stripped on preprocess.
* **No face blurring** (explicit choice).
* **About** page hosts health/accuracy disclaimers; no inline disclaimer by default.

---

## 8) Testing plan

### Scope

* **Unit tests only** (dev-only tooling).
* **Jest (Node + jsdom)** with **npm packages in tests only**.

  * App stays build-less; tests import local npm deps (`langchain`, `@google/generative-ai`) and pure modules.
  * CDN-specific or DOM canvas drawing covered by thin adapters/mocks.

### Test targets

* Store reducers/selectors; action flows.
* JSON schema validator + range math (confidence → range).
* Preprocess utilities (EXIF upright; resize dimension math).
* Storage adapters (IndexedDB mocks) for save/load/delete.
* Export CSV formatter.

### Example commands (CI-friendly)

* `npm test -- --ci --runInBand`
* Output JUnit or text summary; no interactive reporters.

---

## 9) Developer prompts & examples

### Request parameters to Gemini (conceptual)

* `responseMimeType: "application/json"`
* Temperature 0.2, top-p 0.9, maxOutputTokens 900.
* **System**: instructions (rules above) + schema + few-shot examples (4 scenarios).
* **User**: “Analyze this meal photo. Return JSON only.” (attach image).

### Few-shot structure (sketch)

Each example includes: short caption, the image (placeholder), and the exact JSON adhering to v1.1 with `bbox_1000` present for each item. Include one example noting visible scale ref (e.g., `scale_ref: "credit_card", used_scale_ref: true`).

---

## 10) Implementation notes

* **BBoxes**: store and draw as normalized \[0–1000]; convert to CSS pixels by multiplying by container/clientWidth/Height.
* **Range math**: map `meal_confidence` to ±% and display “low–high” around **sum(items)** (after include/exclude + edits).
* **Units**: default **kcal**; if user switches to **kJ**, convert (kJ = kcal × 4.184); persist setting.
* **Demo image**: bundled asset; demo JSON canned to show boxes, confidence, mismatch note case if desired.

---

# Iterative Development Plan (bottom-up)

## Rules for the iterative process

1. **Exactly one prioritized task per iteration.** Before/after each change, run **build/lint/tests** (here: tests only) and a quick manual smoke in the browser.
2. **Tests include a short “why this test matters”** comment to guide future modifications.
3. **Search the codebase before adding functionality.** If similar code exists, refactor rather than re-implement.
4. **After each iteration**, append a short note to `docs/implementation-progress.md` with decisions, learnings, and next steps.
5. **Prefer non-interactive CI commands/reporters** only.

---

## Iteration 1 — Store & actions (pure logic)

**Goal:** Central store with slices and action creators.

**Given** initial state, **When** `CAPTURE/START` then `CAPTURE/DONE`, **Then** `capture.status` transitions to `ready` and blobs are referenced.

* Tests: reducers for each action; selectors derive activeTab, range display inputs.
* Why: Foundation for all UI; enables later tests to run without DOM.

## Iteration 2 — JSON schema & range math utils

**Goal:** Implement v1.1 schema validator and confidence→range mapping.

**Given** a valid sample JSON, **When** validated, **Then** outputs parsed object with constraints enforced.
**Given** `meal_confidence='high'`, **Then** range = ±15%.

* Why: Guarantees strict model I/O and consistent ranges.

## Iteration 3 — PreprocessService (EXIF upright + WEBP 1536)

**Goal:** Browser image pipeline returning `{normalizedBlob, thumbBlob, width, height}`.

**Given** a rotated JPEG, **When** processed, **Then** canvas export is upright, no EXIF, ≤1.2 MB WEBP at ≤1536px long edge.

* Why: Keeps provider costs predictable and boxes aligned.

## Iteration 4 — StorageService (IndexedDB split)

**Goal:** `saveMeal`, `loadMeal`, `deleteMeal`, `listMeals`, `deleteOldest(count)`.

**Given** a meal result, **When** saved, **Then** `meals` metadata and `images` blobs persist; list returns new entry.

* Why: Enables History and offline reading.

## Iteration 5 — EstimationService (Gemini via LangChain)

**Goal:** Single call wrapper honoring response JSON schema, 1 retry on violation.

**Given** an image Blob, **When** estimating, **Then** return parsed v1.1 JSON; on schema error, retry once; else throw typed error.

* Why: Core functionality.

## Iteration 6 — ImageCanvas widget (bbox overlay)

**Goal:** Draw/scale boxes from `bbox_1000`, labels “name + confidence”, toggle on tap.

**Given** item boxes, **When** container resizes or toggles, **Then** overlay redraws without drift.

* Why: Visual grounding of items.

## Iteration 7 — ResultView

**Goal:** Wire capture → preprocess → estimate → render; edits & totals rule.

**Given** a photo, **When** estimation succeeds, **Then** show range, boxes visible, per-item list with include/exclude, rename, add/remove, manual kcal (with original preserved + reset), totals note if mismatch >10%.

* Why: Primary user journey.

## Iteration 8 — HistoryView (grid + search)

**Goal:** Grid gallery with search bar; open detail.

**Given** saved meals, **When** searching “avoc”, **Then** filtered thumbnails highlight matches.

* Why: Retrieval & organization.

## Iteration 9 — DetailView + Export

**Goal:** Same edit capabilities as Result; **CSV per-meal** export; delete.

**Given** a saved meal, **When** exporting, **Then** CSV matches spec: `id, createdAt, totalKcal, mealConfidence, itemsCount, itemsList`.

* Why: Shareable output; data portability.

## Iteration 10 — Settings & onboarding

**Goal:** Provider key entry (Gemini only), model variant toggle, preprocess & units, default show boxes, confidence threshold, demo runner, logs, wipe data; demo-first flow.

**Given** no key, **When** running demo, **Then** canned JSON renders; after key set, real estimation enabled.

* Why: First-run UX and configuration.

## Iteration 11 — Service Worker & caching

**Goal:** SW with stale-while-revalidate shell + small runtime cache; silent auto-update.

**Given** prior visit, **When** offline open, **Then** app shell and History load; Capture/Estimate disabled.

* Why: Offline readiness and quick loads.

## Iteration 12 — Polishing & edge errors

**Goal:** Inline error banners, storage quota dialog (“Delete oldest X”), About page.

**Given** provider timeout, **When** retry pressed, **Then** Estimation restarts cleanly and logs entry is recorded.

* Why: Robustness.

---

## Done criteria (v1)

* Photo → preprocess → Gemini JSON → result with range, boxes, item edits, manual kcal (with original preserved).
* Save to local; History grid + search; Detail with CSV per-meal export.
* Settings configured; demo image works without key; Gemini key enables real runs.
* SW offline open; Capture/Estimate disabled offline.
* Unit tests passing (store, schema, preprocess, storage, export, range math).
* `docs/implementation-progress.md` contains iteration notes.

If anything should be adjusted before implementation begins, specify and a quick follow-up question will be asked (one at a time) to update the spec.