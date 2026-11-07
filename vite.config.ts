import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const sources = ['index.html', 'package.json', 'package-lock.json', 'vite.config.ts',
  'scripts/prepare-model.mjs', 'public/models/manifest.json',
  'public/models/adult-torso.json', 'public/models/torso-caps.json',
  ...readdirSync('src').filter(file => /\.(?:tsx?|jsx?|css|json)$/.test(file)).sort().map(file => `src/${file}`)];
const fingerprint = createHash('sha256');
const sourceHashes: Record<string, string> = {};
for (const file of sources) {
  const bytes = readFileSync(file);
  fingerprint.update(file).update(bytes);
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
}
const build = `pigu-${JSON.parse(readFileSync('package.json','utf8')).version}-${fingerprint.digest('hex').slice(0, 12)}`;

export default defineConfig({
  base: '/pigu/',
  define: { __PIGU_BUILD__: JSON.stringify(build) },
  plugins: [{
    name: 'pigu-build-evidence',
    generateBundle() {
      this.emitFile({ type:'asset', fileName:'assets/pigu-build.json', source: JSON.stringify({ build, sourceHashes }, null, 2) });
    },
  }],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'tissue-physics': ['cannon-es'],
        },
      },
    },
  },
});
