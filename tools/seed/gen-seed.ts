// CLI: gera supabase/seed.sql a partir do catálogo (packages/shared) e do layout do Tiled.
//   pnpm db:seed          → escreve supabase/seed.sql
//   pnpm db:seed:check    → falha se o seed.sql estiver desatualizado (usado na CI)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutPlotSlots, parseLayout } from '../../packages/shared/src/index';
import { generateSeedSql } from './seedSql';

const root = fileURLToPath(new URL('../../', import.meta.url));
const layoutPath = `${root}apps/game/public/assets/map/farm_layout.tmj`;
const seedPath = `${root}supabase/seed.sql`;

const { layout, warnings } = parseLayout(JSON.parse(readFileSync(layoutPath, 'utf8')));
for (const w of warnings) console.warn(`[layout] ${w}`);
const slots = layoutPlotSlots(layout);
if (slots.length === 0) throw new Error('o layout não tem canteiros (camada "plots")');

const sql = generateSeedSql({ slots });

if (process.argv.includes('--check')) {
  const current = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : '';
  if (current !== sql) {
    console.error('supabase/seed.sql está desatualizado. Rode: pnpm db:seed');
    process.exit(1);
  }
  console.log(`supabase/seed.sql em dia (${slots.length} canteiros).`);
} else {
  writeFileSync(seedPath, sql);
  console.log(`supabase/seed.sql gerado (${slots.length} canteiros).`);
}
