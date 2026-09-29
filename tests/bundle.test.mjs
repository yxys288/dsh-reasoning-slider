/**
 * Contract tests for dsh-reasoning-slider.
 *
 * These run the *shipped* bundle (`lib/client.js`) — not a copy — inside a
 * `node:vm` sandbox that mimics the browser module loader, and drive the real
 * component with a miniature React. They exist to pin the two things that
 * could take the Web GUI down:
 *
 *   1. the bundle's shape (loader registration id, exports, the module
 *      requests it makes), and
 *   2. the slot registration (slot key, shadowing priority, injected face),
 *      plus the component's refusal to throw on every degraded input.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/* ------------------------------------------------------------------ *
 * Miniature React — hooks are collected per component invocation.
 * ------------------------------------------------------------------ */

function createReact() {
  let hooks = null
  let cursor = 0
  let idCounter = 0

  class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch
      this.state = { ...this.state, ...next }
    }
  }

  function slot(initial) {
    const list = hooks
    const at = cursor
    cursor += 1
    if (!(at in list)) list[at] = typeof initial === 'function' ? initial() : initial
    return { list, at }
  }

  return {
    Component,
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } }
    },
    useState(initial) {
      const { list, at } = slot(initial)
      return [list[at], (next) => { list[at] = typeof next === 'function' ? next(list[at]) : next }]
    },
    useRef(initial) {
      const { list, at } = slot({ current: initial })
      return list[at]
    },
    useId() {
      const { list, at } = slot(() => `:r${idCounter += 1}:`)
      return list[at]
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor += 1
      return getSnapshot()
    },
    useEffect(_effect, deps) { slot(deps) },
    useLayoutEffect(_effect, deps) { slot(deps) },
    /** Invoke one function/class component, collecting its hooks in isolation. */
    run(component, props) {
      const outerHooks = hooks
      const outerCursor = cursor
      hooks = []
      cursor = 0
      let output
      let instance = null
      if (component.prototype !== undefined && typeof component.prototype.render === 'function') {
        instance = new component(props)
        output = instance.render()
      } else {
        output = component(props)
      }
      const collected = hooks
      hooks = outerHooks
      cursor = outerCursor
      return { output, collected, instance }
    },
  }
}

/* ------------------------------------------------------------------ *
 * Bundle loading
 * ------------------------------------------------------------------ */

/**
 * Execute the shipped bundle in a sandbox that mimics `window.__ModuleLoader__`.
 * @param options - optional sandbox injections (a `document` stub).
 * @returns the registered loader entry.
 */
function loadRegisteredEntry(options = {}) {
  let registered = null
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    Number,
    String,
    Object,
    Array,
    Node: class Node {},
    window: { __ModuleLoader__: { load: (entry) => { registered = entry } } },
    document: options.document,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(clientSource, context, { filename: 'dsh-reasoning-slider/lib/client.js' })
  return { entry: registered, context }
}

/** A `document` stub recording the style tags the bundle installs. */
function makeDocument() {
  const appended = []
  const document = {
    head: { appendChild: (tag) => appended.push(tag) },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: (selector) => appended.find((tag) => selector.includes(tag.dataset.pluginCss)) ?? null,
  }
  return { document, appended }
}

/**
 * Materialize the bundle factory against a `react`-only module table.
 * @returns the bundle's exports plus a record of every module it requested.
 */
function materialize() {
  const react = createReact()
  const requested = []
  const { entry } = loadRegisteredEntry()
  assert.ok(entry !== null, 'the bundle must call window.__ModuleLoader__.load')
  const exports = entry.factory((id) => {
    requested.push(id)
    if (id === 'react') return react
    throw new Error(`unexpected module request: ${id}`)
  })
  return { entry, exports, requested, react }
}

/* ------------------------------------------------------------------ *
 * Mini renderer
 * ------------------------------------------------------------------ */

/**
 * Walk an element tree, invoking function/class components.
 * @param node - the element produced by `createElement`.
 * @param react - the mini React driving hooks.
 * @returns a plain tree of `{ type, props, children }` nodes.
 */
function renderTree(node, react) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) {
    const rendered = node.map((child) => renderTree(child, react)).filter((child) => child !== null)
    return rendered.length === 0 ? null : rendered
  }
  if (typeof node === 'string' || typeof node === 'number') return { type: '#text', text: String(node), props: {} }
  const { type, props } = node
  if (typeof type === 'function') {
    const { output } = react.run(type, props)
    const rendered = renderTree(output, react)
    // A component that renders nothing contributes nothing, exactly as React
    // treats a `null` return.
    return rendered === null ? null : { type: type.name || 'Anonymous', props, rendered }
  }
  return { type, props, children: renderTree(props.children, react) }
}

