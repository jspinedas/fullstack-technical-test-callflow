import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  return {
    plugins: [react()],
    envDir: '../..',
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${env.API_PORT ?? 3000}` } },
    },
    test: { environment: 'jsdom', clearMocks: true },
  };
});
