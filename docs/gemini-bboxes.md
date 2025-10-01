# TL;DR (what trips people up)

* **Coordinate order is `y,x` (not `x,y`).** Boxes come back as `[y_min, x_min, y_max, x_max]`. Top-left is the origin. Axes: `x`→horizontal, `y`→vertical. ([Google Cloud][1])
* **Values are normalized to 0–1000** (not 0–1, not pixels) in the official “bounding box detection” flow. Convert to pixels by multiplying **y-values by image height** and **x-values by image width**, then divide by 1000. ([Google Cloud][1])
* You request boxes either by **prompting** or (better) by using **structured output** with a schema. The docs show examples for both. ([Google Cloud][1])
* Inline images go in the `generateContent` request as **base64 bytes** (or via Files API). Inline request size limit: **20 MB**. ([Google AI for Developers][2])

---

# 1) What Gemini documents about bounding boxes

## Format, axes, origin, scale

* **Output format:** `[y_min, x_min, y_max, x_max]` (note the **y-first** order).
* **Origin:** top-left.
* **Axes:** `x` increases to the right, `y` increases downward.
* **Scale:** **normalized 0–1000** for every image (integers are commonly shown in examples).
  Source (official “Bounding box detection” page): “Output: Bounding boxes in the `[y_min, x_min, y_max, x_max]` format… coordinate values are **normalized to 0–1000** for every image.” ([Google Cloud][1])

> Practical note: Google’s robotics examples also use **[y, x] normalized to 0–1000** for points and show boxes as `box_2d: [ymin, xmin, ymax, xmax]`—consistent with the page above. ([Google AI for Developers][3])

## How you “ask” for boxes

* You can **prompt** for detection (e.g., “Return bounding boxes as JSON…”), and you can tighten output with **structured output** (`response_schema` + `response_mime_type: "application/json"`).
* Vertex/AI-Studio guidance: define a **response schema** and **don’t duplicate it in the prompt**. ([Google Cloud][4])

## Where boxes are visualized

* **AI Studio** will draw them for you.
* **Vertex / your own app**: you **must** draw them yourself (convert normalized → pixels). ([Google Cloud][1])

---

# 2) Getting images into Gemini (so you can ask for boxes)

Two official approaches:

1. **Inline bytes** (good for small files, total request ≤ **20 MB**) – send as `inline_data` (REST) / `inlineData` (SDK). ([Google AI for Developers][2])
2. **Files API** (better for large files or reuse across requests). ([Google AI for Developers][2])

The **image understanding** doc shows both patterns in REST, JS, Python, Go. ([Google AI for Developers][2])

---

# 3) Minimal REST tutorial: request boxes + convert them

### 3.1 Ask for normalized boxes (official style)

**Request (REST):**

```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent
x-goog-api-key: YOUR_KEY
Content-Type: application/json
```

**Body (key bits):**

```json
{
  "contents": [{
    "parts": [
      { "inline_data": { "mime_type": "image/jpeg", "data": "<BASE64>" } },
      { "text": "Return bounding boxes for visible construction-related objects as JSON." }
    ]
  }],
  "generationConfig": {
    "response_mime_type": "application/json",
    "response_schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "box_2d": { "type": "array", "items": { "type": "integer" }, "minItems": 4, "maxItems": 4 },
          "label":  { "type": "string" }
        },
        "required": ["box_2d","label"]
      }
    }
  }
}
```

**Expected output shape (per docs):**

```json
[
  {"box_2d": [ymin, xmin, ymax, xmax], "label": "ladder"},
  {"box_2d": [ ... ], "label": "exit sign"}
]
```

Official examples show **`box_2d`** in **`[ymin, xmin, ymax, xmax]` normalized to 0–1000** and frequently cast to integers. ([Google Cloud][1])

### 3.2 Convert normalized `[ymin, xmin, ymax, xmax]` → pixel `x,y,width,height`