/**
 * Copy a value out of the vm realm.
 *
 * The bundle runs inside `node:vm`, so arrays and objects it hands back have a
 * different prototype than this file's literals; `deepStrictEqual` would reject
 * two structurally identical values for that reason alone.
 * @param value - any JSON-compatible value produced by the sandbox.
 * @returns the same value rebuilt in this realm.
 */
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** Collect every rendered node matching a predicate. */
function findAll(node, predicate, found = []) {
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  findAll(node.children, predicate, found)
  if (node.rendered !== undefined) findAll(node.rendered, predicate, found)
  return found
}

/** The seat component the plugin registers. */
function seatComponentFrom(exports) {
  const { component, options } = captureRegistration(exports)
  assert.equal(typeof component, 'function')
  assert.equal(options.name, 'conversation.input.model')
  return component
}

/** Run `apply` against a recording slot registry and return what it registered. */
function captureRegistration(exports) {
  const record = { options: null, component: null, slotKey: null, deps: null }
  const slots = {
    inject(key, callback) {
      record.slotKey = key
      return callback()
    },
    register(options, component) {
      record.options = options
      record.component = component
      return { dispose() {} }
    },
  }
  const models = {
    directoryFor() {
      return { store: { getSnapshot: () => EMPTY, subscribe: () => () => {} }, load: async () => EMPTY, select: async () => {} }
    },
  }
  const sessions = { subagentAddress: () => undefined }
  const ctx = {
    inject(deps, callback) {
      record.deps = deps
      return callback({ slots, modelDirectories: models, sessions })
    },
  }
  exports.apply(ctx)
  return record
}

const EMPTY = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

const READY_STATE = {
  current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  routable: true,
  groups: [{
    id: 'deepseek',
    name: 'DeepSeek',
    models: [{
      id: 'deepseek-chat',
      name: 'DeepSeek Chat',
      reasoning: {
        defaultEffort: 'medium',
        efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
      },
    }],
  }],
  failures: [],
  status: 'ready',
  error: null,
}

function makeStore(state) {
  return { getSnapshot: () => state, subscribe: () => () => {} }
}

/**
 * The seat's props. `initialView` is the component's test-only seam: the
 * injected face never passes it, and the mini React below cannot feed a
 * `useState` value back into a re-render, so the seat's two open states would
 * otherwise be structurally unreachable from a unit test.
 */
