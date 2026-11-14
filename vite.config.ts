import { existsSync, readdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * files.json: which optional files in public/ really exist (recorded voice lines, a recorded agent session), so the
 * app asks only for those and a plain static host never answers it with a 404. Written into every build, and served
 * by the dev server, from the files on disk.
 */
function publicFiles(): Plugin {
  const list = () => ({
    vo: existsSync('public/vo')
      ? readdirSync('public/vo')
          .filter((f) => f.endsWith('.mp3'))
          .map((f) => f.slice(0, -4))
          .sort()
      : [],
    session: existsSync('public/agents/session.json'),
  });
  return {
    name: 'public-files',
    configureServer(server) {
      server.middlewares.use('/files.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(list()));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'files.json', source: JSON.stringify(list()) });
    },
  };
}

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
    plugins: [react(), publicFiles()],
    base: './',
    test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  };
});
