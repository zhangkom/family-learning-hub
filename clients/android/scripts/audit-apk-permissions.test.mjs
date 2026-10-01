import { describe, it, expect } from 'vitest';
import { auditPermissions } from './audit-apk-permissions.mjs';
const base = "package: cn.familylearning.study\nuses-permission: name='android.permission.INTERNET'\nuses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'\nuses-permission: name='cn.familylearning.study.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'\n";
describe('release APK permission gate', () => {
  it('accepts the exact reviewed permission set', () => expect(auditPermissions(base).permissionsVerified).toBe(true));
  it.each(['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS', 'READ_CONTACTS', 'READ_PHONE_STATE', 'ACCESS_FINE_LOCATION', 'RECORD_AUDIO', 'CAMERA', 'READ_MEDIA_IMAGES', 'MANAGE_EXTERNAL_STORAGE'])(
    'rejects accidental %s introduced by a dependency', (permission) => {
      expect(() => auditPermissions(`${base}uses-permission: name='android.permission.${permission}'\n`)).toThrow('Unexpected APK permissions');
    });
  it('rejects a different app or unreadable output', () => {
    expect(() => auditPermissions(base.replace('package: cn.familylearning.study', 'package: another.app'))).toThrow();
    expect(() => auditPermissions('')).toThrow();
  });
});
