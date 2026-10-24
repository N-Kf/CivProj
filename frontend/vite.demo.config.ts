import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {viteSingleFile} from 'vite-plugin-singlefile';

export default defineConfig({
  plugins:[react(),viteSingleFile()],
  define:{'import.meta.env.VITE_BROWSER_DEMO':JSON.stringify('true'),'import.meta.env.VITE_ENABLE_DEMO':JSON.stringify('true')},
  build:{outDir:'../demo',emptyOutDir:false},
});
