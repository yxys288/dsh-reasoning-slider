/**
 * Render the reasoning-effort seat in a real browser and capture it.
 *
 * This is the *verification* half of the plugin: it takes the shipped client
 * bundle (or any other revision of it), runs it in headless Chrome with real
 * React and the real shipped theme tokens, screenshots the whole state matrix
 * in both themes, and writes the resolved CSS facts next to the PNGs so the
 * result can be asserted rather than eyeballed.
 *
 * Usage:
 *   node tools/preview.mjs                                  # current bundle, both themes
 *   node tools/preview.mjs --bundle tools/preview/baseline/client.before.js --label before
 *   node tools/preview.mjs --only dark --keep               # one theme, keep the work dir
 *
 * Options:
 *   --bundle <path>   bundle to render            (default lib/client.js)
 *   --label <name>    output basename             (default after)
 *   --out <dir>       screenshot directory        (default ../../../dist/ui-preview/reasoning-slider, i.e. <repo>/dist/...)
 *   --only <theme>    light | dark                (default both)
 *   --react <dir>     a directory containing react/umd + react-dom/umd
 *   --theme <path>    path to dsh-client-ui-theme/lib/client.js
 *   --width/--height  viewport size               (default 920x900)
 *   --keep            keep the generated work directory
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
/**
 * Where generated evidence is written.
 *
 * The package IS the repository root in the published layout, so the default
 * needs no `../..` walk; `DRS_REPO_ROOT` exists only for checkouts that nest
 * this package inside a larger tree.
 */
const REPO_ROOT = resolve(process.env.DRS_REPO_ROOT ?? PACKAGE_ROOT)

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const valueOf = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at === -1) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

const bundlePath = resolve(valueOf('--bundle', join(PACKAGE_ROOT, 'lib', 'client.js')))
const label = valueOf('--label', 'after')
const outDir = resolve(valueOf('--out', join(REPO_ROOT, 'dist', 'ui-preview', 'reasoning-slider')))
const only = valueOf('--only', null)
const width = Number(valueOf('--width', '920'))
const height = Number(valueOf('--height', '900'))
const themes = only === null ? ['light', 'dark'] : [only]
const workDir = join(PACKAGE_ROOT, '.preview-work')

/* ------------------------------------------------------------------ *
 * Locating the browser, React and the shipped theme
 * ------------------------------------------------------------------ */

function firstExisting(paths) {
  for (const path of paths) if (path && existsSync(path)) return path
  return null
}

/**
 * Read one machine-local path override, or null when it is not configured.
 *
 * Paths that exist on exactly one developer's disk (a pnpm store, a browser
 * build) are not part of the plugin, so they live in `tools/local-paths.json`
 * — a file this repository ignores. No file or no key: every lookup falls
 * through to the generic candidates and the explicit CLI flags.
 * @param key - override name, e.g. `reactStore`.
 * @returns the configured path, or null.
 */
