/** Old imports may lack a name; never invent a recovered camera filename. */
export function originalPhotoName(photo: { originalName?: string; originalId: string; mime: string }) {
  return photo.originalName || `照片-${photo.originalId}.${photo.mime === 'image/png' ? 'png' : photo.mime === 'image/webp' ? 'webp' : 'jpg'}`;
}
