/**
 * dsh-reasoning-slider — browser half (the served client bundle).
 *
 * Replaces the composer's model seat (`conversation.input.model`) with a seat
 * whose reasoning-effort control is a Codex-style slider walking the
 * adapter-advertised effort levels, tinted from blue (weakest) to orange
 * (strongest). The model picker itself stays a menu on the same trigger.
 *
 * Contract notes — why this file looks the way it does:
 *
 * - A client bundle is a *factory registration*: executing the file only calls
 *   `window.__ModuleLoader__.load`, and the module body (`factory`) runs at
 *   materialization. `require` resolves the frozen platform table
 *   (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
 *   `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`,
 *   `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`)
 *   plus rows named by `dsh.client.external`. This bundle requests only
 *   `react`, so it declares no `external` and cannot fail composition.
 *
 * - `conversation.input.model` is a `single`, session-scoped slot already
 *   occupied by `@deepseek-ai/dsh-client-ui-model-selection` at the default
 *   priority 0, and registering at an *occupied cell's exact priority throws*.
 *   This seat therefore shadows it at priority -1 ("lowest renders"). Both
 *   occupants read and write the SAME per-session `ModelDirectory`
 *   (`ctx.modelDirectories.directoryFor(sessionId)`), so the shipped `/model`
 *   popup and this seat keep showing one shared selection.
 *
 * - Everything is defensive: the registration only happens once `slots`,
 *   `modelDirectories` and `sessions` all exist (a plain Cordis service wait,
 *   so a kernel without them leaves the shipped seat untouched), the injected
 *   face always returns a usable store even on failure, and the component is
 *   wrapped in an error boundary so a render fault can never take down the
 *   surrounding React tree.
 */
