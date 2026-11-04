export interface DownscaleOptions {
    /** Maximum output edge; smaller images are never enlarged. */
    maxEdge?: number;
    mime?: 'image/jpeg' | 'image/webp';
    quality?: number;
}
/** Best-effort browser preprocessing. Failures retain the original image. */
export async function downscaleImageForOcr(blob: Blob, options: DownscaleOptions = {}): Promise<Blob> {
    const {maxEdge = 2000, mime = 'image/jpeg', quality = .85} = options;
    if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml' || !Number.isFinite(maxEdge) || maxEdge < 1) return blob;
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(blob);
        const edge = Math.max(bitmap.width, bitmap.height); if (edge <= maxEdge) return blob;
        const scale = maxEdge / edge, width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
        const result = await encode(bitmap, width, height, mime, quality);
        return result && result.size < blob.size ? result : blob;
    } catch {return blob;}
    finally {bitmap?.close();}
}
async function encode(bitmap: ImageBitmap, width: number, height: number, mime: string, quality: number): Promise<Blob | null> {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d'); if (!context) return null;
        context.drawImage(bitmap, 0, 0, width, height); return canvas.convertToBlob({type: mime, quality});
    }
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
