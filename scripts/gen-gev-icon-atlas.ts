/**
 * Renders the GEV asset icon atlas to public/gev-icons.png.
 * Run after editing art in src/components/gev/gev-asset-icons.ts:
 *   npx tsx scripts/gen-gev-icon-atlas.ts
 */
import { chromium } from '@playwright/test';
import { gevAtlasLayout } from '../src/components/gev/gev-asset-icons';

const { svg, width, height } = gevAtlasLayout();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: 'public/gev-icons.png', omitBackground: true });
await browser.close();
console.log(`wrote public/gev-icons.png (${width}x${height})`);