function seatProps(state, overrides = {}) {
  return {
    locked: false,
    available: true,
    directory: makeStore(state),
    load: () => {},
    select: () => Promise.resolve(true),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

test('the bundle registers one loader entry under the package name', () => {
  const { entry } = loadRegisteredEntry()
  assert.ok(entry !== null)
  assert.equal(entry.id, manifest.name)
  assert.equal(typeof entry.factory, 'function')
})

test('the bundle requests only frozen platform modules', () => {
  const { exports, requested } = materialize()
  assert.deepEqual(plain(requested), ['react'])
  assert.equal(exports.name, 'reasoning-slider')
  assert.equal(exports.inject.length, 0, 'no host services are declared up front')
  assert.equal(typeof exports.apply, 'function')
})

test('the bundle installs its stylesheet once, with a removable key', () => {
  const { document, appended } = makeDocument()
  for (const _pass of [0, 1]) {
    const { entry } = loadRegisteredEntry({ document })
    assert.ok(entry !== null)
    assert.doesNotThrow(() => entry.factory(() => ({ createElement: () => null, Component: class {} })))
  }
  assert.equal(appended.length, 1, 'a second execution must not duplicate the style tag')
  const tag = appended[0]
  assert.equal(tag.dataset.plugin, manifest.name)
  assert.equal(tag.dataset.pluginCss, `${manifest.name}/seat.css`)
  assert.match(tag.textContent, /\.drs-range/)
  assert.match(tag.textContent, /--drs-track-pos/)
  assert.match(tag.textContent, /--drs-fill:#298ffe/, 'the sampled Codex blue is declared for light')
  assert.match(tag.textContent, /body\[data-ds-dark-theme\] \.drs-range/, 'and re-declared for dark')
  assert.match(tag.textContent, /@keyframes drs-flow-a/, 'the flow scrolls on the compositor, not from script')
  assert.match(tag.textContent, /\.drs-flow\{[^}]*pointer-events:none/, 'the decoration never eats a click')
  assert.match(tag.textContent, /prefers-reduced-motion:reduce\)\{\.drs-flow-a/, 'and it is off for reduced motion')
  assert.doesNotMatch(tag.textContent, /drs-accent|drs-top/, 'the old accent plumbing and the badge are gone')
  assert.doesNotMatch(tag.textContent, /#3b82f6|#f97316/, 'no hue ramp survives in the stylesheet')

  // The two-level shape: a panel that is not the trigger, captions pinned to the
  // bar's ends, and a bar sized by the panel's content box rather than by the
  // composer-squeezed trigger.
  assert.match(tag.textContent, /\.drs-panel\{[^}]*border-radius:16px/, 'the second level is a panel')
  assert.match(tag.textContent, /\.drs-axis\{[^}]*justify-content:space-between/, '更快 / 更强 sit at the bar ends')
  assert.match(tag.textContent, /\.drs-trigger-effort\{[^}]*flex:none/, 'the effort name is the segment that never truncates')
  assert.match(tag.textContent, /\.drs-hover\{[^}]*position:absolute/, 'the hover readout floats over the bar')
  assert.match(tag.textContent, /\.drs-hover\{[^}]*pointer-events:none/, 'and never eats the drag it reports on')
  assert.match(tag.textContent, /\.drs-hover\{[^}]*max-width:104px/, 'its clamp width is the same constant the seat positions it with')
  assert.match(tag.textContent, /\.drs-range\{[^}]*width:236px/, 'the bar keeps its shipped 236px width (the 1.5× change is thickness, not length)')
  assert.match(tag.textContent, /\.drs-range\{[^}]*height:29px/, 'and it is 1.5× as thick: a 21px knob in a 15px-tall control')
  assert.match(tag.textContent, /::-webkit-slider-runnable-track\{height:15px/, 'the track itself is 15px, up from 10px')
  assert.doesNotMatch(tag.textContent, /\.drs-trigger-label\{/, 'the single-label trigger is gone')
  assert.doesNotMatch(tag.textContent, /\.drs-effort\{/, 'the effort name moved onto the trigger')
})

test('the collapsed seat is a two-tone summary, and holds no slider', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const tree = renderTree(react.createElement(Seat, seatProps(READY_STATE)), react)
  const byClass = (node, name) => findAll(node, (child) => child.props && child.props.className === name)

  // The product rule the two-level shape exists for: a closed seat summarises
  // the selection and offers nothing to drag, and it opens nothing.
  assert.equal(findAll(tree, (node) => node.props && node.props.type === 'range').length, 0, 'no slider while collapsed')
  assert.equal(findAll(tree, (node) => node.props && node.props.role === 'dialog').length, 0, 'and no panel')
  assert.equal(findAll(tree, (node) => node.props && node.props.role === 'menu').length, 0, 'and no model list')
  assert.match(findAll(tree, (node) => node.props && node.props['data-drs-debug'] !== undefined)[0].props['data-drs-debug'], /"view":"closed"/)

  const trigger = byClass(tree, 'drs-trigger')[0]
  assert.equal(trigger.props['aria-haspopup'], 'dialog')
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(trigger.props['aria-controls'], undefined)
  assert.equal(byClass(tree, 'drs-slider').length, 0, 'the bar is not a permanent sibling of the trigger')

  // Model name, then effort name, then a drawn chevron — no `▾` glyph.
  const segments = findAll(tree, (node) => node.props && (node.props.className === 'drs-trigger-model' || node.props.className === 'drs-trigger-effort'))
  assert.deepEqual(segments.map((node) => node.children[0].text), ['DeepSeek Chat', 'High'])
  const caret = byClass(tree, 'drs-caret')
  assert.equal(caret.length, 1)
  assert.equal(caret[0].type, 'svg', 'the chevron is an icon, not text')
})

test('the panel holds the model row and the bar, and the row drills into the model list', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const openAt = (view, overrides = {}) => renderTree(
    react.createElement(Seat, seatProps(READY_STATE, { initialView: view, ...overrides })),
    react,
  )
  const byClass = (node, name) => findAll(node, (child) => child.props && child.props.className === name)

  const panel = openAt('panel')
  const dialog = findAll(panel, (node) => node.props && node.props.role === 'dialog')
  assert.equal(dialog.length, 1, 'the panel is a dialog: it holds a control, not just a list of choices')
  assert.equal(dialog[0].props.tabIndex, -1)
  assert.equal(dialog[0].props['aria-label'], '模型与推理强度')
  assert.equal(String(dialog[0].props.id).endsWith('-panel'), true)

  const trigger = byClass(panel, 'drs-trigger')[0]
  assert.equal(trigger.props['aria-expanded'], true)
  assert.equal(trigger.props['aria-controls'], dialog[0].props.id)

  const row = byClass(panel, 'drs-model-row')
  assert.equal(row.length, 1, 'the panel carries its own model entry')
  assert.equal(row[0].props.disabled, false)
  assert.equal(byClass(panel, 'drs-model-row-name')[0].children[0].text, 'DeepSeek Chat')
  assert.equal(byClass(panel, 'drs-chevron-right').length, 1, 'the chevron-right marks the drill-down')
  const axis = byClass(panel, 'drs-axis')
  assert.equal(axis[0].props['aria-hidden'], 'true', 'the captions are decoration')
  assert.deepEqual(axis[0].children.map((node) => node.children[0].text), ['更快', '更强'])
  assert.equal(byClass(panel, 'drs-slider').length, 1, 'and the bar lives inside the panel')
  assert.equal(findAll(panel, (node) => node.props && node.props.role === 'menu').length, 0, 'the model list is not rendered yet')

  const models = openAt('models')
  assert.equal(findAll(models, (node) => node.props && node.props.role === 'menu').length, 1)
  assert.equal(findAll(models, (node) => node.props && node.props.role === 'menuitemradio').length, 1, 'one option per catalogue model')
  assert.equal(findAll(models, (node) => node.props && node.props.role === 'dialog').length, 0, 'the list replaces the panel instead of stacking on it')

  // A locked session is inert at every level.
  const locked = openAt('panel', { locked: true })
  assert.equal(byClass(locked, 'drs-trigger')[0].props.disabled, true)
  assert.equal(byClass(locked, 'drs-model-row')[0].props.disabled, true)
  assert.equal(findAll(locked, (node) => node.props && node.props.type === 'range')[0].props.disabled, true)
  assert.equal(
    findAll(locked, (node) => node.props && node.props.className === 'drs-flow drs-flow--idle').length,
    1,
    'a locked seat pauses its particles',
  )
})

test('the track is a Codex-style bar: in-track dots over a fill on a pill track', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  // The bar now lives inside the panel, so measuring it means rendering the open
  // state. `initialView` is the seam for the single-pass renderer below.
  const treeFor = (state, overrides = {}) => renderTree(
    react.createElement(Seat, seatProps(state, { initialView: 'panel', ...overrides })),
    react,
  )
  const sliderFor = (state) => findAll(treeFor(state), (node) => node.props && node.props.type === 'range')[0].props

  // `high` is the last of the three advertised levels (indices 0..2).
  const top = sliderFor(READY_STATE)
  const image = top.style['--drs-track']
  const size = top.style['--drs-track-size']
  const position = top.style['--drs-track-pos']

  assert.equal(typeof image, 'string')
  assert.equal(typeof position, 'string')
  // The markers ride *inside* the bar — Codex has no ticks standing off it.
  assert.equal(image.split('radial-gradient').length - 1, 3, 'one dot per advertised level')
  assert.match(image, /var\(--drs-fill,#298ffe\)/, 'the fill is the sampled Codex blue')
  assert.match(image, /var\(--drs-rest,#e5e2e6\)/, 'the resting track is the sampled Codex grey')
  assert.doesNotMatch(image, /rgb\(/, 'no ramp is computed at runtime any more')

  // Three dots + the fill + the resting track, with a matching layer in each list.
  assert.equal(image.split('linear-gradient').length - 1, 2, 'the fill and the track')
  assert.equal(size.split(',').length, 5)
  assert.equal(position.split(',').length, 5, 'every image layer needs its own size and position')
  assert.equal(size.split(',')[0], '4.5px 4.5px', 'a marker is a 3px dot scaled with the bar (1.5×)')

  // The track spans the panel's content box; the fill stops under the thumb
  // centre, which is inset by half a thumb (a naive `ratio * 100%` would end at
  // 236px instead).
  assert.equal(size.split(',').pop(), '100% 100%')
  assert.equal(size.split(',')[3], '225.50px 100%', 'a top level fills out to the thumb centre: 10.5 + 215')
  assert.equal(position.split(',').pop(), '0 0')

  // Dot centres are the thumb centres — 10.5px, 118px, 225.5px — each 4.5px
  // wide, so each layer is offset by half a dot.
  assert.deepEqual(position.split(',').slice(0, 3), ['8.25px 50%', '115.75px 50%', '223.25px 50%'])

  // A weaker level fills only its own share (index 0 is 7px whatever the width).
  const weak = sliderFor({ ...READY_STATE, current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' } })
  assert.equal(weak.style['--drs-track-size'].split(',')[3], '10.50px 100%')

  // Unreached dots fall back to the muted token; reached ones do not.
  const muted = 'var(--drs-dot-off,rgba(0,0,0,.16))'
  const mutedDot = `radial-gradient(circle at 50% 50%,${muted} 0 2.25px,rgba(0,0,0,0) 2.35px)`
  assert.equal(weak.style['--drs-track'].split(mutedDot).length - 1, 2, 'the two unreached dots are muted')
  assert.equal(top.style['--drs-track'].split(mutedDot).length - 1, 0, 'the top level reaches every dot')

  // A single advertised level is not a choice: no bar at all, just the name on
  // the trigger — a range pinned to the left edge would read as "nothing
  // selected" — and a sentence in place of the panel's empty second row.
  const singleState = {
    ...READY_STATE,
    groups: [{
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }],
    }],
  }
  const singleTree = treeFor(singleState)
  assert.equal(findAll(singleTree, (node) => node.props && node.props.type === 'range').length, 0, 'one level offers no slider')
  assert.equal(findAll(singleTree, (node) => node.props && node.props.className === 'drs-axis').length, 0, 'and no axis labels either')
  const singleNote = findAll(singleTree, (node) => node.props && node.props.className === 'drs-single')
  assert.equal(singleNote.length, 1, 'the panel says why it is empty')
  assert.equal(singleNote[0].children[0].text, '该模型只有一个推理档位')
  assert.equal(
    findAll(singleTree, (node) => node.props && node.props.className === 'drs-trigger-effort')[0].children[0].text,
    'High',
    'the level name is still shown, on the trigger',
  )
})

test('only the strongest level carries the consumption hint, and only in the tooltip', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const treeFor = (state, view) => renderTree(
    react.createElement(Seat, seatProps(state, view === undefined ? {} : { initialView: view })),
    react,
  )
  const byClass = (tree, className) => {
    const found = findAll(tree, (node) => node.props && node.props.className === className)
    return found.length === 0 ? null : found[0].props
  }
  const rangeProps = (tree) => {
    const found = findAll(tree, (node) => node.props && node.props.type === 'range')
    return found.length === 0 ? null : found[0].props
  }
  const weakState = { ...READY_STATE, current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' } }

  // Codex states the cost in the option's description rather than as a badge on
  // the control, so the hint lives on `title` and nothing is drawn for it. It
  // is on both halves of the seat: the bar's tooltip and the collapsed summary's.
  assert.match(rangeProps(treeFor(READY_STATE, 'panel')).title, /最强档位/, '`high` is the last advertised level')
  assert.match(byClass(treeFor(READY_STATE), 'drs-trigger').title, /更快消耗额度/)
  assert.equal(rangeProps(treeFor(weakState, 'panel')).title, 'Low')
  assert.equal(byClass(treeFor(weakState), 'drs-trigger').title, 'DeepSeek Chat · Low')
  assert.equal(rangeProps(treeFor(EMPTY, 'panel')), null, 'a model with no reasoning metadata has no top level')
  assert.equal(byClass(treeFor(EMPTY), 'drs-trigger').title, '选择模型', 'and its trigger carries no effort segment')
})

test('the filled span carries a particle flow that stops when it should', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const flowFor = (state, overrides) => findAll(
    renderTree(react.createElement(Seat, seatProps(state, { initialView: 'panel', ...overrides })), react),
    (node) => node.props && typeof node.props.className === 'string' && /^drs-flow(\s|$)/.test(node.props.className),
  )
  const at = (effort) => ({ ...READY_STATE, current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: effort } })

  // `high` is the last of three levels, so the flow spans the fill minus the
  // half of the thumb it would otherwise run underneath: 236 - 21 = 215px.
  const top = flowFor(READY_STATE)
  assert.equal(top.length, 1)
  assert.equal(top[0].props['aria-hidden'], 'true', 'it is decoration, not content')
  assert.equal(top[0].props.style.width, '215.00px')
  assert.equal(top[0].props.className, 'drs-flow', 'an unlocked seat animates')

  // Two scrolling layers, so the motion reads as particles rather than a dash.
  const layers = findAll(renderTree(react.createElement(Seat, seatProps(READY_STATE, { initialView: 'panel' })), react), (node) => node.props && (node.props.className === 'drs-flow-a' || node.props.className === 'drs-flow-b'))
  assert.equal(layers.length, 2)

  assert.equal(flowFor(at('medium'))[0].props.style.width, '107.50px')

  // The weakest stop is a sliver; drawing a flow in it would be noise.
  assert.equal(flowFor(at('low')).length, 0, 'no flow at the weakest level — 7px of fill is a nub, not a stream')

  // A locked seat is inert, so the decoration stops with it.
  assert.equal(flowFor(READY_STATE, { locked: true })[0].props.className, 'drs-flow drs-flow--idle')
})

test('the bar is watched for the pointer, and the readout is decoration', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const panel = renderTree(react.createElement(Seat, seatProps(READY_STATE, { initialView: 'panel' })), react)

  // Hovering is what produces the readout, so a tree that has never seen a
  // pointer carries none. That mapping is verified in a browser instead
  // (tools/preview.mjs and tools/live-gui-check.mjs both dispatch a real
  // pointermove and read `.drs-hover`), because this single-pass renderer cannot
  // feed a new `useState` value back into a re-render.
  assert.equal(findAll(panel, (node) => node.props && node.props.className === 'drs-hover').length, 0)

  const wrap = findAll(panel, (node) => node.props && node.props.className === 'drs-track-wrap')
  assert.equal(wrap.length, 1, 'the bar needs a wrapper to watch for the pointer')
  assert.equal(typeof wrap[0].props.onPointerMove, 'function')
  assert.equal(typeof wrap[0].props.onPointerLeave, 'function', 'leaving the bar retires the readout')

  // Both handlers must be safe to call, and a move must not commit anything: the
  // readout is a report, not a selection.
  const event = { clientX: 200, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 354 }) } }
  assert.doesNotThrow(() => wrap[0].props.onPointerMove(event))
  assert.doesNotThrow(() => wrap[0].props.onPointerLeave())

  // A collapsed seat has no bar, so there is nothing to report on.
  const collapsed = renderTree(react.createElement(Seat, seatProps(READY_STATE)), react)
  assert.equal(findAll(collapsed, (node) => node.props && node.props.className === 'drs-track-wrap').length, 0)
})

test('the manifest declares a web client half resolvable from exports["./client"]', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.external, undefined, 'no non-baseline externals are requested')
  const clientExport = manifest.exports['./client']
  assert.equal(typeof clientExport === 'string' ? clientExport : clientExport.default, './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('the host half is an inert plugin', async () => {
  const host = await import(new URL('../lib/index.js', import.meta.url))
  assert.equal(host.name, 'reasoning-slider')
  assert.equal(host.inject.length, 0)
  assert.equal(typeof host.apply, 'function')
  assert.doesNotThrow(() => host.apply())
})

test('apply waits for the three services and shadows the shipped seat', () => {
  const { exports } = materialize()
  const record = captureRegistration(exports)
  const deps = plain(record.deps)
  assert.deepEqual(deps, ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'])
  // Regression: `modelDirectories.directoryFor()` reaches into its owner
  // context for `ctx.remote.session`, and cordis resolves that property
  // through the *accessing* fiber's inject set. A scope without it throws
  // `cannot get property "remote.session" without inject`, the seat renders
  // nothing, and the composer silently loses its model entry.
  assert.ok(deps.includes('remote.session'), 'the scope must be able to resolve remote.session')
  assert.equal(record.slotKey, 'conversation.input.model')
  assert.equal(record.options.name, 'conversation.input.model')
  assert.equal(record.options.priority, -1, 'a different priority than the shipped seat (0) avoids the same-priority throw')
  assert.notEqual(record.options.priority, 0)
  assert.equal(typeof record.options.inject, 'function')
  assert.equal(typeof record.component, 'function')
})

test('the injected face rides the shared per-session directory', () => {
  const { exports } = materialize()
  const seen = []
  const store = makeStore(READY_STATE)
  const models = { directoryFor(sessionId) { seen.push(sessionId); return { store, load: async () => store.getSnapshot(), select: async () => {} } } }
  const sessions = { subagentAddress: () => undefined }
  const ctx = {
    inject(_deps, callback) {
      return callback({
        slots: { inject: (_key, callback2) => callback2(), register: (options) => options },
        modelDirectories: models,
        sessions,
      })
    },
  }
  const options = exports.apply(ctx)
  assert.equal(options, undefined, 'apply itself registers nothing directly')

  const face = capturedFace(exports, models, sessions, 'session-1')
  assert.equal(face.available, true)
  assert.equal(face.directory, store)
  assert.deepEqual(plain(seen), ['session-1'])
})

/** Reach the registered `inject` face through the recorded registration. */
function capturedFace(exports, models, sessions, sessionId) {
  let options = null
  const ctx = {
    inject(_deps, callback) {
      return callback({
        slots: { inject: (_key, callback2) => callback2(), register: (registered) => { options = registered; return registered } },
        modelDirectories: models,
        sessions,
      })
    },
  }
  exports.apply(ctx)
  return options.inject(sessionId)
}

test('the injected face degrades instead of throwing', () => {
  const { exports } = materialize()
  const broken = {
    directoryFor() { throw new Error('no scope for this session') },
    load() { throw new Error('nope') },
    select() { throw new Error('nope') },
  }
  const face = capturedFace(exports, broken, { subagentAddress: () => undefined }, 'session-1')
  assert.equal(face.available, false)
  assert.equal(typeof face.directory.getSnapshot, 'function')
  assert.equal(face.directory.getSnapshot().groups.length, 0)
  assert.doesNotThrow(() => face.load())
  return face.select({ provider: 'a', model: 'b' }).then((accepted) => assert.equal(accepted, false))
})

test('an addressed subagent session is unavailable, like the shipped seat', () => {
  const { exports } = materialize()
  const models = { directoryFor: () => { throw new Error('must not be called') } }
  const face = capturedFace(exports, models, { subagentAddress: () => 'agent-7' }, 'session-1')
  assert.equal(face.available, false)
})

test('the seat renders one slider over the advertised levels, with no per-level accent', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const tree = renderTree(react.createElement(Seat, seatProps(READY_STATE, { initialView: 'panel' })), react)

  const ranges = findAll(tree, (node) => node.props && node.props.type === 'range')
  assert.equal(ranges.length, 1, 'exactly one reasoning slider')
  const slider = ranges[0].props
  assert.equal(slider.min, 0)
  assert.equal(slider.max, 2, 'three advertised levels')
  assert.equal(slider.step, 1)
  assert.equal(slider.value, 2, 'the session selected `high`, the last level')
  assert.equal(slider['aria-label'], '推理强度')

  const weakTree = renderTree(react.createElement(Seat, seatProps({
    ...READY_STATE,
    current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' },
  }, { initialView: 'panel' })), react)
  const weakSlider = findAll(weakTree, (node) => node.props && node.props.type === 'range')[0].props
  assert.equal(weakSlider.value, 0)
  assert.equal(weakSlider.style['--drs-accent'], undefined, 'the level no longer tints the control')
  assert.equal(slider.style['--drs-accent'], undefined)
  assert.equal(slider['aria-valuetext'], 'High')
})

test('a provider-default level only appears when the adapter names no default', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)

  const noDefault = structuredClone(READY_STATE)
  delete noDefault.groups[0].models[0].reasoning.defaultEffort
  noDefault.current = { provider: 'deepseek', model: 'deepseek-chat' }
  const wide = findAll(renderTree(react.createElement(Seat, seatProps(noDefault, { initialView: 'panel' })), react), (node) => node.props && node.props.type === 'range')[0].props
  assert.equal(wide.max, 3, 'provider default prepends one stop')

  const withDefault = findAll(renderTree(react.createElement(Seat, seatProps(READY_STATE, { initialView: 'panel' })), react), (node) => node.props && node.props.type === 'range')[0].props
  assert.equal(withDefault.max, 2, 'a named default adds no extra stop')
})

