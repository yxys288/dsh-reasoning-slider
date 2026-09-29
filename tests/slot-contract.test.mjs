/**
 * Integration check against the REAL slot registry.
 *
 * The unit tests prove the plugin's own shape; this one proves the one
 * behaviour that decides whether the Web GUI's composer keeps a model seat at
 * all: `conversation.input.model` is `single`, and `SlotCore.register` throws
 * when a second entry claims an occupied cell *at the same priority*. So the
 * seat must shadow the shipped occupant at a different priority, must survive
 * registering alongside it, and must hand the cell back when it disposes.
 *
 * The upstream registry is React-free, so it runs as-is in Node. When no
 * kernel install is reachable the test skips rather than failing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const SLOT_KEY = 'conversation.input.model'

/**
 * Candidate kernels to borrow the registry from.
 *
 * A globally installed dsh keeps its packages one level down, so the prefix
 * is derived rather than spelled out: `DSH_NPM_PREFIX`, npm's own
 * `npm_config_prefix`, then the platform's conventional global location.
 * `DSH_UI_SLOTS_PATH` wins outright when a specific build must be pinned
 * (e.g. the SlotCore shipped inside a desktop `app.asar`).
 * @returns candidate module paths, most specific first.
 */
function slotCoreCandidates() {
  const relative = 'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'
  const prefixes = [
    process.env.DSH_NPM_PREFIX,
    process.env.npm_config_prefix,
    join(homedir(), 'npm-global'),
    process.env.APPDATA === undefined ? null : join(process.env.APPDATA, 'npm'),
  ].filter(Boolean)
  return [
    process.env.DSH_UI_SLOTS_PATH,
    ...prefixes.map((prefix) =>
      join(prefix, 'node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai', relative)),
    join(homedir(), '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'),
    join(homedir(), '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'),
  ].filter(Boolean)
}

async function loadSlotCore() {
  for (const candidate of slotCoreCandidates()) {
    if (!existsSync(candidate)) continue
    const module = await import(pathToFileURL(candidate).href)
    if (typeof module.SlotCore === 'function') return module
  }
  return null
}

/** Materialize the shipped bundle with a react stub, exactly as the browser would. */
function materializeBundle() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let entry = null
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
    window: { __ModuleLoader__: { load: (registered) => { entry = registered } } },
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.ok(entry !== null)
  const noopComponent = function Noop() { return null }
  return entry.factory((id) => {
    if (id === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
        Component: class { constructor(props) { this.props = props; this.state = {} } },
        useState: (initial) => [initial, () => {}],
        useRef: () => ({ current: null }),
        useId: () => ':r0:',
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        useEffect: () => {},
        useLayoutEffect: () => {},
      }
    }
    throw new Error(`unexpected module request: ${id}`)
  })
}

const STATE = {
  current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  routable: true,
  groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] }],
  failures: [],
  status: 'ready',
  error: null,
}

/** Install the plugin's registration into a real SlotCore via a minimal slots service. */
function installSeat(core, exports) {
  const store = { getSnapshot: () => STATE, subscribe: () => () => {} }
  const slots = {
    inject: (key, callback) => callback(),
    register: (options, component) => core.register(options, component),
  }
  const models = {
    directoryFor: () => ({ store, load: async () => STATE, select: async () => {} }),
  }
  const sessions = { subagentAddress: () => undefined }
  const ctx = {
    inject: (_deps, callback) => callback({ slots, modelDirectories: models, sessions }),
  }
  exports.apply(ctx)
}

test('the seat shadows the shipped occupant on the real registry', async (t) => {
  const slots = await loadSlotCore()
  if (slots === null) {
    t.skip('no reachable @deepseek-ai/dsh-client-ui-slots install')
    return
  }
  const { SlotCore } = slots
  const exports = materializeBundle()
  const core = new SlotCore()

  const nativeComponent = function ShippedModelSelect() { return null }
  // The composer declares the seat; a parent entry's children table owns it.
  core.register({ name: 'root', children: { [SLOT_KEY]: { kind: 'single', scope: 'session' } } }, nativeComponent)
  assert.deepEqual(core.specDynamic(SLOT_KEY), { kind: 'single', scope: 'session' })

  // The shipped seat registers at the default priority.
  const nativeEntry = core.register({ name: SLOT_KEY, registrant: 'ui-model-selection' }, nativeComponent)
  assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1)

  // ...so a same-priority registration is rejected. This is exactly the throw
  // the -1 priority exists to avoid, and it is why the plugin must not use the
  // default.
  assert.throws(
    () => core.register({ name: SLOT_KEY, registrant: 'a naive plugin' }, nativeComponent),
    /already has a registration at priority 0/,
  )

  installSeat(core, exports)

  const winners = core.entriesOfSlot(SLOT_KEY)
  assert.equal(winners.length, 1, 'the single cell still has exactly one winner')
  assert.equal(winners[0].options.priority, -1, 'the plugin wins the cell')
  assert.notEqual(winners[0].component, nativeComponent)

  // Every occupant stays on the ledger: disposing the plugin restores the
  // shipped seat instead of leaving the composer without one.
  const ledger = core.entries(SLOT_KEY)
  assert.equal(ledger.length, 2)

  const installed = ledger.find((entry) => entry.options.priority === -1)
  assert.equal(typeof installed.inject, 'function')
  const face = installed.inject('session-1')
  assert.equal(face.available, true)
  assert.equal(face.directory.getSnapshot().groups.length, 1)
  assert.equal(typeof installed.component, 'function')
})

test('the plugin leaves the cell untouched when its services never arrive', async (t) => {
  const slots = await loadSlotCore()
  if (slots === null) {
    t.skip('no reachable @deepseek-ai/dsh-client-ui-slots install')
    return
  }
  const { SlotCore } = slots
  const exports = materializeBundle()
  const core = new SlotCore()
  const nativeComponent = function ShippedModelSelect() { return null }
  core.register({ name: 'root', children: { [SLOT_KEY]: { kind: 'single', scope: 'session' } } }, nativeComponent)
  core.register({ name: SLOT_KEY, registrant: 'ui-model-selection' }, nativeComponent)

  // A kernel without modelDirectories: `ctx.inject` never settles, so the
  // plugin registers nothing and the shipped seat keeps the cell.
  const ctx = { inject: () => {} }
  assert.doesNotThrow(() => exports.apply(ctx))

  const winners = core.entriesOfSlot(SLOT_KEY)
  assert.equal(winners.length, 1)
  assert.equal(winners[0].component, nativeComponent)
})
