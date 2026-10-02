import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cn.familylearning.study',
  appName: '知识棱镜AI',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost', cleartext: false },
  android: { allowMixedContent: false },
};
export default config;