```js
function box2dToXYWH([ymin, xmin, ymax, xmax], imgW, imgH) {
  // Convert normalized 0..1000 → absolute pixels
  const yMinPx = (ymin / 1000) * imgH;
  const xMinPx = (xmin / 1000) * imgW;
  const yMaxPx = (ymax / 1000) * imgH;
  const xMaxPx = (xmax / 1000) * imgW;
  const w = Math.max(0, xMaxPx - xMinPx);
  const h = Math.max(0, yMaxPx - yMinPx);
  return { x: xMinPx, y: yMinPx, width: w, height: h };
}
```

> Why multiply `y` by **height** and `x` by **width**: the docs normalize to a “**1000×1000** version of the image”. Convert back using the real image dimensions. ([Google Cloud][1])

### 3.3 Draw to a canvas that may be scaled in CSS

If your canvas is visually scaled, account for **devicePixelRatio** so strokes/labels line up:

```js
function prepareCanvasForDisplay(canvas, displayW, displayH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width  = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  canvas.width  = Math.round(displayW * dpr);
  canvas.height = Math.round(displayH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing ops to CSS pixels
  return ctx;
}
```

> (The docs don’t cover canvas DPI, but mis-handling this is a **very common** reason boxes look offset on HiDPI displays.)

---

# 4) Using your own schema (e.g., `x,y,width,height` or polygons)

Gemini also supports **structured output** with custom shapes—useful if you prefer `x,y,width,height` or want polygons. The official **structured output** docs show how to define a `responseSchema` and warn **not to duplicate the schema in your prompt** (let the schema enforce structure). ([Google AI for Developers][5])

* If you keep the **official normalized convention**, add a field like `"coordSystem": "normalized_0_1000"` and convert client-side.
* If you really want **pixels**, say so clearly in the schema and prompt (but note: the “bounding box detection” feature itself documents **normalized 0–1000**; if you deviate, **test carefully**).

---

# 5) Official examples you can model after

* **Bounding box detection (Vertex AI docs):** Explains format, origin, and **0–1000 normalization**; shows code that parses integers and multiplies by image dimensions before drawing. ([Google Cloud][1])
* **Image understanding (Gemini API docs):** How to pass images inline / via Files API; includes REST & JS/Python examples (useful for wiring requests). ([Google AI for Developers][2])
* **Robotics ER examples:** Prompts for **points** and **boxes** using normalized `[y, x]` (0–1000) with “box_2d”. Helpful as additional, up-to-date examples. ([Google AI for Developers][3])

(Community write-ups that match the docs’ math—useful for intuition and troubleshooting: Simon Willison’s notes on Gemini’s “**1000×1000**” normalization, plus newer posts showing segmentation/masks as an advanced extension.) ([Simon Willison’s Weblog][6])

---

# 6) Debugging misaligned boxes — a checklist

1. **Confirm the order**: Are you treating the array as `[x_min, y_min, x_max, y_max]` by mistake? It’s `[y_min, x_min, y_max, x_max]`. Flip if needed. ([Google Cloud][1])
2. **Confirm the scale**: Are you dividing by 1 (0–1) instead of **1000**? Or treating them as pixels? Multiply y-values by **image height / 1000** and x-values by **image width / 1000**. ([Google Cloud][1])
3. **Use the natural image size**: Convert with the **actual pixel dimensions** of the image (not the CSS-scaled size). In the browser, that’s the image bitmap’s `width/height`, not the rendered `<img>` size.
4. **Canvas DPI**: If your canvas is styled with CSS (e.g., 800×600) but its internal `width/height` are different, drawing ops will misalign. Use the **devicePixelRatio** scaling fix above.
5. **Orientation/rotation**: If you rotate the image or draw it into a transformed context, apply the **same transform** to your boxes.
6. **Rounding**: Keep floats during conversion; only round when stroking the rectangle.
7. **Test with a known case**: Ask the model for **a single box** around an obvious object and draw **corner markers** (little circles) at the converted `(x_min,y_min)` and `(x_max,y_max)` to see exactly where the math lands.
8. **Schema drift**: If you defined your own `x,y,width,height` schema but still prompted with “normalized 0–1000”, the model may output normalized values in pixel fields. Align your prompt + schema.

