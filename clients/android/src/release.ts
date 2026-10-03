import { version, androidVersionCode } from '../package.json';
import { isHostedWeb, hostedApiBase } from './hosted-web';

export const appVersion = version;
export const appName = '知识棱镜AI';
export const appVersionCode = androidVersionCode;
export const familyWebsite = 'https://123.207.232.151/family-learning/';
export const updateManifestUrl = `${familyWebsite}downloads/android/latest.json`;
export const configuredServer =
  (isHostedWeb ? hostedApiBase() : import.meta.env.VITE_API_URL) ||
  (import.meta.env.PROD ? `${familyWebsite}api/mobile/v1` : '');
