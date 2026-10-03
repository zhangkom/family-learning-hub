export function readReviewImages(request: (path: string) => Promise<Response>, itemId: string, imagePartsVersion?: number): Promise<{ name: string; bytes: Uint8Array }[]>;
