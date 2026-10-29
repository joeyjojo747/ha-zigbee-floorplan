import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  // Relative asset URLs so the UI works behind the HA ingress path prefix.
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
