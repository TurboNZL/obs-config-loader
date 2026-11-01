// The in-app guides and the optional theme-drawn window frame, through the screens.
//   xvfb-run -a node e2e/e2e-ui.cjs   (after `pnpm --filter @obs-config-loader/desktop build`)
const { _electron: electron } = require('playwright')
const fs = require('fs'), path = require('path'), os = require('os')
const APP = path.resolve(__dirname, '..')
const OUT = path.join(os.tmpdir(), 'obscl-e2e-shots')
fs.mkdirSync(OUT, { recursive: true })
const check = (name, cond) => { console.log(cond ? '  ok  ' : '  FAIL', name); if (!cond) process.exitCode = 1 }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ui-'))
const home = path.join(root, 'home'); fs.mkdirSync(home)
const ud = path.join(root, 'ud')
const launch = () => electron.launch({
  executablePath: process.env.OBSCL_PACKAGED || APP + '/node_modules/electron/dist/electron',
  args: [...(process.env.OBSCL_PACKAGED ? [] : [APP]), '--no-sandbox', '--user-data-dir=' + ud],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: '' },
})

;(async () => {
  console.log('1. guides: bundled, listed, rendered, and links between them work')
  let app = await launch(); let page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.waitForSelector('nav >> text=Help')
  await page.click('nav >> text=Help')
  await page.waitForSelector('article.guide h1')
  check('getting started is open and rendered', (await page.locator('article.guide h1').first().innerText()).length > 0)
  const items = await page.locator('nav[aria-label="Guides"] button').allInnerTexts()
  check('lists getting started and the readme', items.includes('Getting started') && items.includes('About OBS Config Loader'))
  await page.click('nav[aria-label="Guides"] >> text=About OBS Config Loader')
  // the guide loads asynchronously: wait for the thing we are about to check, not for text the previous guide may also have
  const gotTable = await page.waitForSelector('article.guide table', { timeout: 15000 }).then(() => true, () => false)
  check('the readme renders its install table', gotTable)
  check('no script or raw HTML got through', (await page.locator('article.guide script').count()) === 0)
  await page.screenshot({ path: OUT + '/u1-guides.png', fullPage: true })

  console.log('2. the system frame is the default: nothing drawn by the page')
  check('no themed title bar by default', (await page.locator('.bt-wf').count()) === 0)

  console.log('3. the updates card is there, and says plainly it does nothing in a development run')
  await page.click('nav >> text=About')
  await page.waitForSelector('text=App updates')
  await page.click('button:has-text("Check for updates")')
  // a development run says it is off; an installed build really checks (and in a sandbox without GitHub it ends in an error): wait for an answer
  await page.waitForFunction(() => /development run|latest version|Could not check|still being built/.test(document.body.innerText), null, { timeout: 60000 })
  check('updates card shows an answer', true)

  console.log('4. turn the themed title bar on: asks for a restart, then appears')
  await page.click('nav >> text=Look')
  await page.check('text=Draw the window\'s title bar with the theme')
  await page.waitForSelector('text=applies the next time')
  await app.close()
  app = await launch(); page = await app.firstWindow()
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.waitForSelector('.bt-wf')
  check('the themed title bar is drawn', (await page.locator('.bt-wf .bt-wf-btn').count()) === 3)
  check('with the app name', (await page.locator('.bt-wf-title').innerText()) === 'OBS Config Loader')
  await page.screenshot({ path: OUT + '/u2-frame.png', fullPage: true })
  const frameless = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w.getBounds().height - w.getContentBounds().height })
  check('the system frame is really gone', frameless === 0)

  console.log('5. its close button closes the window and the app')
  const closed = new Promise((r) => app.process().once('exit', r))
  await page.click('.bt-wf-close')
  await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('app did not exit')), 15000))])
  check('app exited', true)
  console.log(process.exitCode ? 'E2E-UI FAILED' : 'E2E-UI OK')
})().catch((e) => { console.error('E2E-UI FAIL', e.message); process.exit(1) })
