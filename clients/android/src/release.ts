import { version } from '../package.json';

export const appVersion = version;
export const familyWebsite = 'https://123.207.232.151/family-learning/';
export const configuredServer =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? `${familyWebsite}api/mobile/v1` : '');