function localPath(key) {
  try {
    const file = join(PACKAGE_ROOT, 'tools', 'local-paths.json')
    if (!existsSync(file)) return null
    const value = JSON.parse(readFileSync(file, 'utf8'))[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function findChrome() {
  return firstExisting([
    process.env.DSH_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ])
}

/** Resolve `react` + `react-dom` UMD builds out of a pnpm store. */
function findReact() {
  const explicit = valueOf('--react', null)
  const stores = [
    explicit,
    process.env.DSH_REACT_STORE,
    localPath('reactStore'),
    join(homedir(), '.dsh', 'profiles', 'node_modules', '.pnpm'),
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '.pnpm'),
    join(REPO_ROOT, 'node_modules', '.pnpm'),
  ].filter(Boolean)

  for (const store of stores) {
    if (!existsSync(store)) continue
    let entries
    try {
      entries = readdirSync(store)
    } catch {
      continue
    }
    const reactDir = entries.find((name) => name.startsWith('react@'))
    const reactDomDir = entries.find((name) => name.startsWith('react-dom@'))
    if (reactDir === undefined || reactDomDir === undefined) continue
    const reactUmd = join(store, reactDir, 'node_modules', 'react', 'umd', 'react.development.js')
    const reactDomUmd = join(store, reactDomDir, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js')
    if (existsSync(reactUmd) && existsSync(reactDomUmd)) {
      return { store, react: reactUmd, reactDom: reactDomUmd }
    }
  }
  return null
}

/** Path of the shipped theme bundle relative to the package that carries it. */
const THEME_REL = ['@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js']

/**
 * Candidate npm global prefixes, most specific first.
 *
 * Nothing here names a person or a drive: the prefix is either configured
 * (`DSH_NPM_PREFIX`, npm's own `npm_config_prefix`, or the ignored
 * `tools/local-paths.json`) or derived from the platform's conventional
 * location.
 * @returns existing prefix candidates in probe order.
 */
function npmPrefixes() {
  return [
    process.env.DSH_NPM_PREFIX,
    process.env.npm_config_prefix,
    localPath('npmPrefix'),
    join(homedir(), 'npm-global'),
    process.env.APPDATA === undefined ? null : join(process.env.APPDATA, 'npm'),
    '/usr/local',
    '/usr',
  ].filter(Boolean)
}

/** Resolve the shipped theme bundle that owns the `--dsw-*` palette. */
function findTheme() {
  const explicit = valueOf('--theme', null)
  const candidates = [
    explicit,
    process.env.DSH_THEME,
    localPath('theme'),
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', ...THEME_REL),
    join(homedir(), '.dsh', 'profiles', 'node_modules', ...THEME_REL),
    // A globally installed dsh carries its packages one level down.
    ...npmPrefixes().flatMap((prefix) => [
      join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...THEME_REL),
      join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', ...THEME_REL),
      join(prefix, 'lib', 'node_modules', ...THEME_REL),
    ]),
  ].filter(Boolean)
  return firstExisting(candidates)
}

/**
 * Pull the shipped palette out of the theme bundle.
 *
 * The theme ships its CSS as plain string literals, so the literal is read back
 * with `JSON.parse` rather than re-typed here — the preview must use the same
 * colour values the GUI does, or it proves nothing.
 */
function extractThemeCss(themeClientPath) {
  const source = readFileSync(themeClientPath, 'utf8')
  const marker = 'var design_platform_css_default = '
  const at = source.indexOf(marker)
  if (at === -1) throw new Error(`design_platform_css_default not found in ${themeClientPath}`)
  const quote = source.indexOf('"', at + marker.length)
  let end = -1
  for (let i = quote + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '"') { end = i; break }
  }
  if (end === -1) throw new Error('unterminated design_platform_css_default literal')
  const css = JSON.parse(source.slice(quote, end + 1))
  const bodyCount = (css.match(/body\{/g) ?? []).length
  return { css, bodyCount }
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

/**
 * Run one headless capture.
 *
 * The page is loaded over `file://`, not over a local HTTP server: on this host
 * Chrome's network service never comes up (it hangs before the first request —
 * a probe against a counting server recorded zero hits), while `file://` loads
 * the same multi-file page in under a second. `--headless=new` is avoided for
 * the same reason: it never exits once `--screenshot` and `--dump-dom` are
 * combined.
 * @returns `{ ok, status, stdout, stderr, screenshot }`.
 */
function capture(chrome, url, screenshotPath, profileDir, options = {}) {
  const viewportHeight = options.height ?? height
  const budget = options.budget ?? 5000
  const result = spawnSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--allow-file-access-from-files',
    // Grayscale text antialiasing: subpixel (LCD) rendering paints coloured
    // fringes on glyph edges, which would otherwise dominate the pixel audit
    // and hide the question the audit exists to answer.
    '--disable-lcd-text',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=2',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${viewportHeight}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${screenshotPath}`,
    '--dump-dom',
    url,
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true })

  return {
    ok: result.status === 0 && existsSync(screenshotPath),
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    screenshot: screenshotPath,
  }
}

/** Decode the base64 facts sink `<pre id="facts">` out of a dumped DOM. */
function readFacts(dom) {
  const match = /<pre id="facts"[^>]*>([A-Za-z0-9+/=]+)<\/pre>/.exec(dom)
  if (match === null) return null
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

/** Decode the pixel audit's `<pre id="pixels">` sink out of a dumped DOM. */
function readPixels(dom) {
  const match = /<pre id="pixels"[^>]*>([A-Za-z0-9+/=]+)<\/pre>/.exec(dom)
  if (match === null) return null
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

/**
 * Measure the colour actually present in a captured PNG.
 *
 * Renders the image into a canvas and counts vividly-tinted pixels and the hues
 * they occupy — the objective form of the claim "the hue ramp is gone".
 * @returns the pixel statistics, or null when the page produced no sink.
 */
function auditPixels(chrome, pngPath, pageFile, profileDir, regions) {
  const imageUrl = `file:///${pngPath.replaceAll('\\', '/')}`
  let url = `file:///${pageFile.replaceAll('\\', '/')}?src=${encodeURIComponent(imageUrl)}`
  if (regions.length > 0) url += `&regions=${encodeURIComponent(JSON.stringify(regions))}`
  const result = spawnSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--virtual-time-budget=15000',
    '--dump-dom',
    `--user-data-dir=${profileDir}-pixels`,
    url,
  ], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (result.status !== 0) return null
  return readPixels(result.stdout ?? '')
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const chrome = findChrome()
if (chrome === null) throw new Error('no Chrome/Edge found; pass DSH_CHROME=/path/to/chrome')

const react = findReact()
if (react === null) throw new Error('no react/react-dom UMD build found; pass --react <pnpm store dir>')

const themeClient = findTheme()
if (themeClient === null) throw new Error('dsh-client-ui-theme/lib/client.js not found; pass --theme <path>')

if (!existsSync(bundlePath)) throw new Error(`bundle not found: ${bundlePath}`)

// Stamp every artifact with the exact bytes it describes. Without this a stale
// `*.pixels.json` from an earlier run is indistinguishable from fresh evidence.
const bundleMd5 = createHash('md5').update(readFileSync(bundlePath)).digest('hex')
const provenance = {
  bundle: bundlePath,
  bundleMd5,
  label,
  chrome,
  themeClient,
  capturedAt: new Date().toISOString(),
}

const theme = extractThemeCss(themeClient)

console.log('preview: inputs')
console.log('  bundle  ', bundlePath)
console.log('  chrome  ', chrome)
console.log('  react   ', react.react)
console.log('  theme   ', themeClient, `(${theme.bodyCount} body blocks, ${theme.css.length} chars)`)

rmSync(workDir, { recursive: true, force: true })
mkdirSync(workDir, { recursive: true })

cpSync(join(HERE, 'preview', 'index.html'), join(workDir, 'index.html'))
cpSync(join(HERE, 'preview', 'harness.js'), join(workDir, 'harness.js'))
cpSync(join(HERE, 'preview', 'pixels.html'), join(workDir, 'pixels.html'))
cpSync(bundlePath, join(workDir, 'seat.js'))
cpSync(react.react, join(workDir, 'react.js'))
cpSync(react.reactDom, join(workDir, 'react-dom.js'))
writeFileSync(join(workDir, 'theme.css'), theme.css, 'utf8')

mkdirSync(outDir, { recursive: true })

const profileRoot = join(workDir, 'chrome-profile')
const pagePath = join(workDir, 'index.html').replaceAll('\\', '/')
let failures = 0

for (const themeName of themes) {
  const screenshot = join(outDir, `${label}-${themeName}.png`)
  const url = `file:///${pagePath}?theme=${themeName}`
  console.log(`preview: capturing ${themeName} → ${screenshot}`)
  // A profile per capture: reusing one directory makes the second launch hand
  // off to the still-running first instance (Chrome's process singleton), which
  // returns success and writes a screenshot but emits no DOM at all.
  const profileDir = join(profileRoot, themeName)
  rmSync(profileDir, { recursive: true, force: true })
  const result = capture(chrome, url, screenshot, profileDir)

  if (!result.ok) {
    failures += 1
    console.error(`  capture failed (exit ${result.status})`)
    if (result.stderr.trim() !== '') console.error('  ' + result.stderr.trim().split('\n').slice(-6).join('\n  '))
    continue
  }

  const facts = readFacts(result.stdout)
  if (facts === null) {
    // Keep the raw dump: without it a missing sink is unfalsifiable.
    writeFileSync(join(outDir, `${label}-${themeName}.dom.html`), result.stdout, 'utf8')
    console.warn(`  no facts sink in the dumped DOM (${result.stdout.length} chars, mentions "facts": ${result.stdout.includes('facts')})`)
    console.warn(`  raw DOM kept at ${label}-${themeName}.dom.html`)
    continue
  }
  writeFileSync(
    join(outDir, `${label}-${themeName}.facts.json`),
    `${JSON.stringify({ provenance, ...facts }, null, 2)}\n`,
    'utf8',
  )

  const sliders = facts.rows.filter((row) => row.slider === true)
  console.log(`  ok — ${facts.rows.length} rows, ${sliders.length} sliders, ${facts.problems.length} page problems`)
  if (facts.problems.length > 0) for (const problem of facts.problems) console.error('    ! ' + problem)
  for (const slider of sliders) {
    // The generated layer lists live in the `--drs-*` custom properties: the
    // input's own `background-*` computed style describes the input box, not
    // the `::-webkit-slider-runnable-track` the layers are painted onto.
    console.log(`    row ${slider.row}: value ${slider.value}/${slider.max} label=${JSON.stringify(slider.label)} layers=${slider.trackBackgroundSize.split(',').length} fill=${slider.trackBackgroundSize.split(',').slice(-1)[0]}`)
  }

  for (const row of facts.rows) {
    // Collapsed rows carry no bar; their trigger is what the audit measures.
    console.log(`    row ${row.row}: trigger=${JSON.stringify(row.trigger)} effort=${JSON.stringify(row.effortLabel)} caret=<${row.caretTag}> expanded=${row.ariaExpanded} slider=${row.slider} modelClipped=${row.modelClipped} effortClipped=${row.effortClipped}`)
  }

  // Crop the audit to each row's control box — the bar when the panel is open,
  // the trigger when it is not — so the measurement is the control's colour and
  // not the page's text antialiasing. A collapsed matrix would otherwise leave
  // `regions` empty and silently degrade the audit to whole-page statistics.
  const regions = []
  for (const row of facts.rows) {
    if (row.rect === null || row.rect === undefined) continue
    const scale = typeof row.dpr === 'number' && row.dpr > 0 ? row.dpr : 1
    regions.push([
      Math.floor(row.rect.x * scale),
      Math.floor(row.rect.y * scale),
      Math.ceil(row.rect.width * scale),
      Math.ceil(row.rect.height * scale),
    ])
  }

  const pixels = auditPixels(chrome, screenshot, join(workDir, 'pixels.html'), profileDir, regions)
  if (pixels === null || typeof pixels.error === 'string') {
    // Fail loudly: a missing measurement must not leave the previous run's
    // `*.pixels.json` behind to be mistaken for this run's evidence.
    failures += 1
    console.error(`  pixel audit produced no result${pixels === null ? '' : `: ${pixels.error}`}`)
  } else {
    writeFileSync(
      join(outDir, `${label}-${themeName}.pixels.json`),
      `${JSON.stringify({ provenance, ...pixels }, null, 2)}\n`,
      'utf8',
    )
    console.log(`    pixels: ${pixels.vividPixels}/${pixels.opaquePixels} vivid (${pixels.vividShare}) over ${pixels.regions} slider boxes, hues=${pixels.occupiedHueBuckets}, maxSat=${pixels.maxSaturation}, meanSat=${pixels.meanSaturation}`)
  }

  // The model menu, opened by a real click. The unit suite drives a single-pass
  // renderer, so its `open === true` branch is structurally unreachable there;
  // this capture is the coverage for that half of the seat.
  const menuShot = join(outDir, `${label}-${themeName}-menu.png`)
  const menuUrl = `file:///${pagePath}?theme=${themeName}&menu=1`
  const menuProfile = join(profileRoot, `${themeName}-menu`)
  rmSync(menuProfile, { recursive: true, force: true })
  const menuResult = capture(chrome, menuUrl, menuShot, menuProfile, { budget: 8000 })
  const menuFacts = menuResult.ok ? readFacts(menuResult.stdout) : null
  if (menuFacts === null || menuFacts.menu === null || menuFacts.menu.open !== true) {
    failures += 1
    console.error('  menu capture failed to open the model menu')
  } else {
    writeFileSync(
      join(outDir, `${label}-${themeName}-menu.facts.json`),
      `${JSON.stringify({ provenance, ...menuFacts }, null, 2)}\n`,
      'utf8',
    )
    const menu = menuFacts.menu
    console.log(`    menu: open=${menu.open} groups=${menu.groups} options=${menu.options} checked=${menu.checked} labels=${JSON.stringify(menu.labels)}`)
  }

  // The panel, opened by a real click. This is the level the bar lives on now,
  // so it is the only capture whose pixel audit can actually see the accent
  // blue. Two placements are captured: the default (room above, opens upward)
  // and `dir=down` (no room above, so the panel has to flip below the trigger).
  const panelRuns = [
    { suffix: 'panel', query: 'panel=1', side: 'top', audit: true },
    { suffix: 'panel-down', query: 'panel=1&dir=down', side: 'bottom', audit: false },
  ]
  for (const run of panelRuns) {
    const shot = join(outDir, `${label}-${themeName}-${run.suffix}.png`)
    const runProfile = join(profileRoot, `${themeName}-${run.suffix}`)
    const evidence = join(outDir, `${label}-${themeName}-${run.suffix}.pixels.json`)
    rmSync(runProfile, { recursive: true, force: true })
    // A run that does not audit must not leave an older run's measurement behind
    // to be read as this run's evidence.
    if (run.audit !== true) rmSync(evidence, { force: true })

    const result = capture(chrome, `file:///${pagePath}?theme=${themeName}&${run.query}`, shot, runProfile, { budget: 8000 })
    const openFacts = result.ok ? readFacts(result.stdout) : null
    const row = openFacts === null || !Array.isArray(openFacts.rows) ? undefined : openFacts.rows[0]
    if (openFacts === null || openFacts.panelMode !== true || row === undefined || row.panel === null || row.panel === undefined) {
      failures += 1
      console.error(`  ${run.suffix} capture did not open the panel`)
      continue
    }
    writeFileSync(
      join(outDir, `${label}-${themeName}-${run.suffix}.facts.json`),
      `${JSON.stringify({ provenance, ...openFacts }, null, 2)}\n`,
      'utf8',
    )
    const panel = row.panel
    console.log(`    ${run.suffix}: side=${panel.side} (want ${run.side}) ${panel.width}x${panel.height} @ ${panel.rect.x.toFixed(1)},${panel.rect.y.toFixed(1)} onScreen=${panel.onScreen} radius=${panel.radius} pad=${panel.padding} axis=${JSON.stringify(panel.axis)} modelRow=${JSON.stringify(panel.modelRow)}@${panel.modelRowHeight}px chevron=<${panel.chevron}>`)
    console.log(`      trigger=${JSON.stringify(row.trigger)} caret=<${row.caretTag}> title=${JSON.stringify(row.triggerTitle)} track=${row.trackBackgroundSize} fill=${row.trackBackgroundSize.split(',').slice(-1)[0]}`)
    if (panel.side !== run.side || panel.onScreen !== true) {
      failures += 1
      console.error(`  ${run.suffix}: the panel did not open toward the ${run.side} as expected`)
    }
    if (row.slider !== true) {
      failures += 1
      console.error(`  ${run.suffix}: the panel rendered no reasoning bar`)
      continue
    }

    // "Hovering a stop names that stop": driven with real pointer events inside
    // the page and read back from the floating readout. The stop in force must
    // read back its own name, which needs no fixture knowledge.
    const hover = openFacts.hover
    if (hover === null || hover === undefined || !Array.isArray(hover.steps) || hover.steps.length < 2) {
      failures += 1
      console.error('  ' + run.suffix + ': no hover readout was produced')
    } else {
      const texts = hover.steps.map((step) => (step.read === null ? null : step.read.text))
      const named = texts.filter((text) => typeof text === 'string' && text.length > 0).length
      const currentStep = hover.steps[hover.current.index]
      const currentText = currentStep === undefined || currentStep.read === null ? null : currentStep.read.text
      const mid = hover.steps[Math.floor(hover.steps.length / 2)]
      const midOffset = mid === undefined || mid.read === null ? null : Math.abs(mid.read.centre - mid.x)
      console.log('    hover: ' + JSON.stringify(texts) + ' centre-error=' + (midOffset === null ? 'n/a' : midOffset.toFixed(2)) + 'px current=' + JSON.stringify(currentText) + '/' + JSON.stringify(hover.current.label) + ' afterLeave=' + JSON.stringify(hover.afterLeave))
      if (named !== texts.length) {
        failures += 1
        console.error('  ' + run.suffix + ': every stop must name itself; got ' + JSON.stringify(texts))
      }
      if (currentText !== hover.current.label) {
        failures += 1
        console.error('  ' + run.suffix + ': hovering the stop in force read ' + JSON.stringify(currentText) + ', not ' + JSON.stringify(hover.current.label))
      }
      if (midOffset === null || midOffset > 1.5) {
        failures += 1
        console.error('  ' + run.suffix + ': the readout is not centred on the stop it names (' + midOffset + ')')
      }
      if (hover.afterLeave !== null) {
        failures += 1
        console.error('  ' + run.suffix + ': the readout survived the pointer leaving the bar')
      }
    }
    if (run.audit !== true) continue

    // The claim this capture exists for: inside the bar's box there is exactly
    // one hue bucket — a single accent blue, no ramp.
    const scale = typeof row.dpr === 'number' && row.dpr > 0 ? row.dpr : 1
    const barBox = [[
      Math.floor(row.rect.x * scale),
      Math.floor(row.rect.y * scale),
      Math.ceil(row.rect.width * scale),
      Math.ceil(row.rect.height * scale),
    ]]
    const panelPixels = auditPixels(chrome, shot, join(workDir, 'pixels.html'), runProfile, barBox)
    if (panelPixels === null || typeof panelPixels.error === 'string') {
      failures += 1
      console.error(`  ${run.suffix} pixel audit produced no result${panelPixels === null ? '' : `: ${panelPixels.error}`}`)
      continue
    }
    writeFileSync(evidence, `${JSON.stringify({ provenance, ...panelPixels }, null, 2)}\n`, 'utf8')
    console.log(`      pixels: ${panelPixels.vividPixels}/${panelPixels.opaquePixels} vivid (${panelPixels.vividShare}) over ${panelPixels.regions} bar box, hues=${panelPixels.occupiedHueBuckets}, maxSat=${panelPixels.maxSaturation}, meanSat=${panelPixels.meanSaturation}`)
  }

  // The focus contract, read off `document.activeElement`. Restoring focus is a
  // layout effect, which the unit suite's single-pass renderer never runs — so
  // this run is the behaviour's only evidence.
  const focusShot = join(outDir, `${label}-${themeName}-focus.png`)
  const focusProfile = join(profileRoot, `${themeName}-focus`)
  rmSync(focusProfile, { recursive: true, force: true })
  const focusResult = capture(chrome, `file:///${pagePath}?theme=${themeName}&focus=1`, focusShot, focusProfile, { budget: 8000 })
  const focusFacts = focusResult.ok ? readFacts(focusResult.stdout) : null
  const steps = focusFacts === null || !Array.isArray(focusFacts.focus) ? null : focusFacts.focus
  if (focusFacts !== null) {
    // Written even when the assertions below fail: a missing log is unfalsifiable
    // without the raw facts next to it.
    writeFileSync(
      join(outDir, `${label}-${themeName}-focus.facts.json`),
      `${JSON.stringify({ provenance, ...focusFacts }, null, 2)}\n`,
      'utf8',
    )
  }
  if (steps === null || steps.length < 4) {
    failures += 1
    console.error(`  focus capture produced no focus log (steps=${steps === null ? 'null' : steps.length}, focusStep=${focusFacts === null ? 'no facts' : focusFacts.focusStep})`)
  } else {
    const owner = (step) => (step.isTrigger ? 'trigger' : step.inPanel ? '.drs-panel' : step.tag)
    console.log(`    focus: ${steps.map((step) => `${step.label}=${step.view}/${owner(step)}`).join(' → ')}`)
    const wanted = [
      ['after-open', (step) => step.view === 'panel' && step.inPanel === true, 'opening moves focus into the panel'],
      ['after-escape', (step) => step.view === 'closed' && step.isTrigger === true, 'Esc hands focus back to the trigger'],
      ['after-reopen', (step) => step.view === 'panel' && step.inPanel === true, 'reopening takes focus in again'],
      ['after-outside-mousedown', (step) => step.view === 'closed' && step.isTrigger !== true, 'an outside click does not steal focus back'],
    ]
    for (const [name, ok, why] of wanted) {
      const step = steps.find((candidate) => candidate.label === name)
      if (step === undefined || ok(step) !== true) {
        failures += 1
        console.error(`  focus ${name}: ${why} — got ${JSON.stringify(step)}`)
      }
    }
  }
}

if (has('--keep') !== true) rmSync(workDir, { recursive: true, force: true })
console.log(failures === 0 ? 'preview: done' : `preview: ${failures} capture(s) failed`)
process.exit(failures === 0 ? 0 : 1)
