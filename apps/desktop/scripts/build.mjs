// Builds main + preload with esbuild (core is bundled in), the renderer with Vite.
import { build as esbuild } from 'esbuild'
import { build as vite } from 'vite'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'info' }

await esbuild({ ...common, entryPoints: [path.join(root, 'electron/main.ts')], outfile: path.join(root, 'out/main/main.cjs') })
await esbuild({ ...common, entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(root, 'out/preload/preload.cjs') })
await vite({ root: path.join(root, 'src/renderer'), configFile: path.join(root, 'vite.config.ts') })