---

# 7) Worked example: parse & draw (JS)

Assume the response is:

```json
[
  { "box_2d": [120, 200, 360, 480], "label": "ladder" }
]
```

and your image bitmap is `imgW=1920`, `imgH=1080`.

```js
const [ymin, xmin, ymax, xmax] = result[0].box_2d;
const yMinPx = ymin * imgH / 1000;
const xMinPx = xmin * imgW / 1000;
const yMaxPx = ymax * imgH / 1000;
const xMaxPx = xmax * imgW / 1000;
const w = xMaxPx - xMinPx;
const h = yMaxPx - yMinPx;

// Draw (after preparing canvas with devicePixelRatio scaling)
ctx.strokeStyle = '#00ff88';
ctx.lineWidth = 2;
ctx.strokeRect(xMinPx, yMinPx, w, h);
ctx.fillText('ladder', xMinPx + 6, yMinPx - 6);
```

This is exactly what Google’s sample code does (in Python/Go), just translated to JS: multiply **y** by **height** and **x** by **width**, both divided by **1000**. ([Google Cloud][1])

---

# 8) Notes on “experimental” status

The “Bounding box detection” feature is marked **Experimental / Pre-GA** in Google’s Vertex docs, which means details can change and you should test with your target model (`gemini-2.5-pro` in your case). ([Google Cloud][1])

---

# 9) When to use your custom schema vs. the default box_2d

* If you’re happy with **normalized** coords, you can keep the official `box_2d` convention and convert on your side.
* If you want **pixels** or **polygons**, define a **`response_schema`** that matches your app (e.g., `bbox: {x,y,width,height}` and `polygon: [{x,y}]`)—Gemini will fill it, and you convert only if you allow normalized too. The structured output docs are the source of truth here. ([Google AI for Developers][5])

---

## Quick sanity test prompt (to isolate math issues)

Ask the model for **one** box around a single, obvious object and **nothing else**:

> “Return a JSON array of exactly one bounding box for the most salient object in the image. Use the format `[{ "box_2d": [ymin, xmin, ymax, xmax], "label": "object" }]`. Coordinates must be integers normalized to 0–1000. No markdown.”

If that box still lands in the wrong place, it’s almost certainly **conversion / canvas DPI / orientation** rather than the model.

---

## Sources

* **Bounding box detection (official, Vertex docs):** format, axes, origin, **0–1000 normalization**, and code that scales to image pixels. ([Google Cloud][1])
* **Image understanding (Gemini API):** supplying images inline or via Files API; request size limits. ([Google AI for Developers][2])
* **Structured output (Gemini / Vertex):** define `response_schema`; don’t duplicate schema in prompt. ([Google AI for Developers][5])
* **Robotics ER (Gemini API):** additional examples that use points and boxes normalized to 0–1000; sample prompts. ([Google AI for Developers][3])
* **Community confirmation of normalization:** practical notes on the “1000×1000” interpretation and debugging. ([Simon Willison’s Weblog][6])


[1]: https://cloud.google.com/vertex-ai/generative-ai/docs/bounding-box-detection "Bounding box detection  |  Generative AI on Vertex AI  |  Google Cloud"
[2]: https://ai.google.dev/gemini-api/docs/image-understanding "Image understanding  |  Gemini API  |  Google AI for Developers"
[3]: https://ai.google.dev/gemini-api/docs/robotics-overview "Gemini Robotics-ER 1.5  |  Gemini API  |  Google AI for Developers"
[4]: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output?utm_source=chatgpt.com "Generative AI on Vertex AI - Structured output"
[5]: https://ai.google.dev/gemini-api/docs/structured-output?utm_source=chatgpt.com "Structured output | Gemini API | Google AI for Developers"
[6]: https://simonwillison.net/2024/Aug/26/gemini-bounding-box-visualization/?utm_source=chatgpt.com "Building a tool showing how Gemini Pro can return ..."