window.__ModuleLoader__.load({
  id: 'dsh-reasoning-slider',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement

    /* ------------------------------------------------------------------ *
     * Styles — one deduplicated <style> tag, keyed like the shipped
     * bundles so HMR's style inventory can find and remove it.
     * ------------------------------------------------------------------ */

    var STYLE_KEY = 'dsh-reasoning-slider/seat.css'
    /**
     * Build the Codex-style stop track: one dot per advertised level, drawn as
     * stacked background layers above a fill that ends at the current level.
     * @param count - number of levels.
     * @param progress - 0..1 position of the current level.
     * @param accent - the ramp tint at the current level.
     * @returns the `background-image` and `background-size` layer lists.
     */
    function trackLayers(count, progress, accent) {
      var ratio = typeof progress === 'number' && progress === progress ? progress : 0
      if (ratio < 0) ratio = 0
      if (ratio > 1) ratio = 1
      var images = []
      var sizes = []
      for (var i = 0; i < count; i += 1) {
        var at = count <= 1 ? 50 : (i / (count - 1)) * 100
        var reached = at <= ratio * 100 + 0.6
        var dot = reached ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.55)'
        images.push('radial-gradient(circle at ' + at.toFixed(3) + '% 50%,' + dot + ' 0 1.8px,rgba(0,0,0,0) 1.9px)')
        sizes.push('auto')
      }
      // The fill is the bottom-most layer: whatever it does not cover stays the
      // track's own background-color, so an unfilled remainder still reads as a
      // groove rather than disappearing.
      images.push('linear-gradient(90deg,#3b82f6 0%,' + accent + ' 100%)')
      sizes.push((ratio * 100).toFixed(2) + '% 100%')
      return { image: images.join(','), size: sizes.join(',') }
    }
    var CSS = [
      '.drs-root{position:relative;display:flex;align-items:center;gap:2px;min-width:0}',
      '.drs-trigger{min-width:0;max-width:min(220px,32cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 6px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}',
      '.drs-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.drs-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.drs-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.drs-trigger-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.drs-caret{flex:none;color:var(--dsw-alias-label-caption);font-size:10px;line-height:1}',
      '.drs-slider{display:flex;align-items:center;gap:6px;min-width:0}',
      '.drs-range{-webkit-appearance:none;appearance:none;display:block;width:142px;height:22px;margin:0;padding:0;background:transparent;cursor:pointer;outline:none}',
      '.drs-range:disabled{cursor:default;opacity:.55}',
      '.drs-range:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);border-radius:999px}',
      '.drs-range::-webkit-slider-runnable-track{height:8px;border-radius:999px;background-color:rgba(127,127,127,.3);background-image:var(--drs-track,none);background-size:var(--drs-track-size,auto);background-repeat:no-repeat}',
      '.drs-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-3px;border:0;border-radius:50%;background:var(--drs-accent,#3b82f6);box-shadow:0 0 0 2px rgba(127,127,127,.42),0 0 10px var(--drs-accent,#3b82f6)}',
      '.drs-range::-moz-range-track{height:8px;border-radius:999px;background-color:rgba(127,127,127,.3);background-image:var(--drs-track,none);background-size:var(--drs-track-size,auto);background-repeat:no-repeat}',
      '.drs-range::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:var(--drs-accent,#3b82f6);box-shadow:0 0 0 2px rgba(127,127,127,.42),0 0 10px var(--drs-accent,#3b82f6)}',
      '.drs-effort{font-size:11px;font-weight:600;line-height:16px;color:var(--drs-accent,#3b82f6);white-space:nowrap;max-width:76px;overflow:hidden;text-overflow:ellipsis}',
      '.drs-top{flex:none;font-size:11px;line-height:1;color:var(--drs-accent,#f97316)}',
      '.drs-notice{position:absolute;bottom:calc(100% + 6px);right:0;z-index:1101;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,113,113,.16));color:var(--dsw-alias-state-error-primary,#f87171);font-size:12px;line-height:18px;white-space:nowrap}',
      '.drs-menu{position:fixed;z-index:1100;display:flex;flex-direction:column;padding:4px;background:var(--dsw-specific-menu,#1f1f24);color:var(--dsw-alias-label-primary,#eaeaea);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);border:0;border-radius:20px;box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.45));overflow:hidden}',
      '.drs-groups{overflow-y:auto;display:flex;flex-direction:column;gap:2px}',
      '.drs-group{display:flex;flex-direction:column;gap:2px;padding:2px 0}',
      '.drs-group-title{padding:6px 10px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-option{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:8px 10px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.drs-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.drs-option:disabled{cursor:default;opacity:.55}',
      '.drs-option-name{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0}',
      '.drs-check{flex:none;font-size:12px;line-height:1;color:var(--drs-accent,#3b82f6)}',
      '.drs-status,.drs-empty{padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-error{padding:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#f87171);word-break:break-word}',
    ].join('\n')

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + STYLE_KEY + '"]') === null) {
      var styleTag = document.createElement('style')
      styleTag.dataset.plugin = 'dsh-reasoning-slider'
      styleTag.dataset.pluginCss = STYLE_KEY
      styleTag.textContent = CSS
      document.head.appendChild(styleTag)
    }

    /* ------------------------------------------------------------------ *
     * Blue → orange ramp
     * ------------------------------------------------------------------ */

    /** Gradient stops in RGB; the slider tint is sampled from the same ramp. */
    var STOPS = [
      [0, [59, 130, 246]],
      [0.25, [124, 92, 246]],
      [0.5, [180, 92, 240]],
      [0.75, [234, 90, 160]],
      [1, [249, 115, 22]],
    ]

    /**
     * Sample the ramp at a normalized position.
     * @param ratio - 0 (weakest, blue) through 1 (strongest, orange).
     * @returns an `rgb(...)` colour string; never throws.
     */
    function tintAt(ratio) {
      var t = typeof ratio === 'number' && ratio === ratio ? ratio : 0
      if (t < 0) t = 0
      if (t > 1) t = 1
      var upperIndex = STOPS.length - 1
      for (var i = 1; i < STOPS.length; i += 1) {
        if (t <= STOPS[i][0]) {
          upperIndex = i
          break
        }
      }
      var lower = STOPS[upperIndex - 1]
      var upper = STOPS[upperIndex]
      var span = upper[0] - lower[0]
      var k = span <= 0 ? 0 : (t - lower[0]) / span
      if (k < 0) k = 0
      if (k > 1) k = 1
      var r = Math.round(lower[1][0] + (upper[1][0] - lower[1][0]) * k)
      var g = Math.round(lower[1][1] + (upper[1][1] - lower[1][1]) * k)
      var b = Math.round(lower[1][2] + (upper[1][2] - lower[1][2]) * k)
      return 'rgb(' + r + ',' + g + ',' + b + ')'
    }

    /* ------------------------------------------------------------------ *
     * Injected face
     * ------------------------------------------------------------------ */

    /** Stable empty snapshot: keeps `useSyncExternalStore` safe when unavailable. */
    var EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

    /** An inert store with a stable snapshot identity. */
    var IDLE_STORE = {
      getSnapshot: function () { return EMPTY_STATE },
      subscribe: function () { return function () {} },
    }

    function noop() {}

    function rejectSelection() { return Promise.resolve(false) }

    /**
     * Build the seat's injected face for one Session.
     *
     * The shipped seat resolves the same objects; this wrapper only adds the
     * containment the seat needs to stay renderable when resolution fails.
     * @param models - the `ctx.modelDirectories` service.
     * @param sessions - the `ctx.sessions` service.
     * @param sessionId - the Session this seat renders for.
     * @returns the face; `available: false` renders nothing.
     */
    function faceFor(models, sessions, sessionId) {
      var directory = null
      var available = false
      var trace = ''
      try {
        trace += 'models=' + (models ? typeof models.directoryFor : String(models))
        trace += ' sessions=' + (sessions ? typeof sessions.subagentAddress : String(sessions))
        available = sessions.subagentAddress(sessionId) === undefined
        trace += ' subagent=' + available
        if (available) directory = models.directoryFor(sessionId)
        trace += ' dir=' + (directory === null || directory === undefined ? 'nil' : typeof directory)
        trace += ' store=' + (directory && directory.store !== undefined ? 'yes' : 'no')
      } catch (error) {
        available = false
        directory = null
        trace += ' THREW=' + (error && error.message !== undefined ? String(error.message) : String(error))
      }
      if (!available || directory === null || directory === undefined || directory.store === undefined) {
        return { available: false, trace: trace, directory: IDLE_STORE, load: noop, select: rejectSelection }
      }
      return {
        available: true,
        trace: trace,
        directory: directory.store,
        load: function () {
          try {
            var loading = directory.load()
            if (loading && typeof loading.catch === 'function') loading.catch(noop)
          } catch (error) { /* a failed load surfaces on the store, never here */ }
        },
        select: function (selection) {
          try {
            return directory.select(selection).then(
              function () { return true },
              function () { return false },
            )
          } catch (error) {
            return Promise.resolve(false)
          }
        },
      }
    }

    /* ------------------------------------------------------------------ *
     * Error boundary — a render fault degrades to an empty seat
     * ------------------------------------------------------------------ */

    class SeatBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        try {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[dsh-reasoning-slider] model seat failed to render; leaving the seat empty instead of breaking the composer:', error)
          }
        } catch (ignored) { /* logging is best-effort */ }
      }

      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    /* ------------------------------------------------------------------ *
     * The seat
     * ------------------------------------------------------------------ */

    /**
     * Render the composer model seat: model menu on the trigger, reasoning
     * effort on a blue→orange slider.
     * @param props - owner share (`locked`) plus the injected face.
     * @returns the seat element tree.
     */
    function EffortSeat(props) {
      var locked = props.locked === true
      var available = props.available === true
      var directory = props.directory === undefined || props.directory === null ? IDLE_STORE : props.directory
      var load = typeof props.load === 'function' ? props.load : noop
      var select = typeof props.select === 'function' ? props.select : rejectSelection

      var state = React.useSyncExternalStore(
        function (subscribe) { return directory.subscribe(subscribe) },
        function () { return directory.getSnapshot() },
      )

      var dragPair = React.useState(null)
      var drag = dragPair[0]
      var setDrag = dragPair[1]
      var openPair = React.useState(false)
      var open = openPair[0]
      var setOpen = openPair[1]
      var posPair = React.useState(null)
      var menuPos = posPair[0]
      var setMenuPos = posPair[1]
      var noticePair = React.useState(null)
      var notice = noticePair[0]
      var setNotice = noticePair[1]

      var rootRef = React.useRef(null)
      var triggerRef = React.useRef(null)
      var menuRef = React.useRef(null)
      var reactId = React.useId()

      var groups = Array.isArray(state.groups) ? state.groups : []
      var current = state.current === undefined ? null : state.current
      var busy = state.status === 'selecting'

      /* Resolve the current model's catalogue row. */
      var currentGroup = null
      var currentModel = null
      if (current !== null) {
        for (var gi = 0; gi < groups.length; gi += 1) {
          var group = groups[gi]
          var models = group && Array.isArray(group.models) ? group.models : []
          for (var mi = 0; mi < models.length; mi += 1) {
            if (group.id === current.provider && models[mi] && models[mi].id === current.model) {
              currentGroup = group
              currentModel = models[mi]
              break
            }
          }
          if (currentModel !== null) break
        }
      }

      var reasoning = currentModel !== null && currentModel.reasoning !== undefined ? currentModel.reasoning : undefined
      var advertised = reasoning !== undefined && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
      var defaultEffort = reasoning === undefined ? undefined : reasoning.defaultEffort
      var effectiveEffort = current !== null && current.reasoningEffort !== undefined
        ? current.reasoningEffort
        : defaultEffort

      /* The slider's stops: the model's own order, plus a leading "provider
       * default" stop exactly when the adapter names no default. */
      var levels = []
      if (reasoning !== undefined && advertised.length > 0) {
        if (defaultEffort === undefined) levels.push({ effort: undefined, label: '默认' })
        for (var ei = 0; ei < advertised.length; ei += 1) {
          var effort = advertised[ei]
          if (effort === undefined || effort === null || effort.id === undefined) continue
          levels.push({
            effort: effort.id,
            label: typeof effort.name === 'string' && effort.name !== '' ? effort.name : String(effort.id),
          })
        }
      }

      var settled = 0
      for (var li = 0; li < levels.length; li += 1) {
        if (levels[li].effort === effectiveEffort) {
          settled = li
          break
        }
      }

      var index = drag !== null && drag >= 0 && drag < levels.length ? drag : settled
      var ratio = levels.length <= 1 ? 1 : index / (levels.length - 1)
      var accent = tintAt(ratio)
      var levelLabel = levels.length > 0 ? levels[index].label : undefined
      var track = trackLayers(levels.length, ratio, accent)
      var atTopLevel = levels.length > 1 && index === levels.length - 1
      var topHint = '最强档位：思考更充分，也更快消耗额度'

      /* A settled store value retires the local drag override. */
      React.useEffect(function () {
        setDrag(null)
      }, [effectiveEffort, currentModel === null ? null : currentModel.id, currentGroup === null ? null : currentGroup.id])

      /* Transient failure notice. */
      React.useEffect(function () {
        if (notice === null) return undefined
        var timer = setTimeout(function () { setNotice(null) }, 2600)
        return function () { clearTimeout(timer) }
      }, [notice])

      /* Outside click closes the menu. */
      React.useEffect(function () {
        if (!open) return undefined
        function onMouseDown(event) {
          var target = event.target
          if (target instanceof Node) {
            if (rootRef.current !== null && rootRef.current.contains(target)) return
            if (menuRef.current !== null && menuRef.current.contains(target)) return
          }
          setOpen(false)
        }
        document.addEventListener('mousedown', onMouseDown)
        return function () { document.removeEventListener('mousedown', onMouseDown) }
      }, [open])

      /* Place the menu above the trigger, clamped into the viewport. */
      React.useLayoutEffect(function () {
        if (!open) {
          setMenuPos(null)
          return undefined
        }
        function place() {
          var trigger = triggerRef.current
          if (trigger === null) return
          var rect = trigger.getBoundingClientRect()
          var menu = menuRef.current
          var width = menu === null ? 0 : menu.offsetWidth
          var height = menu === null ? 0 : menu.offsetHeight
          var margin = 12
          var x = rect.right - width
          var y = rect.top - 8 - height
          if (width > 0) x = Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - width - margin))
          if (height > 0) y = Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - height - margin))
          setMenuPos({ left: x, top: y })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return function () {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open, state])

      var trace = typeof props.trace === 'string' ? props.trace : ''
      var diagnostics = JSON.stringify({
        available: available,
        locked: locked,
        status: state.status,
        groups: groups.length,
        current: current === null ? null : current.provider + '/' + current.model,
        levels: levels.length,
        trace: trace,
      })

      if (!available) {
        return h('div', { 'data-drs-debug': diagnostics, style: { display: 'none' } })
      }

      /**
       * Commit a slider stop to the Host.
       * @param nextIndex - the stop the user landed on.
       */
      function commit(nextIndex) {
        if (current === null) return
        if (nextIndex < 0 || nextIndex >= levels.length) return
        var level = levels[nextIndex]
        if (level.effort === effectiveEffort) return
        var selection = { provider: current.provider, model: current.model }
        if (level.effort !== undefined) selection.reasoningEffort = level.effort
        var settle = function (accepted) {
          if (accepted === true) return
          setDrag(null)
          setNotice('推理强度切换失败')
        }
        try {
          var pending = select(selection)
          if (pending && typeof pending.then === 'function') pending.then(settle, function () { settle(false) })
        } catch (error) {
          settle(false)
        }
      }

      /**
       * Commit a model choice. Effort is intentionally omitted so the Host
       * applies the new model's own default, matching the shipped seat.
       * @param provider - provider id.
       * @param model - provider-owned model id.
       */
      function chooseModel(provider, model) {
        if (current !== null && current.provider === provider && current.model === model) {
          setOpen(false)
          return
        }
        var settle = function (accepted) {
          if (accepted === true) setOpen(false)
          else setNotice('模型切换失败')
        }
        try {
          var pending = select({ provider: provider, model: model })
          if (pending && typeof pending.then === 'function') pending.then(settle, function () { settle(false) })
        } catch (error) {
          settle(false)
        }
      }

      function onRootKeyDown(event) {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
        }
      }

      var modelLabel = currentModel !== null
        ? (currentModel.name || currentModel.id)
        : current === null
          ? (state.status === 'loading' ? '加载模型…' : '选择模型')
          : current.provider + '/' + current.model

      var children = [
        h('button', {
          key: 'trigger',
          ref: triggerRef,
          type: 'button',
          className: 'drs-trigger',
          title: modelLabel,
          disabled: locked,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? reactId + '-menu' : undefined,
          onClick: function () { if (open) setOpen(false); else { setNotice(null); setOpen(true); load() } },
        },
          h('span', { className: 'drs-trigger-label', key: 'label' }, modelLabel),
          h('span', { className: 'drs-caret', key: 'caret', 'aria-hidden': 'true' }, '▾'),
        ),
      ]

      if (levels.length > 0) {
        children.push(h('div', { key: 'slider', className: 'drs-slider' },
          h('input', {
            type: 'range',
            className: 'drs-range',
            min: 0,
            max: levels.length - 1,
            step: 1,
            value: index,
            disabled: locked || busy,
            'aria-label': '推理强度',
            'aria-valuetext': levelLabel,
            title: atTopLevel ? levelLabel + ' — ' + topHint : levelLabel,
            style: { '--drs-accent': accent, '--drs-track': track.image, '--drs-track-size': track.size },
            onChange: function (event) { setDrag(Number(event.target.value)) },
            onPointerUp: function (event) { commit(Number(event.target.value)) },
            onKeyUp: function (event) { commit(Number(event.target.value)) },
            onBlur: function (event) { commit(Number(event.target.value)) },
          }),
          h('span', { key: 'effort', className: 'drs-effort', style: { '--drs-accent': accent }, title: levelLabel }, levelLabel),
          atTopLevel ? h('span', { key: 'top', className: 'drs-top', title: topHint, 'aria-hidden': 'true' }, '⚡') : null,
        ))
      }

      var menu = null
      if (open) {
        var body = []
        if (state.error !== null && state.error !== undefined && state.error !== '') {
          body.push(h('div', { className: 'drs-error', key: 'error' }, String(state.error)))
        }
        if (groups.length === 0) {
          body.push(h('div', { className: state.status === 'loading' ? 'drs-status' : 'drs-empty', key: 'empty' },
            state.status === 'loading' ? '加载模型列表…' : '没有可选模型'))
        } else {
          var sections = []
          for (var si = 0; si < groups.length; si += 1) {
            var sectionGroup = groups[si]
            var list = sectionGroup && Array.isArray(sectionGroup.models) ? sectionGroup.models : []
            if (list.length === 0) continue
            var options = []
            for (var oi = 0; oi < list.length; oi += 1) {
              var candidate = list[oi]
              if (candidate === undefined || candidate === null) continue
              var selected = current !== null && current.provider === sectionGroup.id && current.model === candidate.id
              options.push(h('button', {
                key: String(candidate.id),
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': selected,
                className: 'drs-option',
                disabled: locked || busy,
                title: candidate.name || String(candidate.id),
                onClick: (function (provider, model) {
                  return function () { chooseModel(provider, model) }
                })(sectionGroup.id, candidate.id),
              },
                h('span', { className: 'drs-option-name', key: 'name' }, candidate.name || String(candidate.id)),
                h('span', { className: 'drs-check', key: 'check' }, selected ? '✓' : ''),
              ))
            }
            sections.push(h('section', {
              key: String(sectionGroup.id),
              className: 'drs-group',
              role: 'group',
              'aria-label': sectionGroup.name || String(sectionGroup.id),
            },
              h('div', { className: 'drs-group-title', key: 'title' }, sectionGroup.name || String(sectionGroup.id)),
              options,
            ))
          }
          body.push(h('div', { className: 'drs-groups scrollable', key: 'groups' }, sections))
        }
        menu = h('div', {
          key: 'menu',
          id: reactId + '-menu',
          ref: menuRef,
          role: 'menu',
          className: 'drs-menu',
          'aria-busy': busy,
          style: menuPos === null
            ? { visibility: 'hidden', left: 0, top: 0 }
            : { left: menuPos.left, top: menuPos.top },
        }, body)
      }

      return h('div', { ref: rootRef, className: 'drs-root', onKeyDown: onRootKeyDown },
        children,
        notice === null ? null : h('div', { key: 'notice', className: 'drs-notice', role: 'status' }, notice),
        menu,
        h('div', { key: 'debug', 'data-drs-debug': diagnostics, style: { display: 'none' } }),
      )
    }

    /** Boundary-wrapped seat: the slot cell itself never throws. */
    function ReasoningSliderSeat(props) {
      return h(SeatBoundary, null, h(EffortSeat, props))
    }

    /* ------------------------------------------------------------------ *
     * Plugin
     * ------------------------------------------------------------------ */

    /**
     * Install the seat.
     *
     * The three services are waited for with `ctx.inject` rather than declared
     * up front: on a kernel that does not provide them the wait simply never
     * settles, this plugin registers nothing, and the shipped seat keeps
     * rendering. Nothing here can fail activation.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      // `remote.session` is the subtle one. `modelDirectories.directoryFor()`
      // reaches into its own owner context for `ctx.remote.session`, and cordis
      // resolves that property through the *accessing* fiber's inject set. A
      // scope without it fails with `cannot get property "remote.session"
      // without inject` — the same shadow trap the desktop profile answers with
      // an `inject: [webRuntime, webServer]` patch on the connection row. The
      // shipped seat never hits it because its owning plugin declares the
      // dependency; this plugin must declare it too.
      ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], function (scope) {
        var models = scope.modelDirectories
        var sessions = scope.sessions
        scope.slots.inject('conversation.input.model', function () {
          return scope.slots.register({
            name: 'conversation.input.model',
            priority: -1,
            inject: function (sessionId) { return faceFor(models, sessions, sessionId) },
          }, ReasoningSliderSeat)
        })
      })
    }

    exports.name = 'reasoning-slider'
    exports.inject = []
    exports.apply = apply

    return module.exports
  },
})
