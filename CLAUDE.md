# Grid's Eye View

Energy infrastructure dashboard forked from koala73/worldmonitor.

## Critical rules
- NEVER modify: DeckGLMap.ts, Map.ts, GlobeMap.ts, data-loader.ts
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

## Current state
- Energy variant working with US power plants and transmission lines
- Rebranded as Grid's Eye View
- Deployed on Vercel at gridseyeview.vercel.app
