export class PreprocessService {
  constructor({
    maxLongEdge = 1536,
    thumbLongEdge = 512,
    quality = 0.8,
    createImageBitmapFn = globalThis.createImageBitmap,
    canvasFactory = () => globalThis.document?.createElement('canvas'),
  } = {}) {
    this.maxLongEdge = maxLongEdge;
    this.thumbLongEdge = thumbLongEdge;
    this.quality = quality;
    this.createImageBitmapFn = createImageBitmapFn;
    this.canvasFactory = canvasFactory;
  }

  async preprocess(file) {
    if (!file) {
      throw new Error('A file must be provided for preprocessing');
    }

    const bitmap = await this.#loadBitmap(file);
    const mainDimensions = this.#scale(bitmap.width, bitmap.height, this.maxLongEdge);
    const normalizedBlob = await this.#drawAndExport(bitmap, mainDimensions.width, mainDimensions.height, this.quality);
    const thumbDimensions = this.#scale(mainDimensions.width, mainDimensions.height, this.thumbLongEdge);
    const thumbBlob = await this.#drawAndExport(bitmap, thumbDimensions.width, thumbDimensions.height, 0.7);

    bitmap.close?.();

    return {
      normalizedBlob,
      thumbBlob,
      width: mainDimensions.width,
      height: mainDimensions.height,
    };
  }

  async #loadBitmap(file) {
    if (this.createImageBitmapFn) {
      return this.createImageBitmapFn(file, { imageOrientation: 'from-image' });
    }

    // Fallback for environments without createImageBitmap (e.g., some Safari builds).
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  #scale(width, height, targetLongEdge) {
    const longest = Math.max(width, height);
    if (longest <= targetLongEdge) {
      return { width, height };
    }
    const scale = targetLongEdge / longest;
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    };
  }

  async #drawAndExport(bitmap, width, height, quality) {
    const canvas = this.canvasFactory();
    if (!canvas) {
      throw new Error('Canvas factory must return a canvas element');
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext?.('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') {
      throw new Error('Canvas 2D context is unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob({ type: 'image/webp', quality });
    }

    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas does not support blob export'));
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to export canvas blob'));
        } else {
          resolve(blob);
        }
      }, 'image/webp', quality);
    });
  }
}
