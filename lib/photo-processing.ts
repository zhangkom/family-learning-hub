// Server contract mirrors PreparedPhoto without any local URI/owner fields.
export type PhotoProcessing = {
  schemaVersion: 1;
  algorithmVersion: 'android-photo-v1';
  originalId: string;
  studentId: string;
  outputId: string;
  sourceSha256: string;
  sha256: string;
  bytes: number;
  mime: 'image/jpeg';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  exifOrientation: number;
  decodedWidth: number;
  decodedHeight: number;
  sourceSpace: 'exif-upright-normalized-edges';
  outputSpace: 'normalized-edges';
  corners: number[];
  quarterTurns: number;
  enhancement: 'none' | 'light';
  jpegQuality: number;
  maxEdge: number;
  sourceToOutput: number[];
  outputToSource: number[];
  quality: {
    advisoryOnly: true;
    warnings: (
      | 'low-light'
      | 'low-contrast-or-blank'
      | 'uneven-light-or-colored-background'
      | 'possible-blur'
      | 'small-output'
    )[];
    laplacianVariance: number;
    darkFraction: number;
    backgroundRange: number;
    percentile10: number;
    percentile90: number;
  };
  createdAt: number;
};
