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
    items
      .filter((item) => item.bbox)
      .forEach((item) => {
        const scaled = scaleBox(item.bbox, drawWidth, drawHeight);
        if (!scaled) return;
        const box = document.createElement('div');
        box.className = 'box';
        box.style.left = `${scaled.x + offsetX}px`;
        box.style.top = `${scaled.y + offsetY}px`;
        box.style.width = `${scaled.w}px`;
        box.style.height = `${scaled.h}px`;
        box.textContent = `${item.name} (${Math.round(item.confidence * 100)}%)`;
        this.overlay.append(box);
      });
  }
}

export { scaleBox };
