import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  // Vite writes VITE_ variables into the page, so a build made with a model key gives that key to anyone who opens it.
  if (command === 'build' && loadEnv(mode, process.cwd(), 'VITE_').VITE_LLM_KEY) {
    console.warn(
      '\n  WARNING: VITE_LLM_KEY is set, so this build contains your language model API key in plain text.\n' +
        '  Anyone who can open the built page can read it. Build for deployment WITHOUT the key\n' +
        '  (move .env.local aside); use the key only with `npm run dev` on your own machine.\n',
    );
  }
  return {
    plugins: [react()],
    base: './',
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  };
});
