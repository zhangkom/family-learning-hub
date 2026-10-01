import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = new Set([
  'android.permission.INTERNET',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'cn.familylearning.study.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);
export function auditPermissions(output) {
  if (!/^package: cn\.familylearning\.study\s*$/m.test(output)) throw new Error('Unexpected APK package');
  const permissions = [...output.matchAll(/^uses-permission[^:]*: name='([^']+)'/gm)].map((match) => match[1]);
  if (!permissions.includes('android.permission.INTERNET')) throw new Error('APK permission output is incomplete');
  const unexpected = permissions.filter((permission) => !allowed.has(permission));
  if (unexpected.length) throw new Error(`Unexpected APK permissions: ${unexpected.join(', ')}`);
  return { permissionsVerified: true, permissions: [...new Set(permissions)].sort((a, b) => a.localeCompare(b)) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , aapt, apk] = process.argv;
  if (!aapt || !apk) throw new Error('Usage: node audit-apk-permissions.mjs <aapt> <apk>');
  const output = execFileSync(aapt, ['dump', 'permissions', apk], { encoding: 'utf8', windowsHide: true });
  console.log(JSON.stringify(auditPermissions(output)));
}
