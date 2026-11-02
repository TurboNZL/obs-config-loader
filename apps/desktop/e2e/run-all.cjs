// Runs every end-to-end script in turn (each starts the real app). On a machine without a display:  xvfb-run -a pnpm e2e
// OBSCL_PACKAGED=<path to the packaged binary> runs them against an installed build instead of the source tree.
const { spawnSync } = require('child_process')
const path = require('path')
const scripts = ['e2e.cjs', 'e2e-keys.cjs', 'e2e-git.cjs', 'e2e-presets.cjs', 'e2e-instances.cjs', 'e2e-ui.cjs']
let failed = 0
for (const s of scripts) {
  console.log(`\n===== ${s} =====`)
  const r = spawnSync('node', [path.join(__dirname, s)], { stdio: 'inherit' })
  if (r.status !== 0) { failed++; console.log(`***** ${s} FAILED (exit ${r.status})`) }
}
console.log(failed ? `\n${failed} of ${scripts.length} end-to-end scripts failed` : `\nall ${scripts.length} end-to-end scripts passed`)
process.exit(failed ? 1 : 0)
