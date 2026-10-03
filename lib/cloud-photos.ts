import type { LearningSubject } from './learning';

export type PhotoArchive = {
  documentId: string;
  title: string;
  subject: LearningSubject;
  pageNumber: number;
  pageCount: number;
  paperPageNumber?: number;
  paperPageCount?: number;
  pageRole?: 'questions' | 'answer-sheet';
  revision: number;
  duplicateOfPhotoId?: string;
};
export type QuestionSourcePage = PhotoArchive & {
  photoId: string;
  rotationClockwise?: 0 | 90 | 180 | 270;
  originalSha256?: string;
  scanSha256?: string;
  sourceParts?: {
    photoId: string;
    sha256: string;
    rotationClockwise: 0 | 90 | 180 | 270;
    rect: { x: number; y: number; width: number; height: number };
    role: 'material' | 'question' | 'answer' | 'figure';
    originalName?: string;
    title?: string;
    paperPageNumber?: number;
    pageRole?: 'questions' | 'answer-sheet';
    composedRect: { x: number; y: number; width: number; height: number };
  }[];
  majorNumber?: string;
  subNumber?: string;
};
export type CloudPhotoFolders = {
  subjects: {
    subject: LearningSubject;
    documentCount: number;
    photoCount: number;
  }[];
  unclassifiedCount: number;
};
export type CloudDocument = {
  id: string;
  title: string;
  subject: LearningSubject;
  pageCount: number;
  revision: number;
  createdAt: string;
};
// Original-byte cloud storage is independent of scans and model jobs.
export const CLOUD_PHOTO_CAPABILITY = {
  version: 1,
  // No configured photo-count cap; keep the numeric field for older clients.
  maxBatchItems: Number.MAX_SAFE_INTEGER,
  nameConflictVersion: 1,
  archiveVersion: 1,
  maxFileBytes: 32 * 1024 * 1024,
  maxPixels: 32_000_000,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  recommendedConcurrency: 1,
} as const;

export type CloudPhotoBatch = {
  id: string;
  studentId: string;
  clientBatchId: string;
  expectedCount: number;
  createdAt: string;
};
export type CloudPhoto = {
  archive?: PhotoArchive;
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
