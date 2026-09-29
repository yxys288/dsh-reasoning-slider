/**
 * dsh-reasoning-slider — end-to-end check against the RUNNING web GUI.
 *
 * The preview harness proves the bundle renders correctly with real React and the
 * real theme tokens; it cannot prove that the *running* server is serving this
 * revision, nor that the seat really shows up in the live composer. This script
 * closes that gap: it reads the token the web server printed at startup, drives a
 * headless Chrome over CDP against the live URL, and walks the seat's own three
 * levels (collapsed -> panel -> model list -> Escape), writing a screenshot and
 * the DOM / computed-style / animation facts at every step.
 *
 * Read-only with respect to user state: the only interactions are the seat's own
 * trigger, its model row, and Escape keys. Nothing here changes the selected
 * model or effort (the model list is opened, never clicked).
 *
 * Usage:
 *   node tools/live-gui-check.mjs [--label after] [--url <url>] [--token <t>]
 *                                 [--timeout 45] [--out <dir>] [--keep-profile]
 *
 * Exit code is 1 when the seat never appears, or when an expectation fails.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
/** The package is the repository root; `DRS_REPO_ROOT` covers nested checkouts. */
const REPO_ROOT = resolve(process.env.DRS_REPO_ROOT ?? PACKAGE_ROOT)
const BUNDLE = join(PACKAGE_ROOT, 'lib', 'client.js')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const valueOf = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at === -1) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(name + ' needs a value')
  return value
}

const label = valueOf('--label', 'live')
const budgetMs = Number(valueOf('--timeout', '45')) * 1000
const outDir = resolve(valueOf('--out', join(REPO_ROOT, 'dist', 'ui-preview', 'reasoning-slider', 'live')))
const width = Number(valueOf('--width', '1040'))
const height = Number(valueOf('--height', '620'))

function findChrome() {
  const candidates = [
    process.env.DSH_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  for (const path of candidates) if (path && existsSync(path)) return path
  return null
}

/**
 * The live token.
 *
 * The web server prints its own URL once per start; the newest line in
 * web-silent.log is the one the listening process is using. The log is written
 * in the console codepage (Chinese text is mangled when read as UTF-8), but the
 * URL is pure ASCII, so the match survives.
 */
function readToken() {
  if (process.env.DSH_WEB_TOKEN) return process.env.DSH_WEB_TOKEN
  const logPath = join(homedir(), '.dsh', 'logs', 'web-silent.log')
  if (!existsSync(logPath)) return null
  const text = readFileSync(logPath, 'utf8')
  const found = text.match(/dsh web: (http:\/\/[^\s]+token=[A-Za-z0-9_-]+)/g)
  if (!found || found.length === 0) return null
  return found[found.length - 1].slice('dsh web: '.length)
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.console = []
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : String(event.data)
      let message
      try { message = JSON.parse(text) } catch { return }
      if (message.method === 'Runtime.consoleAPICalled') {
        const parts = (message.params && message.params.args ? message.params.args : [])
          .map((a) => (a && a.value !== undefined ? String(a.value) : a && a.description ? String(a.description) : ''))
        this.console.push({ type: message.params.type, text: parts.join(' ').slice(0, 400) })
        return
      }
      if (message.id === undefined) return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
  }

  send(method, params, sessionId) {
    const id = (this.nextId += 1)
    const payload = { id, method, params: params || {} }
    if (sessionId !== undefined && sessionId !== null) payload.sessionId = sessionId
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      try { this.socket.send(JSON.stringify(payload)) } catch (error) { this.pending.delete(id); rej(error) }
    })
  }
}

function openSocket(url) {
  return new Promise((res, rej) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => res(socket), { once: true })
    socket.addEventListener('error', () => rej(new Error('websocket to ' + url + ' failed')), { once: true })
  })
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

