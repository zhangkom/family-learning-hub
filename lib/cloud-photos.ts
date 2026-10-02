// Original-byte cloud storage is independent of scans and model jobs.
export const CLOUD_PHOTO_CAPABILITY = {
  version: 1,
  maxBatchItems: 100,
  maxFileBytes: 8 * 1024 * 1024,
  maxPixels: 32_000_000,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  recommendedConcurrency: 2,
} as const;

export type CloudPhotoBatch = {
  id: string;
  studentId: string;
  clientBatchId: string;
  expectedCount: number;
  createdAt: string;
};
export type CloudPhoto = {
  id: string;
  batchId: string;
  studentId: string;
  clientRequestId: string;
  originalName: string;
  mimeType: (typeof CLOUD_PHOTO_CAPABILITY.mimeTypes)[number];
  size: number;
  sha256: string;
  // Display dimensions after EXIF orientation; original bytes are unchanged.
  width: number;
  height: number;
  orientation: number;
  createdAt: string;
};
export type CloudPhotoPage = {
  photos: CloudPhoto[];
  nextCursor: string | null;
  storage: { usedBytes: number; limitBytes: number };
};
