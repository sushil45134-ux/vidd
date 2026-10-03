export async function optimizeImageFile(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.78
): Promise<string> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / source.width, maxHeight / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    source.close();
    throw new Error("Image processing is unavailable in this browser.");
  }
  context.drawImage(source, 0, 0, width, height);
  source.close();
  return canvas.toDataURL("image/webp", quality);
}