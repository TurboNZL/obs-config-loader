// Refreshes vendor/turbothemes from a checkout of TurboNZL/turboengine (its themes/ folder).
// Usage: node scripts/sync-themes.mjs ../turboengine   (then commit, and note the engine commit in .turboengine.json)
// Why a copy: pnpm cannot fetch a repository sub-folder in every environment (CI sandboxes, offline machines),
// and a copy keeps the lockfile reproducible. Running apps still get newer themes at run time from themes/dist.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const engine = path.resolve(process.argv[2] ?? '../turboengine')
const src = path.join(engine, 'themes')
const dest = path.resolve('vendor/turbothemes')
if (!fs.existsSync(path.join(src, 'dist'))) { console.error(`No themes/dist in ${engine}`); process.exit(1) }

fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(dest, { recursive: true })
fs.cpSync(path.join(src, 'dist'), path.join(dest, 'dist'), { recursive: true })
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dest, 'LICENSE'))
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'))
for (const k of ['scripts', 'devDependencies', 'bin', 'engines', 'files']) delete pkg[k]
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
const sha = execFileSync('git', ['-C', engine, 'rev-parse', 'HEAD']).toString().trim()
console.log(`vendor/turbothemes refreshed from turboengine ${sha}. Update "engine.ref" in .turboengine.json.`)
