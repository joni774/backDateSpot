/** Cloudinary upload helpers for permanent place image storage. */
import { v2 as cloudinary } from "cloudinary";

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim()
  );
}

export function isCloudinaryUrl(url: string): boolean {
  return /res\.cloudinary\.com\//i.test(url.trim());
}

function ensureCloudinaryConfig(): boolean {
  if (!isCloudinaryConfigured()) return false;
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return true;
}

export async function uploadPlaceImageBuffer(options: {
  placeId: string;
  index: number;
  buffer: Buffer;
  contentType?: string;
}): Promise<string | null> {
  if (!ensureCloudinaryConfig()) return null;
  const mime = options.contentType?.split(";")[0]?.trim() || "image/jpeg";
  const dataUri = `data:${mime};base64,${options.buffer.toString("base64")}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `datespot/places/${options.placeId}`,
      public_id: `img_${options.index}`,
      overwrite: true,
      invalidate: true,
      resource_type: "image",
    });
    return result.secure_url ?? null;
  } catch (err) {
    console.warn(`[cloudinary] buffer upload failed for ${options.placeId}:`, err);
    return null;
  }
}

export async function uploadPlaceImageFromUrl(options: {
  placeId: string;
  index: number;
  url: string;
}): Promise<string | null> {
  if (!ensureCloudinaryConfig()) return null;
  if (isCloudinaryUrl(options.url)) return options.url;

  try {
    const result = await cloudinary.uploader.upload(options.url, {
      folder: `datespot/places/${options.placeId}`,
      public_id: `img_${options.index}`,
      overwrite: true,
      invalidate: true,
      resource_type: "image",
    });
    return result.secure_url ?? null;
  } catch (err) {
    console.warn(`[cloudinary] url upload failed for ${options.placeId}:`, err);
    return null;
  }
}
