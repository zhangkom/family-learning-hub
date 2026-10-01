import type { Scan } from '../types';
import type { PhotoDelivery } from './delivery';

function equivalent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equivalent(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && equivalent(left[k], right[k]));
  }
  return false;
}
/** An HTTP 2xx alone is insufficient: old servers may ignore unknown multipart fields. */
export function verifyProcessedReceipt(scan: Scan, delivery: PhotoDelivery) {
  const p = delivery.upload.processing;
  if (!scan || scan.sourceKind !== 'processed-photo' || !scan.processing)
    throw new Error('服务器尚未确认照片处理信息，可能需要升级服务；待提交照片已保留');
  if (!scan.id || scan.studentId !== delivery.record.studentId || scan.mimeType !== p.mime || scan.size !== p.bytes ||
      scan.processing.studentId !== delivery.record.studentId || scan.processing.outputId !== delivery.record.id ||
      scan.processing.sha256 !== p.sha256 || !equivalent(scan.processing, p))
    throw new Error('服务器回执与这份处理图不匹配，待提交照片已保留，请重试或联系家长');
}
