/**
 * Preview harness for dsh-reasoning-slider.
 *
 * Runs the **shipped** client bundle (`lib/client.js`, copied in as `seat.js`) in a
 * real browser with real React, against the real DSH theme tokens, and renders a
 * matrix of seat states so the visual result can be screenshotted and diffed.
 *
 * It deliberately reuses the plugin's own registration path: `apply()` is called
 * with a fake slot registry, then each seat is handed the *real* injected face
 * (`options.inject(sessionId)`) rather than hand-built props. So what renders here
 * is what the composer renders.
 *
 * `window.__previewFacts` is filled in after mount with machine-readable CSS facts
 * (resolved background layers, per-stop geometry, colours) so verification does not
 * depend on eyeballing a PNG.
 */
(function () {
  'use strict'

  var React = window.React
  var ReactDOM = window.ReactDOM
  var problems = []
  var consoleMessages = []

  function report(message) {
    problems.push(String(message))
    var box = document.getElementById('errors')
    box.style.display = 'block'
    box.textContent = problems.join('\n')
  }

  // React reports a caught render fault through `console.error`, and the seat's
  // own boundary logs through `console.warn`. Without this the boundary would
  // swallow a real fault and the screenshot would just look empty.
  function intercept(kind) {
    return function () {
      var parts = []
      for (var i = 0; i < arguments.length; i += 1) {
        var part = arguments[i]
        parts.push(part && part.message ? part.message : String(part))
      }
      consoleMessages.push(kind + ': ' + parts.join(' ').slice(0, 500))
    }
  }
  console.warn = intercept('warn')
  console.error = intercept('error')

  window.addEventListener('error', function (event) {
    report('window error: ' + (event && event.message ? event.message : String(event)))
  })

  var entry = window.__entry
  if (!entry || typeof entry.factory !== 'function') {
    report('the bundle did not register a loader entry via window.__ModuleLoader__.load')
    return
  }

  /* ---------------------------------------------------------------- *
   * Materialize the bundle against a `react`-only module table.
   * ---------------------------------------------------------------- */

  var exportsObj
  try {
    exportsObj = entry.factory(function (id) {
      if (id === 'react') return React
      // Anything else means the bundle grew a dependency the platform must grant.
      throw new Error('bundle requested a non-baseline module: ' + id)
    })
  } catch (error) {
    report('factory threw: ' + error.message)
    return
  }

  /* ---------------------------------------------------------------- *
   * Fixtures — one ModelDirectory per rendered row.
   * ---------------------------------------------------------------- */

  var EMPTY = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }
  var fixtures = {}
  var calls = []

  /** Register a snapshot under a synthetic session id and return that id. */
  function fixture(state) {
    var id = 'preview-session-' + Object.keys(fixtures).length
    fixtures[id] = state
    return id
  }

  var models = {
    directoryFor: function (sessionId) {
      var state = fixtures[sessionId] === undefined ? EMPTY : fixtures[sessionId]
      return {
        store: {
          getSnapshot: function () { return state },
          subscribe: function () { return function () {} },
        },
        load: function () { return Promise.resolve(state) },
        select: function (selection) {
          calls.push(selection)
          return Promise.resolve(true)
        },
      }
    },
  }
  var sessions = { subagentAddress: function () { return undefined } }

  var captured = null
  try {
    exportsObj.apply({
      inject: function (_deps, callback) {
        return callback({
          slots: {
            inject: function (_key, callback2) { return callback2() },
            register: function (options, component) {
              captured = { options: options, component: component }
              return { dispose: function () {} }
            },
          },
          modelDirectories: models,
          sessions: sessions,
        })
      },
    })
  } catch (error) {
    report('apply threw: ' + error.message)
    return
  }

  if (captured === null) {
    report('apply registered no seat — the composer would fall back to the shipped menu')
    return
  }

  var Seat = captured.component

  /* ---------------------------------------------------------------- *
   * State builders
   * ---------------------------------------------------------------- */

  var LEVELS_3 = [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }]
  var LEVELS_5 = LEVELS_3.concat([{ id: 'xhigh', name: 'Extra High' }, { id: 'max', name: 'Max' }])

  /**
   * Build one catalogue snapshot.
   * @param levels - advertised efforts, or null for a model without reasoning metadata.
   * @param effort - the session's current effort, omitted for "provider default".
   * @param options - `{ noDefault, locked }`.
   */
  function snapshot(levels, effort, options) {
    var opts = options || {}
    var model = { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }
    if (levels !== null) {
      model.reasoning = { efforts: levels }
      if (opts.noDefault !== true) model.reasoning.defaultEffort = 'medium'
    }
    var current = { provider: 'deepseek', model: model.id }
    if (effort !== undefined) current.reasoningEffort = effort
    return {
      current: current,
      routable: true,
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [model] }],
      failures: [],
      status: 'ready',
      error: null,
    }
  }

  var ROWS = [
    { caption: '3 档 · 当前 High（最强档，应出现消费提示）', state: snapshot(LEVELS_3, 'high') },
    { caption: '3 档 · 当前 Medium（中间档）', state: snapshot(LEVELS_3, 'medium') },
    { caption: '3 档 · 当前 Low（最弱档）', state: snapshot(LEVELS_3, 'low') },
    { caption: '5 档 · 当前 Extra High', state: snapshot(LEVELS_5, 'xhigh') },
    { caption: '5 档 · 当前 Max（最强档）', state: snapshot(LEVELS_5, 'max') },
    { caption: 'adapter 未声明 defaultEffort · 左端多一个「默认」档', state: snapshot(LEVELS_3, undefined, { noDefault: true }) },
    { caption: '只有一档 · 不渲染控件，只显示档位名', state: snapshot([{ id: 'high', name: 'High' }], 'high') },
    { caption: '模型没有 reasoning 元数据 · 只剩模型触发器', state: snapshot(null, undefined) },
    // The GUI falls back to `currentModel.name || currentModel.id`, so a raw
    // provider id (and a long one) is a real input, not a synthetic edge case.
    {
      caption: '超长模型 id（无显示名）· 模型段省略号，强度段不截断',
      state: {
        current: { provider: 'deepseek', model: 'deepseek-v4.1-flash-preview-0731', reasoningEffort: 'xhigh' },
        routable: true,
        groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4.1-flash-preview-0731', reasoning: { defaultEffort: 'medium', efforts: LEVELS_5 } }] }],
        failures: [],
        status: 'ready',
        error: null,
      },
    },
    { caption: 'locked（会话锁定时禁用）', state: snapshot(LEVELS_3, 'medium'), locked: true },
  ]

  /* A two-provider catalogue, so the menu's grouping and check marks are
   * actually exercised rather than assumed. */
  var MENU_STATE = {
    current: { provider: 'deepseek', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' },
    routable: true,
    groups: [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', reasoning: { defaultEffort: 'medium', efforts: LEVELS_5 } },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: { defaultEffort: 'high', efforts: LEVELS_3 } },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'gpt-5.6-codex', name: 'GPT-5.6 Codex', reasoning: { defaultEffort: 'medium', efforts: LEVELS_3 } }],
      },
    ],
    failures: [],
    status: 'ready',
    error: null,
  }

  /* ---------------------------------------------------------------- *
   * Mount
   * ---------------------------------------------------------------- */

  var stage = document.getElementById('stage')
  var heading = document.createElement('div')
  var themeName = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'

  // The seat is collapsed by default and both of its open states belong to the
  // panel / model list now, so each mode renders a single seat and opens it with
  // real clicks. Real clicks are the point: the unit suite drives a single-pass
  // renderer whose `useState` cannot re-render, which makes `view !== 'closed'`
  // structurally unreachable there.
  var params = new URLSearchParams(location.search)
  var MENU_MODE = params.get('menu') === '1'
  var PANEL_MODE = params.get('panel') === '1'
  // `dir=down` leaves no room above the trigger, which is what makes the panel
  // flip below it — the same flip Codex's own panel makes near a viewport edge.
  var PANEL_DOWN = params.get('dir') === 'down'
  // `focus=1` drives the open/close cycle and records `document.activeElement`
  // at each step: focus restoration is a layout effect, which the unit suite's
  // single-pass renderer never runs, so this is the only honest place to measure
  // it.
  var FOCUS_MODE = params.get('focus') === '1'
  if (MENU_MODE || PANEL_MODE || FOCUS_MODE) {
    ROWS = [{
      caption: FOCUS_MODE
        ? '关闭路径的焦点去向（Esc 还焦点给 trigger；外部点击不抢）'
        : MENU_MODE
          ? '模型列表（真实点击：触发 → 面板 → 模型行）'
          : PANEL_DOWN
            ? '二级面板 · 上方空间不足，朝下弹出'
            : '二级面板（真实点击展开：模型行 + 更快/更强轴标 + 档位条）',
      state: MENU_STATE,
    }]
    stage.style.paddingTop = FOCUS_MODE ? '60px' : PANEL_DOWN ? '24px' : '200px'
  }

  heading.innerHTML = '<h1>dsh-reasoning-slider · 推理强度档位条预览</h1>'
    + '<p class="sub">真实 bundle + 真实 React + 真实 DSH 主题 token（' + themeName + (FOCUS_MODE ? ' · 焦点' : MENU_MODE ? ' · 模型列表' : PANEL_MODE ? ' · 面板' : '') + '）</p>'
  stage.appendChild(heading)

  ROWS.forEach(function (row, index) {
    var wrap = document.createElement('div')
    wrap.className = 'row'

    var cap = document.createElement('div')
    cap.className = 'cap'
    cap.textContent = (index + 1) + '. ' + row.caption

    var composer = document.createElement('div')
    composer.className = 'composer'
    var fake = document.createElement('span')
    fake.className = 'fakeinput'
    fake.textContent = '给 DSH 发消息…'
    var seatHost = document.createElement('div')
    seatHost.className = 'seat'
    composer.appendChild(fake)
    composer.appendChild(seatHost)

    wrap.appendChild(cap)
    wrap.appendChild(composer)
    stage.appendChild(wrap)

    var id = fixture(row.state)
    var face
    try {
      face = captured.options.inject(id)
    } catch (error) {
      report('inject(' + id + ') threw: ' + error.message)
      return
    }

    var props = {
      locked: row.locked === true,
      available: face.available,
      directory: face.directory,
      load: face.load,
      select: face.select,
    }

    try {
      ReactDOM.createRoot(seatHost).render(React.createElement(Seat, props))
    } catch (error) {
      report('row ' + (index + 1) + ' failed to render: ' + error.message)
    }
  })

  /* ---------------------------------------------------------------- *
   * Machine-readable facts
   * ---------------------------------------------------------------- */

  /** A viewport rect in CSS px, or null when the node is absent. */
  function rectOf(node) {
    if (node === null || node === undefined) return null
    var box = node.getBoundingClientRect()
    return { x: box.left, y: box.top, width: box.width, height: box.height }
  }

  /** Is a box fully inside the viewport? A float that is not is not evidence. */
  function onScreen(box) {
    return box.width > 0 && box.height > 0
      && box.x >= 0 && box.y >= 0
      && box.x + box.width <= window.innerWidth + 0.5
      && box.y + box.height <= window.innerHeight + 0.5
  }

  /** Read the open panel: geometry, which side it flipped to, and its two rows. */
  function panelFacts(node) {
    var box = node.getBoundingClientRect()
    var axis = node.querySelector('.drs-axis')
    var row = node.querySelector('.drs-model-row')
    var name = node.querySelector('.drs-model-row-name')
    var chevron = node.querySelector('.drs-chevron-right')
    var single = node.querySelector('.drs-single')
    var labels = []
    if (axis !== null) {
      for (var i = 0; i < axis.children.length; i += 1) labels.push(axis.children[i].textContent)
    }
    var style = window.getComputedStyle(node)
    return {
      role: node.getAttribute('role'),
      side: node.getAttribute('data-drs-side'),
      width: box.width,
      height: box.height,
      rect: { x: box.left, y: box.top, width: box.width, height: box.height },
      onScreen: onScreen({ x: box.left, y: box.top, width: box.width, height: box.height }),
      padding: style.paddingTop + ' ' + style.paddingRight + ' ' + style.paddingBottom + ' ' + style.paddingLeft,
      radius: style.borderTopLeftRadius,
      modelRow: name === null ? null : name.textContent,
      modelRowHeight: row === null ? null : row.getBoundingClientRect().height,
      chevron: chevron === null ? null : chevron.tagName.toLowerCase(),
      axis: labels,
      single: single === null ? null : single.textContent,
    }
  }

  /** Collect one rendered row's CSS facts. */
  function factsFor(wrap, index) {
    var input = wrap.querySelector('input[type="range"]')
    var label = wrap.querySelector('.drs-trigger-effort')
    var trigger = wrap.querySelector('.drs-trigger')
    var model = wrap.querySelector('.drs-trigger-model')
    var caret = wrap.querySelector('.drs-caret')
    var panel = wrap.querySelector('.drs-panel')
    var seatHost = wrap.querySelector('.seat')
    var hosted = seatHost === null ? false : seatHost.childElementCount > 0
    var common = {
      row: index,
      hosted: hosted,
      dpr: window.devicePixelRatio || 1,
      trigger: trigger === null ? null : trigger.textContent,
      triggerModel: model === null ? null : model.textContent,
      triggerTitle: trigger === null ? null : trigger.getAttribute('title'),
      ariaExpanded: trigger === null ? null : trigger.getAttribute('aria-expanded'),
      modelColor: model === null ? null : window.getComputedStyle(model).color,
      effortLabel: label === null ? null : label.textContent,
      effortColor: label === null ? null : window.getComputedStyle(label).color,
      // The chevron must be a drawn icon, not the old `▾` text glyph.
      caretTag: caret === null ? null : caret.tagName.toLowerCase(),
      // Proof that the model segment yields and the effort segment does not:
      // the real GUI can hand the seat a raw model id with no display name.
      modelClipped: model === null ? null : model.scrollWidth > model.clientWidth + 0.5,
      effortClipped: label === null ? null : label.scrollWidth > label.clientWidth + 0.5,
      panel: panel === null ? null : panelFacts(panel),
    }
    if (input === null) {
      // Collapsed: the trigger is the only thing there is to measure, and the
      // pixel audit crops to it rather than falling back to the whole page.
      return Object.assign(common, { slider: false, rect: rectOf(trigger) })
    }
    var style = window.getComputedStyle(input)
    var thumbRule = null
    var styleTag = document.querySelector('style[data-plugin-css$="/seat.css"]')
    if (styleTag !== null) {
      var match = /\.drs-range::-webkit-slider-thumb\{([^}]*)\}/.exec(styleTag.textContent)
      thumbRule = match === null ? null : match[1]
    }
    return Object.assign(common, {
      slider: true,
      min: input.min,
      max: input.max,
      value: input.value,
      ariaLabel: input.getAttribute('aria-label'),
      ariaValueText: input.getAttribute('aria-valuetext'),
      title: input.getAttribute('title'),
      label: label === null ? null : label.textContent,
      labelColor: label === null ? null : window.getComputedStyle(label).color,
      // The pixel audit crops to this box (CSS px; scale by `dpr`), so the
      // measured colour is the control's, not the page's text antialiasing.
      rect: rectOf(wrap.querySelector('.drs-slider')),
      backgroundImage: style.backgroundImage,
      backgroundSize: style.backgroundSize,
      backgroundPosition: style.backgroundPosition,
      trackBackgroundImage: style.getPropertyValue('--drs-track').trim(),
      trackBackgroundSize: style.getPropertyValue('--drs-track-size').trim(),
      accent: style.getPropertyValue('--drs-accent').trim(),
      thumbRule: thumbRule,
    })
  }

  // React 18 commits each `createRoot` on its own schedule, so a fixed number of
  // frames is not enough: wait until every seat host has actually produced DOM.
  //
  // The poll deliberately rides `setTimeout` rather than `requestAnimationFrame`:
  // a headless capture runs under `--virtual-time-budget`, and once that budget
  // is spent pending animation frames simply stop firing. An rAF-driven poll then
  // stalls forever and the facts sink is never appended — which is exactly how
  // the dark capture used to come back with a screenshot and no facts.
  var attempts = 0
  var emitted = false
  var clickedTrigger = false
  var clickedRow = false

  function countMounted() {
    var hosts = stage.querySelectorAll('.seat')
    var mounted = 0
    for (var i = 0; i < hosts.length; i += 1) if (hosts[i].childElementCount > 0) mounted += 1
    return { mounted: mounted, total: hosts.length }
  }

  /** Read the opened model menu out of the DOM. */
  function menuFacts() {
    var menu = document.querySelector('[role="menu"]')
    var options = document.querySelectorAll('[role="menuitemradio"]')
    var groups = document.querySelectorAll('[role="group"]')
    var checked = 0
    var labels = []
    for (var i = 0; i < options.length; i += 1) {
      if (options[i].getAttribute('aria-checked') === 'true') checked += 1
      labels.push(options[i].textContent)
    }
    var rect = null
    if (menu !== null) {
      var box = menu.getBoundingClientRect()
      rect = { x: box.left, y: box.top, width: box.width, height: box.height }
    }
    return { open: menu !== null, options: options.length, groups: groups.length, checked: checked, labels: labels, rect: rect }
  }

  /**
   * Open the seat one real click at a time. The trigger click has to land before
   * the model row exists, so this is a two-pass choreography, not one pass.
   */
  function openTheSeat() {
    if (clickedTrigger !== true) {
      var trigger = document.querySelector('.drs-trigger')
      if (trigger === null) return
      clickedTrigger = true
      trigger.click()
      return
    }
    if (MENU_MODE !== true || clickedRow === true) return
    var row = document.querySelector('.drs-model-row')
    if (row === null) return
    clickedRow = true
    row.click()
  }

  /* ---------------------------------------------------------------- *
   * Focus choreography (`?focus=1`)
   * ---------------------------------------------------------------- */

  var focusLog = []
  var focusStep = 0

  /** Describe the current focus owner, the open level, and what holds focus. */
  function focusNow(label) {
    var active = document.activeElement
    var panel = document.querySelector('.drs-panel')
    var menu = document.querySelector('[role="menu"]')
    var usable = active !== null && active !== undefined && active.classList !== undefined
    return {
      step: focusStep,
      label: label,
      tag: usable ? active.tagName.toLowerCase() : null,
      className: usable ? String(active.className) : null,
      role: usable ? active.getAttribute('role') : null,
      isTrigger: usable ? active.classList.contains('drs-trigger') : false,
      inPanel: usable && typeof active.closest === 'function' ? active.closest('.drs-panel') !== null : false,
      isBody: usable ? active === document.body : false,
      view: panel !== null ? 'panel' : menu !== null ? 'models' : 'closed',
    }
  }

  /**
   * One step per `settle` tick, so React has committed (and its layout effects
   * have run) between a state change and the measurement.
   */
  function focusChoreography() {
    // Only step 0 waits for the panel to exist; from then on the sequence drives
    // the state itself, and after the Escape the panel is legitimately gone.
    if (focusStep === 0 && document.querySelector('.drs-panel') === null) return
    if (focusStep === 0) {
      focusLog.push(focusNow('after-open'))
      focusStep = 1
      return
    }
    if (focusStep === 1) {
      var active = document.activeElement
      var from = active === null || active === undefined ? document.body : active
      from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      focusStep = 2
      return
    }
    if (focusStep === 2) {
      focusLog.push(focusNow('after-escape'))
      focusStep = 3
      return
    }
    if (focusStep === 3) {
      var trigger = document.querySelector('.drs-trigger')
      if (trigger !== null) trigger.click()
      focusStep = 4
      return
    }
    if (focusStep === 4) {
      focusLog.push(focusNow('after-reopen'))
      focusStep = 5
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      return
    }
    if (focusStep === 5) {
      focusLog.push(focusNow('after-outside-mousedown'))
      focusStep = 6
    }
  }

  /** The stop centres the seat itself lays out, read back from its own layers. */
  function stopCentres(input) {
    var sizes = input.style.getPropertyValue('--drs-track-size').split(',')
    var positions = input.style.getPropertyValue('--drs-track-pos').split(',')
    // dot layers, then the fill, then the resting track — so the dots are all
    // but the last two entries, and each is a 3px dot (hence the 1.5px shift).
    var dots = sizes.length - 2
    var out = []
    for (var i = 0; i < dots && i < positions.length; i += 1) out.push(parseFloat(positions[i]) + 1.5)
    return out
  }

  /**
   * Drive the bar with real pointer events and read back what it says.
   *
   * The readout is a hover-only node, so a browser is the only place it can be
   * observed. React 18 batches the state update an event produces, so the read
   * for a move must happen on a LATER tick than the dispatch — which is why this
   * is a step in the settle loop rather than one synchronous pass.
   */
  var hoverLog = null
  var hoverWrap = null
  var hoverBox = null
  var hoverIndex = 0
  var hoverPhase = 'setup'

  function hoverRead() {
    var node = hoverWrap.querySelector('.drs-hover')
    if (node === null) return null
    var rect = node.getBoundingClientRect()
    return {
      text: node.textContent,
      centre: rect.left + rect.width / 2 - hoverBox.left,
      width: rect.width,
    }
  }

  function hoverDispatch(type, x, relatedTarget) {
    if (typeof window.PointerEvent !== 'function') return
    var init = {
      bubbles: true,
      clientX: x === null ? hoverBox.left : hoverBox.left + x,
      clientY: hoverBox.top + hoverBox.height / 2,
    }
    if (relatedTarget !== undefined) init.relatedTarget = relatedTarget
    hoverWrap.dispatchEvent(new window.PointerEvent(type, init))
  }

  function hoverChoreography() {
    if (hoverPhase === 'setup') {
      var panel = document.querySelector('.drs-panel')
      if (panel === null) return
      var wrap = panel.querySelector('.drs-track-wrap')
      var input = panel.querySelector('input[type="range"]')
      if (wrap === null || input === null) return
      hoverWrap = wrap
      hoverBox = wrap.getBoundingClientRect()
      hoverLog = {
        hasPointer: typeof window.PointerEvent === 'function',
        trackWidth: hoverBox.width,
        centres: stopCentres(input),
        steps: [],
        // The stop the seat currently sits on must read back its own name — a
        // self-consistency check that needs no fixture knowledge.
        current: {
          index: Number(input.value),
          label: input.getAttribute('aria-valuetext'),
        },
        afterLeave: null,
      }
      hoverIndex = 0
      hoverPhase = 'move'
      return
    }
    if (hoverPhase === 'move') {
      hoverDispatch('pointermove', hoverLog.centres[hoverIndex])
      hoverIndex += 1
      hoverPhase = 'read'
      return
    }
    if (hoverPhase === 'read') {
      hoverLog.steps.push({ stop: hoverIndex - 1, x: hoverLog.centres[hoverIndex - 1], read: hoverRead() })
      hoverPhase = hoverIndex < hoverLog.centres.length ? 'move' : 'leave'
      return
    }
    if (hoverPhase === 'leave') {
      // React synthesises `onPointerLeave` from `pointerout` (leave itself does
      // not bubble and is never delegated), so the exit has to be a `pointerout`
      // whose relatedTarget is outside the bar.
      hoverDispatch('pointerout', null, document.body)
      hoverPhase = 'afterLeave'
      return
    }
    if (hoverPhase === 'afterLeave') {
      hoverLog.afterLeave = hoverRead()
      hoverPhase = 'done'
    }
  }

  /** Has the mode's target state actually rendered? */
  function modeReady() {
    if (MENU_MODE) return document.querySelector('[role="menu"]') !== null
    if (PANEL_MODE) {
      return document.querySelector('.drs-panel') !== null
        && document.querySelector('.drs-panel input[type="range"]') !== null
    }
    return true
  }

  function settle() {
    attempts += 1
    var seen = countMounted()
    var mountedAll = seen.mounted >= seen.total
    // Only the open-state modes click anything: the default matrix exists to
    // show the collapsed seat, and a stray click would open row 1's panel over
    // its neighbours.
    if (mountedAll && (MENU_MODE || PANEL_MODE || FOCUS_MODE)) openTheSeat()
    if (mountedAll && FOCUS_MODE) focusChoreography()
    if (mountedAll && PANEL_MODE) hoverChoreography()
    var ready = mountedAll && modeReady()
      && (FOCUS_MODE !== true || focusStep >= 6)
      && (PANEL_MODE !== true || hoverPhase === 'done')
    if (ready !== true && attempts < 120) {
      setTimeout(settle, 16)
      return
    }
    emit()
  }

  function emit() {
    if (emitted) return
    emitted = true
    var seen = countMounted()
    var rows = stage.querySelectorAll('.row')
    var facts = []
    for (var j = 0; j < rows.length; j += 1) facts.push(factsFor(rows[j], j + 1))

    var styleTag = document.querySelector('style[data-plugin-css$="/seat.css"]')
    window.__previewFacts = {
      theme: themeName,
      menuMode: MENU_MODE,
      panelMode: PANEL_MODE,
      panelDown: PANEL_DOWN,
      focusMode: FOCUS_MODE,
      menu: MENU_MODE ? menuFacts() : null,
      hover: PANEL_MODE ? hoverLog : null,
      focus: FOCUS_MODE ? focusLog : null,
      focusStep: FOCUS_MODE ? focusStep : null,
      mounted: seen.mounted,
      total: seen.total,
      attempts: attempts,
      problems: problems,
      console: consoleMessages,
      css: styleTag === null ? null : styleTag.textContent,
      rows: facts,
    }
    window.__previewReady = true

    // Mirror the facts into the DOM as base64 so a plain
    // `chrome --dump-dom` run can read them without a CDP client.
    var sink = document.createElement('pre')
    sink.id = 'facts'
    sink.hidden = true
    sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(window.__previewFacts))))
    document.body.appendChild(sink)
  }

  setTimeout(settle, 0)
  // Backstop: if virtual time expires mid-poll, still leave a readable sink.
  setTimeout(emit, 2500)
})()
