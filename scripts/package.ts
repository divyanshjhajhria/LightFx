// npm run package: build with no model key and zip dist/ into lightspeed-fx-demo.zip, ready to hand over or host.
// The key variables are set empty for the build, which overrides .env.local; then every built file is checked for any
// key configured on this machine, and the zip is refused if one is found.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ZIP = 'lightspeed-fx-demo.zip';
const env = { ...process.env, VITE_LLM_KEY: '', VITE_LLM_PROVIDER: '', VITE_LLM_MODEL: '' };

execFileSync('npx', ['tsc', '--noEmit'], { stdio: 'inherit', env });
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', env });

// Any key configured here, from the shell or .env.local, must not be in the build.
const keys = [process.env.VITE_LLM_KEY];
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*VITE_LLM_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) keys.push(m[1].replace(/^["']|["']$/g, ''));
  }
}
const secrets = keys.filter((k): k is string => !!k && k.length >= 8);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
for (const f of files('dist')) {
  const text = readFileSync(f, 'latin1');
  if (secrets.some((k) => text.includes(k))) {
    console.error(`\n  REFUSED: ${f} contains a model key. Nothing was zipped.\n`);
    process.exit(1);
  }
}

rmSync(ZIP, { force: true });
execFileSync('zip', ['-r', '-X', '-q', join('..', ZIP), '.'], { cwd: 'dist', stdio: 'inherit' });
console.log(`\n  ${ZIP}: ${(statSync(ZIP).size / 1024).toFixed(0)} KB, built with no model key. Serve its contents from any static host.\n`);