/** The probe runs INSIDE the GUI page. One expression, no template literals. */
const PROBE = [
  '(function () {',
  '  var rect = function (el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };',
  '  var pick = function (el) { if (!el) return null; var cs = getComputedStyle(el); return {',
  '    text: (el.textContent || "").trim().slice(0, 200),',
  '    rect: rect(el),',
  '    bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius,',
  '    fontSize: cs.fontSize, fontWeight: cs.fontWeight, padding: cs.padding, gap: cs.gap, display: cs.display }; };',
  '  var text = function (sel) { var el = document.querySelector(sel); return el ? (el.textContent || "").trim() : null; };',
  '  var squash = function (value) { return value === null ? null : value.replace(/\\s+/g, " ").trim().slice(0, 220); };',
  '  var root = document.querySelector(".drs-root");',
  '  var trigger = document.querySelector(".drs-trigger");',
  '  var panel = document.querySelector(".drs-panel");',
  '  var menu = document.querySelector(".drs-menu");',
  '  var range = document.querySelector(".drs-range");',
  '  var flows = Array.prototype.slice.call(document.querySelectorAll(".drs-flow-a,.drs-flow-b"));',
  '  var debug = null;',
  '  var node = document.querySelector("[data-drs-debug]");',
  '  if (node) { try { debug = JSON.parse(node.getAttribute("data-drs-debug")); } catch (e) { debug = { raw: node.getAttribute("data-drs-debug") }; } }',
  '  var active = document.activeElement;',
  '  var caret = document.querySelector(".drs-caret");',
  '  var row = document.querySelector(".drs-model-row");',
  '  return {',
  '    url: location.href.replace(/token=[^&]*/, "token=<redacted>"),',
  '    seat: root ? "present" : "absent",',
  '    triggerText: text(".drs-trigger"),',
  '    triggerModel: text(".drs-trigger-model"),',
  '    triggerEffort: text(".drs-trigger-effort"),',
  '    trigger: pick(trigger),',
  '    caretTag: caret ? caret.tagName : null,',
  '    caretIsSvg: caret ? caret.tagName.toLowerCase() === "svg" : false,',
  '    rangeCount: document.querySelectorAll("input[type=range]").length,',
  '    panelOpen: panel !== null,',
  '    panelSide: panel ? panel.getAttribute("data-drs-side") : null,',
  '    panel: panel ? pick(panel) : null,',
  '    panelText: panel ? squash(panel.textContent) : null,',
  '    panelHoldsSlider: (panel && range) ? panel.contains(range) : null,',
  '    seatHoldsSlider: (root && range) ? root.contains(range) : null,',
  '    axis: Array.prototype.slice.call(document.querySelectorAll(".drs-axis span")).map(function (s) { return (s.textContent || "").trim(); }),',
  '    modelRowText: text(".drs-model-row"),',
  '    modelRowRect: row ? rect(row) : null,',
  '    sliderWidth: range ? Math.round(range.getBoundingClientRect().width) : null,',
  '    sliderValue: range ? range.value + "/" + range.max : null,',
  '    inputHeight: range ? Math.round(range.getBoundingClientRect().height) : null,',
  '    trackPseudoHeight: (function () { if (!range) return null; try { var cs = getComputedStyle(range, "::-webkit-slider-runnable-track"); return cs ? cs.height : null; } catch (e) { return null; } })(),',
  '    ariaValueText: range ? range.getAttribute("aria-valuetext") : null,',
  '    trackRect: range ? rect(range) : null,',
  '    trackStops: (function () {',
  '      if (!range) return null;',
  '      var sizes = range.style.getPropertyValue("--drs-track-size").split(",");',
  '      var positions = range.style.getPropertyValue("--drs-track-pos").split(",");',
  '      var dots = sizes.length - 2;',
  '      var out = [];',
  '      for (var i = 0; i < dots && i < positions.length; i += 1) out.push(parseFloat(positions[i]) + 1.5);',
  '      return out;',
  '    })(),',
  '    hoverText: (function () { var el = document.querySelector(".drs-hover"); return el ? (el.textContent || "").trim() : null; })(),',
  '    hoverCentre: (function () { var el = document.querySelector(".drs-hover"); if (!el) return null; var r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); })(),',
  '    singleNote: text(".drs-single"),',
  '    menuOpen: menu !== null,',
  '    menuText: menu ? squash(menu.textContent) : null,',
  '    flowLayers: flows.map(function (el) { var cs = getComputedStyle(el); return { cls: el.className, w: Math.round(el.getBoundingClientRect().width), name: cs.animationName, duration: cs.animationDuration, delay: cs.animationDelay }; }),',
  '    flowWidth: (function () { var el = document.querySelector(".drs-flow"); return el ? Math.round(el.getBoundingClientRect().width) : null; })(),',
  '    animations: document.getAnimations().map(function (a) { var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; return { name: a.animationName || null, state: a.playState, time: Math.round(a.currentTime || 0), duration: t.duration, pseudo: a.effect && a.effect.pseudoElement ? a.effect.pseudoElement : null }; }).slice(0, 40),',
  '    activeElement: active ? (active.tagName + "." + (active.className || "")) : null,',
  '    styleTags: Array.prototype.slice.call(document.querySelectorAll("style[data-plugin-css]")).map(function (s) { return s.getAttribute("data-plugin-css"); }),',
  '    debug: debug,',
  '  };',
  '})()',
].join('\n')