test('a model without reasoning metadata renders no slider', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const state = structuredClone(READY_STATE)
  delete state.groups[0].models[0].reasoning
  const tree = renderTree(react.createElement(Seat, seatProps(state)), react)
  assert.equal(findAll(tree, (node) => node.props && node.props.type === 'range').length, 0)
  assert.equal(findAll(tree, (node) => node.type === 'button').length >= 1, true, 'the model trigger still renders')

  // Even opened: the model row is there, the bar is not, and the panel says why.
  const opened = renderTree(react.createElement(Seat, seatProps(state, { initialView: 'panel' })), react)
  assert.equal(findAll(opened, (node) => node.props && node.props.type === 'range').length, 0)
  assert.equal(findAll(opened, (node) => node.props && node.props.className === 'drs-model-row').length, 1)
  assert.equal(findAll(opened, (node) => node.props && node.props.className === 'drs-single').length, 0, 'no reasoning metadata is not the single-level case')
})

test('the seat refuses to render when unavailable or when the catalogue is empty', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)

  // Unavailable: nothing interactive, but a hidden diagnostic node stays
  // readable so a regression cannot silently blank the composer.
  const unavailable = renderTree(react.createElement(Seat, seatProps(EMPTY, { available: false })), react)
  assert.equal(findAll(unavailable, (node) => node.type === 'button').length, 0)
  assert.equal(findAll(unavailable, (node) => node.props && node.type === 'input').length, 0)
  const unavailableDiag = findAll(unavailable, (node) => node.props && node.props['data-drs-debug'] !== undefined)
  assert.equal(unavailableDiag.length, 1)
  assert.match(unavailableDiag[0].props['data-drs-debug'], /"available":false/)

  // Empty-but-available: the trigger renders, the slider does not.
  const empty = renderTree(react.createElement(Seat, seatProps(EMPTY)), react)
  assert.equal(findAll(empty, (node) => node.props && node.props.type === 'range').length, 0)
  assert.equal(findAll(empty, (node) => node.type === 'button').length, 1)
})

