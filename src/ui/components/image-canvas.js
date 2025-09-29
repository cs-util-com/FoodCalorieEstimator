function scaleBox(bbox, canvasWidth, canvasHeight) {
  if (!bbox) return null;
  const x = (bbox.x / 1000) * canvasWidth;
  const y = (bbox.y / 1000) * canvasHeight;
  const w = (bbox.w / 1000) * canvasWidth;
  const h = (bbox.h / 1000) * canvasHeight;
  return { x, y, w, h };
}

export class ImageCanvas {
  constructor(canvasElement, overlayElement) {
    this.canvas = canvasElement;
    this.overlay = overlayElement;
    this.ctx = canvasElement?.getContext('2d') || null;
  }

  async render({ blob, width, height, items, showBoxes }) {
    if (!this.canvas || !this.ctx) return;
    if (!blob) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.overlay.innerHTML = '';
      return;
    }

    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(this.canvas.width / width, this.canvas.height / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const offsetX = (this.canvas.width - drawWidth) / 2;
    const offsetY = (this.canvas.height - drawHeight) / 2;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
    bitmap.close?.();

    this.overlay.innerHTML = '';
    if (!showBoxes) {
      return;
    }
    // Map canvas internal coordinates to CSS pixels (overlay uses CSS pixels)
    const cssScaleX = (this.canvas.clientWidth || this.canvas.width) / this.canvas.width;
    const cssScaleY = (this.canvas.clientHeight || this.canvas.height) / this.canvas.height;
    const cssDrawWidth = drawWidth * cssScaleX;
    const cssDrawHeight = drawHeight * cssScaleY;
    const cssOffsetX = offsetX * cssScaleX;
    const cssOffsetY = offsetY * cssScaleY;

    items
      .filter((item) => item.bbox)
      .forEach((item) => {
        const scaled = scaleBox(item.bbox, cssDrawWidth, cssDrawHeight);
        if (!scaled) return;
        const box = document.createElement('div');
        box.className =
          'absolute flex items-start justify-start rounded-xl border-2 border-emerald-400/90 px-2 py-1 text-xs font-semibold text-white';
        box.style.left = `${scaled.x + cssOffsetX}px`;
        box.style.top = `${scaled.y + cssOffsetY}px`;
        box.style.width = `${scaled.w}px`;
        box.style.height = `${scaled.h}px`;
        box.textContent = `${item.name} (${Math.round(item.confidence * 100)}%)`;
        this.overlay.append(box);
      });
  }
}

export { scaleBox };
