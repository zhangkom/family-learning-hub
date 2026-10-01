import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.familylearning.study',
  appName: '一起学',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost', cleartext: false },
  android: { allowMixedContent: false },
};
export default config;
