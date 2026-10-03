import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: `${process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning'}/web-client/`,
  define: {
    'import.meta.env.VITE_FAMILY_WEB': JSON.stringify('true'),
    'import.meta.env.VITE_WEB_BASE_PATH': JSON.stringify(process.env.NEXT_PUBLIC_BASE_PATH || '/family-learning'),
  },
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('../../public/web-client', import.meta.url)),
    emptyOutDir: true,
    manifest: 'manifest.json',
    rolldownOptions: {
      input: fileURLToPath(new URL('./src/web-entry.tsx', import.meta.url)),
      preserveEntrySignatures: 'strict',
    },
  },
});