test('the seat survives hostile catalogue payloads', () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const hostile = [
    { current: null, routable: null, groups: null, failures: null, status: 'ready', error: null },
    { current: { provider: 'x', model: 'y' }, routable: true, groups: [{ id: 'x', models: null }], failures: [], status: 'ready', error: null },
    { current: { provider: 'x', model: 'y' }, routable: true, groups: [{ id: 'x', models: [null, { id: 'y', reasoning: { efforts: null } }] }], failures: [], status: 'ready', error: null },
    { current: { provider: 'x', model: 'y', reasoningEffort: 'ghost' }, routable: true, groups: [{ id: 'x', models: [{ id: 'y', reasoning: { efforts: [{ id: 'low' }] } }] }], failures: [], status: 'ready', error: null },
    { current: null, routable: true, groups: [], failures: [], status: 'error', error: 'catalog exploded' },
  ]
  for (const state of hostile) {
    assert.doesNotThrow(
      () => renderTree(react.createElement(Seat, seatProps(state)), react),
      `state ${JSON.stringify(state)} must not throw`,
    )
  }
})

test('the slider commits on release, and only when the level actually changed', async () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const calls = []
  const props = seatProps(READY_STATE, { initialView: 'panel', select: (selection) => { calls.push(selection); return Promise.resolve(true) } })
  const tree = renderTree(react.createElement(Seat, props), react)
  const slider = findAll(tree, (node) => node.props && node.props.type === 'range')[0].props

  slider.onPointerUp({ target: { value: '0' } })
  await Promise.resolve()
  assert.deepEqual(plain(calls), [{ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' }])

  // Re-committing the level already in force must not talk to the Host.
  slider.onPointerUp({ target: { value: '2' } })
  await Promise.resolve()
  assert.equal(calls.length, 1)

  // Dragging alone (change without release) must not commit either.
  slider.onChange({ target: { value: '1' } })
  await Promise.resolve()
  assert.equal(calls.length, 1)
})

test('the provider-default stop omits reasoningEffort entirely', async () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const calls = []
  const state = structuredClone(READY_STATE)
  delete state.groups[0].models[0].reasoning.defaultEffort
  state.current = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }
  const props = seatProps(state, { initialView: 'panel', select: (selection) => { calls.push(selection); return Promise.resolve(true) } })
  const slider = findAll(renderTree(react.createElement(Seat, props), react), (node) => node.props && node.props.type === 'range')[0].props
  slider.onPointerUp({ target: { value: '0' } })
  await Promise.resolve()
  assert.deepEqual(plain(calls), [{ provider: 'deepseek', model: 'deepseek-chat' }])
})

