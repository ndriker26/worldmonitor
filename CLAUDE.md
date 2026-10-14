# Grid's Eye View

Energy infrastructure dashboard forked from koala73/worldmonitor.

## Critical rules
- NEVER modify: DeckGLMap.ts, Map.ts, GlobeMap.ts, data-loader.ts
  - One approved exception: DeckGLMap.ts calls into src/components/gev/gev-asset-icons.ts for the energy variant's plant and field icon layers. Edit the icons there, not in DeckGLMap.
- NEVER modify files in: services/, api/, server/
- All UI changes must be scoped to the energy variant (SITE_VARIANT === 'energy')
- The map rendering, layer toggling, and popup system must keep working
- Run npm run dev:energy to test the energy variant
- Run npm run dev to verify the default variant still works

## Architecture
- Variant system in src/config/variant.ts
- Energy variant config in src/config/variants/energy.ts
- Map layers defined in src/config/map-layer-definitions.ts
- Layout in src/app/panel-layout.ts
- Main entry in src/App.ts

## GEM data pipeline
- Pipeline and oil/gas field data lives in public/data/gem-pipelines.json and public/data/gem-fields.json
- Loaded asynchronously at runtime via src/config/gem-data.ts (NOT bundled into JS)
- To regenerate: node scripts/gen-gem-json.cjs (reads src/config/global-*.ts → public/data/)
- src/config/global-pipelines.ts and global-oilgas-fields.ts are now stub files (empty arrays)

## GEV design layer
- src/styles/gev-redesign.css: atlas look (fonts, palette, floating islands, motion). Loaded after gev-shell.css.
- src/components/gev/GevStory.ts + src/config/gev-stories.ts: guided stories. New story = new data in gev-stories.ts.
- Asset icons: SVG art in gev-asset-icons.ts, shipped as public/gev-icons.png. After editing art run: npx tsx scripts/gen-gev-icon-atlas.ts
- Add ?nostory to the URL to skip the story while developing.

## Current state
- Energy variant working with US power plants and transmission lines
- Rebranded as Grid's Eye View
- Deployed on Vercel at gridseyeview.vercel.app
