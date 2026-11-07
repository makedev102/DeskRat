import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// DeskRat uses 1433; upstream DeskPartner uses 1432.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // Не следим за src-tauri: туда пишет компилятор Rust, и Vite ругается на занятые файлы.
  server: { port: 1433, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'] },
});