test('every close path stays inert here; focus restoration is measured in the browser', () => {
  // Focus restoration is a `useLayoutEffect`, and this miniature renderer never
  // runs effects — nor can it re-render after a `useState`. So the behaviour is
  // *not* assertable here, and this test deliberately does not pretend otherwise:
  // it pins that the close paths exist and cannot throw, while the behaviour
  // itself is measured on `document.activeElement` in a real browser by
  // `node tools/preview.mjs` → `*-focus.facts.json`:
  //   after-open=panel/.drs-panel → after-escape=closed/trigger
  //   → after-reopen=panel/.drs-panel → after-outside-mousedown=closed/body
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const partsFor = (view) => {
    const tree = renderTree(react.createElement(Seat, seatProps(READY_STATE, { initialView: view })), react)
    const pick = (name) => findAll(tree, (node) => node.props && node.props.className === name)[0]
    return { trigger: pick('drs-trigger'), root: pick('drs-root') }
  }

  // Closing from an open panel: no Host call, no throw.
  const open = partsFor('panel')
  assert.equal(typeof open.trigger.props.onClick, 'function')
  assert.doesNotThrow(() => open.trigger.props.onClick())

  // ...and opening from the collapsed seat still loads and opens.
  const closed = partsFor('closed')
  assert.doesNotThrow(() => closed.trigger.props.onClick({}))
  assert.equal(typeof closed.root.props.onKeyDown, 'function')
  // Esc is bound on the root, so it is reachable from the trigger, the panel and
  // the model list alike; other keys must be ignored.
  assert.doesNotThrow(() => closed.root.props.onKeyDown({ key: 'Escape', preventDefault() {} }))
  assert.doesNotThrow(() => closed.root.props.onKeyDown({ key: 'Enter', preventDefault() {} }))
})

test('a rejected selection is swallowed, never thrown at React', async () => {
  const { exports, react } = materialize()
  const Seat = seatComponentFrom(exports)
  const props = seatProps(READY_STATE, { initialView: 'panel', select: () => Promise.reject(new Error('host said no')) })
  const slider = findAll(renderTree(react.createElement(Seat, props), react), (node) => node.props && node.props.type === 'range')[0].props
  assert.doesNotThrow(() => slider.onPointerUp({ target: { value: '0' } }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  const throwing = seatProps(READY_STATE, { initialView: 'panel', select: () => { throw new Error('sync throw') } })
  const slider2 = findAll(renderTree(react.createElement(Seat, throwing), react), (node) => node.props && node.props.type === 'range')[0].props
  assert.doesNotThrow(() => slider2.onPointerUp({ target: { value: '0' } }))
})
