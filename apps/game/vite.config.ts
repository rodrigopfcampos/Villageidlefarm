import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * SÓ EM `pnpm dev`: serve uma prévia em /__dev/ usando o JPG original (assets-src/raw) e o layout
 * de exemplo dos testes, sem escrever nada em public/assets. Abra http://localhost:5173/?dev-assets
 */
function devPreviewAssets(): Plugin {
  const mime: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return {
    name: 'vif-dev-preview-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/', (req, res) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
        if (path === 'manifest.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              map: {
                image: 'raw/mapa_do_jogo.jpg',
                layout: 'layout.tmj',
                width: 2576,
                height: 1438,
              },
              atlases: [],
            }),
          );
          return;
        }
        if (path === 'layout.tmj') {
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(`${repoRoot}packages/shared/test/fixtures/farm_layout.min.tmj`));
          return;
        }
        if (path.startsWith('raw/')) {
          const file = `${repoRoot}assets-src/raw/${basename(path)}`; // basename impede "../"
          const type = mime[extname(file).toLowerCase()];
          if (type && existsSync(file)) {
            res.setHeader('Content-Type', type);
            res.end(readFileSync(file));
            return;
          }
        }
        res.statusCode = 404;
        res.end('not found');
      });
    },
  };
}

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer subpasta (Netlify, Vercel, GitHub Pages).
  base: './',
  plugins: [devPreviewAssets()],
  server: { host: true },
  build: {
    target: 'es2022',
    // JS/CSS do build ficam em _app/ para não misturar com public/assets (arte gerada pelo A1).
    assetsDir: '_app',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