async function main() {
  const chrome = findChrome()
  if (chrome === null) throw new Error('no Chrome/Edge found; set DSH_CHROME')
  const url = valueOf('--url', readToken())
  if (!url) throw new Error('no GUI url: pass --url, or make sure the web server has logged one')
  mkdirSync(outDir, { recursive: true })

  const profileDir = join(outDir, 'cdp-profile')
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--user-data-dir=' + profileDir,
    '--window-size=' + width + ',' + height,
    '--remote-debugging-port=0',
    'about:blank',
  ], { windowsHide: true })

  let stderr = ''
  const wsUrl = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('chrome never reported a DevTools endpoint: ' + stderr.slice(-400))), 20000)
    const onData = (chunk) => {
      stderr += String(chunk)
      const found = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (found) { clearTimeout(timer); res(found[1]) }
    }
    child.stderr.on('data', onData)
    child.stdout.on('data', onData)
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error('chrome exited early with ' + code + ': ' + stderr.slice(-300))) })
  })

  const socket = await openSocket(wsUrl)
  const cdp = new Cdp(socket)
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const session = attached.sessionId
  await cdp.send('Page.enable', {}, session)
  await cdp.send('Runtime.enable', {}, session)
  await cdp.send('Page.navigate', { url: url }, session)

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: false }, session)
    if (result.exceptionDetails) throw new Error('evaluate threw: ' + JSON.stringify(result.exceptionDetails).slice(0, 300))
    return result.result.value
  }
  const probe = async () => {
    const result = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: false }, session)
    if (result.exceptionDetails) throw new Error('probe threw: ' + JSON.stringify(result.exceptionDetails).slice(0, 300))
    return result.result.value
  }
  const shot = async (name, clip) => {
    const png = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip: clip } : { format: 'png' }, session)
    const path = join(outDir, label + '-' + name + '.png')
    writeFileSync(path, Buffer.from(png.data, 'base64'))
    return path
  }

  let facts = null
  const startedAt = Date.now()
  const warnings = []
  while (Date.now() - startedAt < budgetMs) {
    try { facts = await probe() } catch (error) { warnings.push(String(error.message)) }
    if (facts && facts.seat === 'present') break
    await sleep(750)
  }
  if (!facts) facts = await probe()

  const written = []
  const checks = []
  const check = (name, ok, detail) => { checks.push({ name: name, ok: ok === true, detail: detail === undefined ? null : detail }) }

  facts.collapsed = {
    triggerText: facts.triggerText,
    triggerModel: facts.triggerModel,
    triggerEffort: facts.triggerEffort,
    caretIsSvg: facts.caretIsSvg,
    caretTag: facts.caretTag,
    rangeCount: facts.rangeCount,
    panelOpen: facts.panelOpen,
    menuOpen: facts.menuOpen,
    rect: facts.trigger ? facts.trigger.rect : null,
    radius: facts.trigger ? facts.trigger.radius : null,
    bg: facts.trigger ? facts.trigger.bg : null,
    debug: facts.debug,
  }
  check('seat present in the live composer', facts.seat === 'present', facts.seat)
  check('collapsed seat holds no slider', facts.rangeCount === 0, 'rangeCount=' + facts.rangeCount)
  check('collapsed seat holds no popover', facts.panelOpen === false && facts.menuOpen === false)
  check('collapsed trigger names model and effort', Boolean(facts.triggerModel) && Boolean(facts.triggerEffort), facts.triggerText)
  check('collapsed trigger ends in an svg chevron', facts.caretIsSvg === true, facts.caretTag)
  written.push(await shot('seat'))

  if (facts.seat === 'present') {
    await evaluate('document.querySelector(".drs-trigger").click(), true')
    await sleep(700)
    const opened = await probe()
    facts.panel = {
      open: opened.panelOpen,
      side: opened.panelSide,
      rect: opened.panel ? opened.panel.rect : null,
      radius: opened.panel ? opened.panel.radius : null,
      padding: opened.panel ? opened.panel.padding : null,
      bg: opened.panel ? opened.panel.bg : null,
      axis: opened.axis,
      modelRowText: opened.modelRowText,
      modelRowRect: opened.modelRowRect,
      text: opened.panelText,
      sliderWidth: opened.sliderWidth,
      sliderValue: opened.sliderValue,
      panelHoldsSlider: opened.panelHoldsSlider,
      flowLayers: opened.flowLayers,
      flowWidth: opened.flowWidth,
      animations: opened.animations,
    }
    check('clicking the summary opens the panel', opened.panelOpen === true)
    check('the panel holds the level bar', opened.panelHoldsSlider === true)
    check('the level bar left the composer row', opened.panelHoldsSlider === true)
    check('the panel carries both axis labels', opened.axis.length === 2, JSON.stringify(opened.axis))
    check('the panel names the current model', Boolean(opened.modelRowText), opened.modelRowText)
    check('the panel is on screen', Boolean(opened.panel && opened.panel.rect.w > 0 && opened.panel.rect.h > 0))
    written.push(await shot('panel'))

    /* Freeze the drift and sweep the twinkle through both phases: with geometry
     * held still, a pixel difference between the two frames can only come from
     * the opacity animation. This is the check that catches an anti-phase pair
     * whose opacities multiply out to a constant — a bug this seat shipped once. */
    const frozen = await evaluate([
      '(function () {',
      '  var anims = document.getAnimations();',
      '  var report = { total: anims.length, drift: 0, twinkle: 0 };',
      '  anims.forEach(function (a) {',
      '    var n = a.animationName || "";',
      '    if (n === "drs-flow-a" || n === "drs-flow-b") { a.pause(); a.currentTime = 1200; report.drift += 1; }',
      '    if (n === "drs-flow-twinkle" || n === "drs-flow-twinkle-alt") { a.pause(); a.currentTime = 0; report.twinkle += 1; }',
      '  });',
      '  window.__drsFlowAnims = anims;',
      '  return report;',
      '})()',
    ].join('\n'))
    const clip = { x: opened.panel.rect.x, y: opened.panel.rect.y, width: opened.panel.rect.w, height: opened.panel.rect.h, scale: 2 }
    const frameA = await shot('twinkle-phase0', clip)
    await evaluate('(window.__drsFlowAnims || []).forEach(function (a) { var n = a.animationName || ""; if (n === "drs-flow-twinkle" || n === "drs-flow-twinkle-alt") { var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {}; a.currentTime = (t.duration || 2000) / 2; } }), true')
    const frameB = await shot('twinkle-phase1', clip)
    await evaluate('(window.__drsFlowAnims || []).forEach(function (a) { a.play() }), true')
    const bytesA = readFileSync(frameA)
    const bytesB = readFileSync(frameB)
    facts.twinkle = {
      frozen: frozen,
      phase0: frameA,
      phase1: frameB,
      bytes: [bytesA.length, bytesB.length],
      pixelsDiffer: !bytesA.equals(bytesB),
    }
    check('twinkle moves real pixels at frozen geometry', facts.twinkle.pixelsDiffer === true, 'drift=' + (frozen ? frozen.drift : '?') + ' twinkle=' + (frozen ? frozen.twinkle : '?'))
    written.push(frameA, frameB)

    // Hovering a stop names that stop. Driven with real (trusted) mouse moves
    // through the DevTools input domain, because the readout only exists while a
    // pointer is genuinely over the bar.
    // The 1.5x is thickness, not length: the bar keeps the shipped 236px and the
    // panel keeps 264px, while the control grows to 29px tall (a 21px knob in a
    // 15px track) so the knob still overflows the bar.
    check('the bar keeps its shipped width', opened.sliderWidth === 236, 'sliderWidth=' + opened.sliderWidth)
    check('the panel keeps its width', opened.panel !== null && Math.round(opened.panel.rect.w) === 264, 'panelWidth=' + (opened.panel === null ? null : Math.round(opened.panel.rect.w)))
    check('the bar is 1.5x as thick', opened.inputHeight === 29, 'inputHeight=' + opened.inputHeight + ' track=' + opened.trackPseudoHeight)
    const track = opened.trackRect
    const stops = Array.isArray(opened.trackStops) ? opened.trackStops : []
    if (track !== null && stops.length > 1) {
      const y = Math.round(track.y + track.h / 2)
      const reads = []
      for (let i = 0; i < stops.length; i += 1) {
        const x = Math.round(track.x + stops[i])
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' }, session)
        await sleep(140)
        const state = await probe()
        reads.push({ stop: i, x: x, text: state.hoverText, centre: state.hoverCentre })
        if (i === Math.floor(stops.length / 2)) written.push(await shot('hover'))
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(track.x + track.w + 80), y: y, button: 'none' }, session)
      await sleep(200)
      const left = await probe()
      const unnamed = reads.filter((read) => read.text === null || read.text === '').length
      const middle = reads[Math.floor(reads.length / 2)]
      const index = Number(String(opened.sliderValue || '0/0').split('/')[0])
      const currentRead = reads[index] === undefined ? null : reads[index].text
      facts.hover = {
        stops: stops.length,
        reads: reads,
        afterLeave: left.hoverText,
        current: { index: index, label: opened.ariaValueText, read: currentRead },
        middleCentreError: middle === undefined ? null : Math.abs(middle.centre - middle.x),
      }
      check('every stop names itself under the pointer', unnamed === 0, JSON.stringify(reads.map((read) => read.text)))
      check('the readout tracks the stop it names', facts.hover.middleCentreError !== null && facts.hover.middleCentreError <= 2, 'centreError=' + facts.hover.middleCentreError)
      check('the stop in force reads back its own name', currentRead !== null && currentRead === opened.ariaValueText, JSON.stringify(currentRead) + ' vs ' + JSON.stringify(opened.ariaValueText))
      check('leaving the bar retires the readout', left.hoverText === null, JSON.stringify(left.hoverText))
    } else {
      check('the bar exposes its stops', false, 'stops=' + stops.length)
    }

    await evaluate('document.querySelector(".drs-model-row").click(), true')
    await sleep(700)
    const models = await probe()
    facts.models = { open: models.menuOpen, text: models.menuText, panelOpen: models.panelOpen }
    check('the model row drills into the model list', models.menuOpen === true)
    written.push(await shot('models'))

    await evaluate('document.querySelector(".drs-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true')
    await sleep(400)
    const back = await probe()
    facts.afterFirstEscape = { panelOpen: back.panelOpen, menuOpen: back.menuOpen }
    await evaluate('document.querySelector(".drs-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true')
    await sleep(400)
    const closed = await probe()
    facts.closed = {
      panelOpen: closed.panelOpen,
      menuOpen: closed.menuOpen,
      rangeCount: closed.rangeCount,
      activeElement: closed.activeElement,
    }
    check('Escape leaves the composer untouched', closed.panelOpen === false && closed.menuOpen === false && closed.rangeCount === 0)
    check('Escape returns focus to the seat trigger', String(closed.activeElement || '').indexOf('drs-trigger') !== -1, closed.activeElement)
  }

  facts.provenance = {
    label: label,
    url: url.replace(/token=[^&]*/, 'token=<redacted>'),
    bundle: BUNDLE,
    bundleMd5: existsSync(BUNDLE) ? createHash('md5').update(readFileSync(BUNDLE)).digest('hex') : null,
    capturedAt: new Date().toISOString(),
    waitedMs: Date.now() - startedAt,
  }
  facts.checks = checks
  facts.console = cdp.console.filter((m) => m.type === 'error' || m.type === 'warning').slice(0, 20)
  facts.warnings = warnings.slice(0, 10)
  const jsonPath = join(outDir, label + '-facts.json')
  writeFileSync(jsonPath, JSON.stringify(facts, null, 2) + '\n')

  try { socket.close() } catch { /* closing is best effort */ }
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  if (!has('--keep-profile')) {
    setTimeout(() => { try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* best effort */ } }, 1500)
  }

  console.log('live-gui-check [' + label + '] bundle md5=' + facts.provenance.bundleMd5)
  console.log('  collapsed: ' + JSON.stringify(facts.collapsed))
  if (facts.panel) console.log('  panel: ' + JSON.stringify(facts.panel))
  if (facts.models) console.log('  models: ' + JSON.stringify(facts.models))
  if (facts.closed) console.log('  closed: ' + JSON.stringify(facts.closed))
  for (const item of checks) console.log((item.ok ? '  PASS ' : '  FAIL ') + item.name + (item.detail === null ? '' : '  [' + item.detail + ']'))
  console.log('  screenshots: ' + written.join(', '))
  console.log('  facts: ' + jsonPath)
  if (facts.console.length > 0) console.log('  console: ' + JSON.stringify(facts.console))
  if (checks.some((item) => !item.ok)) process.exitCode = 1
}

main().catch((error) => {
  console.error('live-gui-check failed: ' + (error && error.stack ? error.stack : String(error)))
  process.exitCode = 1
})
