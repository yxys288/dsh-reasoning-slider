/**
 * dsh-reasoning-slider — browser half (the served client bundle).
 *
 * Replaces the composer's model seat (`conversation.input.model`) with the
 * two-level shape Codex ships. The trigger is a *summary* — model name, then the
 * effort name, then a thin chevron — and clicking it opens a panel holding the
 * model row (which drills into the existing model list) and the reasoning-effort
 * level bar: one neutral groove, a fill that ends under the thumb, one tick per
 * level, and the "更快 / 更强" axis labels above it. There is no hue ramp — the
 * level is read from the fill's reach and the trigger's text, never from colour,
 * so the control inherits whichever DSH theme is active.
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

    /* ------------------------------------------------------------------ *
     * Geometry. The marker/fill offsets are derived from these constants, so
     * the stylesheet below and the generated background layers cannot drift
     * apart — a change here moves both.
     *
     * The proportions follow the shipped Codex power slider: a thick pill bar
     * with the level markers riding *inside* it, and a white thumb that is
     * larger than the bar and overflows it.
     * ------------------------------------------------------------------ */

    // The bar (and the knob that overflows it, and the markers inside it) is
    // 1.5× the shipped gauges: a thicker bar. The three scale together, because
    // the Codex silhouette is "knob bigger than bar" — thickening only the bar
    // would swallow the knob and lose the shape.
    var BAR_SCALE = 1.5
    var TRACK_HEIGHT = 10 * BAR_SCALE
    var THUMB_SIZE = 14 * BAR_SCALE
    var DOT_SIZE = 3 * BAR_SCALE
    // The input has to be taller than the knob so the knob is never clipped.
    var RANGE_HEIGHT = THUMB_SIZE + 8
    // The bar used to live on the trigger itself, at this width. It now lives in
    // the panel, so every call site passes `PANEL_TRACK_WIDTH`; `TRACK_WIDTH`
    // survives as the documented fallback of `stopCenter`/`trackLayers` (and as
    // the record of the 142px layout) rather than as a second source of truth.
    var TRACK_WIDTH = 142
    // The panel is deliberately a fixed width instead of matching the trigger.
    // The trigger is squeezed against the composer's input, so a short model name
    // would collapse the bar to an unusable sliver; Codex's own dark panel is
    // 337px against a 183px trigger, so the two are not coupled there either.
    //
    // The bar is the source of truth here and the panel follows it: the shipped
    // 236px bar plus 14px of side padding twice = 264px of panel.
    var PANEL_TRACK_WIDTH = 236
    var PANEL_PAD = 14
    var PANEL_WIDTH = PANEL_TRACK_WIDTH + PANEL_PAD * 2
    // The hover readout floats over the bar, centred on the stop under the
    // pointer. The clamp that keeps it inside the bar needs half of its
    // max-width, so the two numbers are written once and derived.
    var HOVER_MAX_WIDTH = 104
    var HOVER_HALF = HOVER_MAX_WIDTH / 2
    // Below this the filled sliver is too short to carry a readable flow, so the
    // weakest stop renders without particles rather than as a twitching nub.
    var FLOW_MIN_WIDTH = 24

    /* Palette sampled off the Codex power slider itself — light fill #298ffe on
     * a #e5e2e6 track, dark fill #3a83f7 on a #404040 track — with a white
     * thumb in both themes. Markers are a translucent white wash sitting on the
     * fill, so they read as part of the bar rather than as ticks standing off
     * it. They are theme-switched by the stylesheet below. */
    var FILL = 'var(--drs-fill,#298ffe)'
    var REST = 'var(--drs-rest,#e5e2e6)'
    var DOT_ON = 'var(--drs-dot-on,rgba(255,255,255,.32))'
    var DOT_OFF = 'var(--drs-dot-off,rgba(0,0,0,.16))'
    var THUMB = '#fff'

    /**
     * The centre of one stop, in px from the track's left edge.
     *
     * A native range's thumb travels `width - THUMB_SIZE` px, inset by half a
     * thumb, so positioning a marker at `ratio * 100%` would drift by a whole
     * 7px at the top level. This is the single place that maths lives: the
     * stylesheet only stretches the track, and every marker and the fill come
     * from here — which is why the width is a parameter instead of a constant
     * baked into this function.
     * @param level - stop index.
     * @param count - number of stops.
     * @param width - the bar's width in px; omitted means the retired trigger-side width.
     * @returns the centre offset in px.
     */
    function stopCenter(level, count, width) {
      var span = width === undefined || !(width > 0) ? TRACK_WIDTH : width
      if (count <= 1) return span / 2
      var ratio = level / (count - 1)
      if (!(ratio >= 0)) ratio = 0
      if (ratio > 1) ratio = 1
      return THUMB_SIZE / 2 + ratio * (span - THUMB_SIZE)
    }

    /**
     * Build the bar: one dot per advertised level sitting inside the track, a
     * fill that ends under the thumb, and the resting track underneath. Layers
     * are emitted top-first because CSS paints the first background layer on
     * top.
     *
     * A single level is not a choice — a native range pins its thumb to the
     * left there, so pretending to fill a share of the track would contradict
     * what the thumb shows. That case gets the bare track.
     * @param count - number of levels.
     * @param index - index of the level in force.
     * @param width - the bar's width in px, as `stopCenter` wants it.
     * @returns the `background-image`, `-size` and `-position` layer lists.
     */
    function trackLayers(count, index, width) {
      var images = []
      var sizes = []
      var positions = []
      var i
      if (count > 1) {
        for (i = 0; i < count; i += 1) {
          var dot = i <= index ? DOT_ON : DOT_OFF
          // The dot's radius is half its size, so scaling the marker scales
          // the drawn dot with it instead of leaving a 1.5px pin behind.
          var dotRadius = DOT_SIZE / 2
          images.push('radial-gradient(circle at 50% 50%,' + dot + ' 0 ' + dotRadius.toFixed(2) + 'px,rgba(0,0,0,0) ' + (dotRadius + 0.1).toFixed(2) + 'px)')
          sizes.push(DOT_SIZE + 'px ' + DOT_SIZE + 'px')
          positions.push((stopCenter(i, count, width) - DOT_SIZE / 2).toFixed(2) + 'px 50%')
        }
        images.push('linear-gradient(' + FILL + ',' + FILL + ')')
        sizes.push(stopCenter(index, count, width).toFixed(2) + 'px 100%')
        positions.push('0 0')
      }
      images.push('linear-gradient(' + REST + ',' + REST + ')')
      sizes.push('100% 100%')
      positions.push('0 0')
      return { image: images.join(','), size: sizes.join(','), position: positions.join(',') }
    }
    var CSS = [
      '.drs-root{position:relative;display:flex;align-items:center;gap:2px;min-width:0}',
      '.drs-trigger{min-width:0;max-width:min(220px,32cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 6px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}',
      '.drs-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.drs-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.drs-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
      '.drs-trigger-model{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#0f1115)}',
      '.drs-trigger-effort{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-trigger:disabled .drs-trigger-model,.drs-trigger:disabled .drs-trigger-effort{color:var(--dsw-alias-label-dimmed)}',
      '.drs-caret{flex:none;display:block;color:var(--dsw-alias-label-caption)}',
      '.drs-panel{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;width:min(' + PANEL_WIDTH + 'px,100vw - 32px);padding:12px ' + PANEL_PAD + 'px 14px;background:var(--dsw-specific-menu,#1f1f24);color:var(--dsw-alias-label-primary,#eaeaea);border:0;border-radius:16px;outline:none;box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.45))}',
      // The model row is the panel's own model entry (the trigger only
      // summarises it); the chevron-right marks it as a drill-down into the list.
      '.drs-model-row{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;height:34px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary,#eaeaea);font:inherit;font-size:13px;font-weight:600;line-height:20px;cursor:pointer}',
      '.drs-model-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.drs-model-row:disabled{cursor:default;opacity:.55}',
      '.drs-model-row-name{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
      '.drs-chevron-right{flex:none;display:block;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-effort-block{margin-top:10px}',
      // Codex pins the two captions to the bar's ends; they are decoration, so
      // the slider's own aria-label / aria-valuetext carry the semantics.
      '.drs-axis{display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      // A model with a single level gets a sentence instead of an empty panel.
      '.drs-single{margin:10px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-slider{display:flex;align-items:center;gap:6px;min-width:0}',
      '.drs-track-wrap{position:relative;display:inline-block;flex:none;line-height:0}',
      // The hover readout. It carries the same surface as the panel plus a hairline
      // ring, because the light theme's elevation layers are all #fff and a fill
      // alone would leave the chip invisible against the panel it sits on.
      '.drs-hover{position:absolute;bottom:calc(100% + 6px);transform:translateX(-50%);z-index:1;box-sizing:border-box;max-width:' + HOVER_MAX_WIDTH + 'px;padding:3px 8px;border-radius:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:var(--dsw-specific-menu,#1f1f24);color:var(--dsw-alias-label-primary,#0f1115);font-size:12px;line-height:16px;font-weight:500;box-shadow:0 0 0 1px var(--dsw-alias-border-l3),0 6px 18px rgba(0,0,0,.28);pointer-events:none}',
      // The particle flow. Layers scroll at different rates so the field reads as
      // drifting motes rather than as dashes; each layer is one period wider than
      // the bar and translates by exactly that period, so the loop is seamless
      // and stays on the compositor. The mask fades the motes in from the left
      // and brightens them toward the thumb, which is what gives the motion a
      // direction instead of looking like a texture.
      //
      // Each layer also flickers, one particle at a time. A layer-wide opacity
      // animation cannot do that -- it pulses every mote at once, which reads as
      // breathing rather than twinkling -- so every layer carries a *companion*
      // comb (a pseudo-element on the overlay, so the markup stays two spans) sitting
      // half a carrier period away from it and twinkling on the mirror image of
      // the same keyframes. Adjacent particles are therefore always at opposite
      // points of their cycle, and the two lanes run different tempos so the
      // field never finds one beat. Because the companion only inherits the
      // parent transform, the two combs keep their offset rigidly: the pairs
      // interleave to the *shipped* net spacing (lane A 16px, lane B 27px), and
      // the drift duration is scaled with the doubled period so the flow keeps
      // its original speed. The dim phase is a floor of .5, never zero, and no
      // comb is allowed above the shipped peak alpha -- the flicker only ever
      // dims, it never brightens the filler.
      '.drs-flow{position:absolute;left:0;top:50%;height:' + TRACK_HEIGHT + 'px;transform:translateY(-50%);border-radius:999px 0 0 999px;overflow:hidden;pointer-events:none;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,.4) 30%,#000 100%);mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,.4) 30%,#000 100%)}',
      '.drs-flow-a,.drs-flow-b{position:absolute;left:0;top:0;height:100%;background-repeat:repeat-x;background-position:0 50%}',
      '.drs-flow-a{width:calc(100% + 32px);background-image:radial-gradient(circle at 4px 50%,rgba(255,255,255,.55) 0 1px,rgba(255,255,255,0) 1.15px);background-size:32px 100%;animation:drs-flow-a 3.2s linear infinite,drs-flow-twinkle 2.15s ease-in-out infinite}',
      '.drs-flow-b{width:calc(100% + 54px);background-image:radial-gradient(circle at 13px 30%,rgba(255,255,255,.3) 0 .85px,rgba(255,255,255,0) 1px);background-size:54px 100%;animation:drs-flow-b 5.8s linear infinite,drs-flow-twinkle 3.45s ease-in-out -1.1s infinite}',
      // The companion combs hang off the *container*, never off the animated layers.
      // Nesting them under a layer would multiply that layer group opacity into them,
      // and since a comb and its companion are in antiphase the product is constant
      // (.5 x 1 == 1 x .5) -- the flicker would cancel itself out exactly. They carry
      // the same drift keyframes as the lane they pair with, so the half-period offset
      // (left) stays rigid and the two combs interleave into the shipped lattice.
      '.drs-flow::before,.drs-flow::after{content:"";position:absolute;top:0;height:100%;background-repeat:repeat-x;background-position:0 50%;pointer-events:none}',
      '.drs-flow::before{left:16px;width:calc(100% + 32px);background-image:radial-gradient(circle at 4px 50%,rgba(255,255,255,.42) 0 .9px,rgba(255,255,255,0) 1.05px);background-size:32px 100%;animation:drs-flow-a 3.2s linear infinite,drs-flow-twinkle-alt 2.15s ease-in-out infinite}',
      '.drs-flow::after{left:27px;width:calc(100% + 54px);background-image:radial-gradient(circle at 13px 30%,rgba(255,255,255,.24) 0 .8px,rgba(255,255,255,0) .95px);background-size:54px 100%;animation:drs-flow-b 5.8s linear infinite,drs-flow-twinkle-alt 3.45s ease-in-out -1.1s infinite}',
      '@keyframes drs-flow-a{from{transform:translateX(0)}to{transform:translateX(-32px)}}',
      '@keyframes drs-flow-b{from{transform:translateX(0)}to{transform:translateX(-54px)}}',
      // Mirrored twins: identical durations, inverted levels, so a comb and its
      // companion are in exact antiphase and the pair sums to a steady glow.
      '@keyframes drs-flow-twinkle{0%,100%{opacity:.5}38%,52%{opacity:1}}',
      '@keyframes drs-flow-twinkle-alt{0%,100%{opacity:1}38%,52%{opacity:.5}}',
      // A locked seat is inert, so its decoration stops moving with it.
      '.drs-flow--idle .drs-flow-a,.drs-flow--idle .drs-flow-b,.drs-flow--idle::before,.drs-flow--idle::after{animation-play-state:paused}',
      '@media (prefers-reduced-motion:reduce){.drs-flow-a,.drs-flow-b,.drs-flow::before,.drs-flow::after{animation:none}}',
      '.drs-range{-webkit-appearance:none;appearance:none;display:block;width:' + PANEL_TRACK_WIDTH + 'px;height:' + RANGE_HEIGHT + 'px;margin:0;padding:0;background:transparent;cursor:pointer;outline:none;--drs-fill:#298ffe;--drs-rest:#e5e2e6;--drs-dot-on:rgba(255,255,255,.32);--drs-dot-off:rgba(0,0,0,.16)}',
      // Codex runs the same control darker rather than lighter: a brighter fill
      // and a near-black track. The thumb stays white in both themes.
      'body[data-ds-dark-theme] .drs-range{--drs-fill:#3a83f7;--drs-rest:#404040;--drs-dot-on:rgba(255,255,255,.3);--drs-dot-off:rgba(255,255,255,.22)}',
      '.drs-range:disabled{cursor:default;opacity:.55}',
      '.drs-range:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);border-radius:999px}',
      '.drs-range::-webkit-slider-runnable-track{height:' + TRACK_HEIGHT + 'px;border-radius:999px;background-color:transparent;background-image:var(--drs-track,none);background-size:var(--drs-track-size,auto);background-position:var(--drs-track-pos,0 0);background-repeat:no-repeat}',
      // The thumb overflows the bar by design — that is the Codex silhouette.
      '.drs-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:' + THUMB_SIZE + 'px;height:' + THUMB_SIZE + 'px;margin-top:' + ((TRACK_HEIGHT - THUMB_SIZE) / 2) + 'px;border:0;border-radius:50%;background:' + THUMB + ';box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.32)}',
      '.drs-range::-moz-range-track{height:' + TRACK_HEIGHT + 'px;border-radius:999px;background-color:transparent;background-image:var(--drs-track,none);background-size:var(--drs-track-size,auto);background-position:var(--drs-track-pos,0 0);background-repeat:no-repeat}',
      // Firefox paints its own progress bar inside the track; the fill layer
      // already draws that, so the native one is suppressed rather than doubled.
      '.drs-range::-moz-range-progress{background:transparent}',
      '.drs-range::-moz-range-thumb{width:' + THUMB_SIZE + 'px;height:' + THUMB_SIZE + 'px;border:0;border-radius:50%;background:' + THUMB + ';box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.32)}',
      // The notice is rendered inside whichever float is open, so it anchors to
      // that box: the space directly above the trigger now belongs to the panel.
      '.drs-notice{position:absolute;bottom:calc(100% + 6px);left:0;right:0;z-index:1101;padding:6px 10px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(248,113,113,.16));color:var(--dsw-alias-state-error-primary,#f87171);font-size:12px;line-height:18px;white-space:nowrap;text-align:center}',
      '.drs-menu{position:fixed;z-index:1100;display:flex;flex-direction:column;padding:4px;outline:none;background:var(--dsw-specific-menu,#1f1f24);color:var(--dsw-alias-label-primary,#eaeaea);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);border:0;border-radius:20px;box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.45));overflow:hidden}',
      '.drs-groups{overflow-y:auto;display:flex;flex-direction:column;gap:2px}',
      '.drs-group{display:flex;flex-direction:column;gap:2px;padding:2px 0}',
      '.drs-group-title{padding:6px 10px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a92)}',
      '.drs-option{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:8px 10px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}',
      '.drs-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.drs-option:focus{outline:none}',
      '.drs-option:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
      '.drs-option:disabled{cursor:default;opacity:.55}',
      '.drs-option-name{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0}',
      '.drs-check{flex:none;font-size:12px;line-height:1;color:var(--dsw-alias-label-primary,#0f1115)}',
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
     * effort on a neutral Codex-style level bar (or, for a model that offers a
     * single level, just the level's name — there is nothing to choose).
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
      // Three states rather than a boolean: the seat is collapsed, showing its
      // panel, or showing the model list the panel's model row drills into.
      //
      // `initialView` is a TEST-ONLY seam. The injected face never passes it, so
      // a shipped seat always starts collapsed and its production path is
      // unchanged; it exists because the unit suite drives a single-pass
      // renderer whose `useState` cannot feed a new value back into a re-render,
      // which would leave both open states structurally unreachable there.
      var viewPair = React.useState(props.initialView === 'panel' || props.initialView === 'models' ? props.initialView : 'closed')
      var view = viewPair[0]
      var setView = viewPair[1]
      var posPair = React.useState(null)
      var floatPos = posPair[0]
      var setFloatPos = posPair[1]
      var noticePair = React.useState(null)
      var notice = noticePair[0]
      var setNotice = noticePair[1]
      // Which stop the pointer is over, or null. Purely a readout: it never
      // changes the selection, so a stray move can't commit anything.
      var hoverPair = React.useState(null)
      var hover = hoverPair[0]
      var setHover = hoverPair[1]

      var rootRef = React.useRef(null)
      var triggerRef = React.useRef(null)
      var panelRef = React.useRef(null)
      var menuRef = React.useRef(null)
      // Set by the close path, consumed by the effect below: whether this
      // particular close should hand focus back to the trigger.
      var restoreFocusRef = React.useRef(false)
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
      var levelLabel = levels.length > 0 ? levels[index].label : undefined
      var track = trackLayers(levels.length, index, PANEL_TRACK_WIDTH)
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

      /* The readout belongs to the panel's bar; leaving the panel retires it, so
       * coming back does not show a stop the pointer left long ago. */
      React.useEffect(function () {
        if (view !== 'panel') setHover(null)
      }, [view])

      /* Outside click closes whichever level is open. Both floats render inside
       * the root, so containing the event is enough. */
      React.useEffect(function () {
        if (view === 'closed') return undefined
        function onMouseDown(event) {
          var target = event.target
          if (target instanceof Node && rootRef.current !== null && rootRef.current.contains(target)) return
          // An outside click is the one close path that must NOT pull focus
          // back: the user is focusing something else, and fighting that would
          // be worse than letting the seat lose it.
          closeFloat(false)
        }
        document.addEventListener('mousedown', onMouseDown)
        return function () { document.removeEventListener('mousedown', onMouseDown) }
      }, [view])

      /* Place the open float against its trigger: above it when the whole box
       * fits there, otherwise below it, clamped into the viewport either way.
       * Codex flips sides (its light panel rises above a composer sitting at the
       * bottom of the window, its dark one drops below a composer in the middle),
       * so a hard-coded side would push the panel off-screen whenever the seat
       * sits near a viewport edge. */
      React.useLayoutEffect(function () {
        if (view === 'closed') {
          setFloatPos(null)
          return undefined
        }
        function place() {
          var trigger = triggerRef.current
          if (trigger === null) return
          var rect = trigger.getBoundingClientRect()
          var float = view === 'models' ? menuRef.current : panelRef.current
          var width = float === null ? 0 : float.offsetWidth
          var height = float === null ? 0 : float.offsetHeight
          var margin = 12
          var gap = 10
          // Room for the *whole* float, gap and margin included, on each side.
          var roomAbove = rect.top - gap - margin
          var roomBelow = window.innerHeight - rect.bottom - gap - margin
          var side = roomAbove >= height
            ? 'top'
            : roomBelow >= height
              ? 'bottom'
              : roomAbove >= roomBelow ? 'top' : 'bottom'
          var x = rect.right - width
          var y = side === 'top' ? rect.top - gap - height : rect.bottom + gap
          if (width > 0) x = Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - width - margin))
          if (height > 0) y = Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - height - margin))
          setFloatPos({ left: x, top: y, side: side })
        }
        place()
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return function () {
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [view, state])

      /* Focus follows the panel in, so Esc is always reachable from the panel
       * itself; the model list focuses its first option, or the list while it is
       * still loading. Focus is best-effort: it must never take the seat down. */
      // `placed` is in the dependency list on purpose. A float renders
      // `visibility:hidden` for its first commit (its position is measured in a
      // layout effect), and an element that is hidden cannot take focus — so
      // focusing on `view` alone silently did nothing, which is how this was
      // caught: the browser device measured `document.activeElement === body`
      // right after opening. Keying on "has been placed" also keeps a later
      // scroll/resize reposition from yanking focus back into the panel.
      var placed = floatPos !== null
      React.useLayoutEffect(function () {
        if (view === 'closed' || placed !== true) return
        var float = view === 'models' ? menuRef.current : panelRef.current
        if (float === null) return
        var option = view === 'models' ? float.querySelector('[role="menuitemradio"]') : null
        var target = option === null ? float : option
        try {
          target.focus({ preventScroll: true })
        } catch (error) { /* focusing is optional */ }
      }, [view, placed])

      /* ...and focus comes back out again when the float closes. Without this the
       * focused element simply unmounts and focus falls to <body>, so a keyboard
       * user who presses Esc is left typing into nothing. Which closes restore is
       * decided by the close path (see `closeFloat`), because by the time this
       * runs the previously focused node is already gone. */
      React.useLayoutEffect(function () {
        if (view !== 'closed' || restoreFocusRef.current !== true) return
        restoreFocusRef.current = false
        var trigger = triggerRef.current
        if (trigger === null || trigger.disabled === true) return
        try {
          trigger.focus({ preventScroll: true })
        } catch (error) { /* focusing is optional */ }
      }, [view])

      var trace = typeof props.trace === 'string' ? props.trace : ''
      var diagnostics = JSON.stringify({
        available: available,
        locked: locked,
        status: state.status,
        groups: groups.length,
        current: current === null ? null : current.provider + '/' + current.model,
        levels: levels.length,
        view: view,
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
          closeFloat(true)
          return
        }
        var settle = function (accepted) {
          if (accepted === true) closeFloat(true)
          else setNotice('模型切换失败')
        }
        try {
          var pending = select({ provider: provider, model: model })
          if (pending && typeof pending.then === 'function') pending.then(settle, function () { settle(false) })
        } catch (error) {
          settle(false)
        }
      }

      /**
       * Close the float, handing focus back to the trigger when the seat was the
       * one holding it.
       *
       * The three keyboard/choice paths pass `true`: the element they close from
       * is about to unmount, so without this focus lands on <body> and the seat's
       * keyboard affordance is lost. The outside-click path passes `false`.
       * @param restore - hand focus back to the trigger after closing.
       */
      function closeFloat(restore) {
        restoreFocusRef.current = restore === true
        setView('closed')
      }

      function onRootKeyDown(event) {
        if (event.key !== 'Escape' || view === 'closed') return
        event.preventDefault()
        // Esc unwinds one level at a time: the model list steps back to the
        // panel (which re-takes focus), and the panel closes back onto the
        // trigger.
        if (view === 'models') setView('panel')
        else closeFloat(true)
      }

      var modelLabel = currentModel !== null
        ? (currentModel.name || currentModel.id)
        : current === null
          ? (state.status === 'loading' ? '加载模型…' : '选择模型')
          : current.provider + '/' + current.model

      // The collapsed seat is Codex's summary pill: model name, effort name, thin
      // chevron — and no level graphics at all. Codex states the cost of the top
      // level in the option's description rather than as a badge, so the marker is
      // absent and the warning lives in the tooltip.
      var triggerTitle = levels.length > 0
        ? modelLabel + ' · ' + levelLabel + (atTopLevel ? ' — ' + topHint : '')
        : modelLabel
      var children = [
        h('button', {
          key: 'trigger',
          ref: triggerRef,
          type: 'button',
          className: 'drs-trigger',
          title: triggerTitle,
          disabled: locked,
          'aria-haspopup': 'dialog',
          'aria-expanded': view !== 'closed',
          'aria-controls': view !== 'closed' ? reactId + '-panel' : undefined,
          onClick: function () { if (view !== 'closed') closeFloat(true); else { setNotice(null); setView('panel'); load() } },
        },
          h('span', { className: 'drs-trigger-model', key: 'model' }, modelLabel),
          levels.length === 0 ? null : h('span', { className: 'drs-trigger-effort', key: 'effort' }, levelLabel),
          h('svg', {
            key: 'caret',
            className: 'drs-caret',
            viewBox: '0 0 12 12',
            width: 10,
            height: 10,
            'aria-hidden': 'true',
          }, h('path', {
            d: 'M2.5 4.5 6 8 9.5 4.5',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          })),
        ),
      ]

      // The bar itself, unchanged in form: it now only ever renders inside the
      // panel, and only when the model actually offers a choice — a single
      // advertised level is not one, because a native range would pin its thumb
      // to the left edge and read as "nothing selected".
      /**
       * The stop nearest the pointer, in the bar's own geometry.
       *
       * The bar is a native range, so its hit area is the whole element and the
       * platform hands us no per-stop events. The centres therefore come from the
       * same `stopCenter()` the markers and the fill are drawn with — one map,
       * so the readout can never sit on a stop other than the one under the
       * pointer.
       * @param event - the pointer event on the track wrapper.
       * @returns the stop index, or null when the bar has no measurable width.
       */
      function stopAtPointer(event) {
        if (levels.length < 2) return null
        var rect = event.currentTarget.getBoundingClientRect()
        if (!(rect.width > 0)) return null
        var x = event.clientX - rect.left
        var best = 0
        var bestDistance = Infinity
        for (var i = 0; i < levels.length; i += 1) {
          var distance = Math.abs(stopCenter(i, levels.length, rect.width) - x)
          if (distance < bestDistance) {
            bestDistance = distance
            best = i
          }
        }
        return best
      }

      function onTrackPointerMove(event) {
        var next = stopAtPointer(event)
        if (next !== hover) setHover(next)
      }

      function onTrackPointerLeave() {
        setHover(null)
      }

      var sliderBlock = null
      if (levels.length > 1) {
        // The flow is a sibling painted over the input, so it stops at the
        // thumb's left edge instead of running underneath the white knob, and
        // it never takes pointer events.
        var flowWidth = (index / (levels.length - 1)) * (PANEL_TRACK_WIDTH - THUMB_SIZE)
        var flow = flowWidth >= FLOW_MIN_WIDTH
          ? h('span', {
              key: 'flow',
              className: 'drs-flow' + (locked ? ' drs-flow--idle' : ''),
              'aria-hidden': 'true',
              style: { width: flowWidth.toFixed(2) + 'px' },
            },
              h('span', { key: 'a', className: 'drs-flow-a' }),
              h('span', { key: 'b', className: 'drs-flow-b' }),
            )
          : null
        // The readout: centred on the stop under the pointer and clamped so a long
        // level name cannot push it out of the bar. Its position is the same
        // linear map `stopCenter()` lays the markers out with, written as a
        // `calc()` so it also holds when the panel is clamped on a narrow
        // viewport and the bar is no longer exactly `PANEL_TRACK_WIDTH`.
        var hoverNode = hover !== null && hover < levels.length
          ? h('span', {
              key: 'hover',
              className: 'drs-hover',
              'aria-hidden': 'true',
              style: {
                left: 'clamp(' + HOVER_HALF + 'px,calc(' + (THUMB_SIZE / 2) + 'px + ' + (hover / (levels.length - 1)).toFixed(4) + ' * (100% - ' + THUMB_SIZE + 'px)),calc(100% - ' + HOVER_HALF + 'px))',
              },
            }, levels[hover].label)
          : null
        sliderBlock = h('div', { key: 'slider', className: 'drs-slider' },
          h('span', {
            key: 'range',
            className: 'drs-track-wrap',
            onPointerMove: onTrackPointerMove,
            onPointerLeave: onTrackPointerLeave,
          },
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
              style: { '--drs-track': track.image, '--drs-track-size': track.size, '--drs-track-pos': track.position },
              onChange: function (event) { setDrag(Number(event.target.value)) },
              onPointerUp: function (event) { commit(Number(event.target.value)) },
              onKeyUp: function (event) { commit(Number(event.target.value)) },
              onBlur: function (event) { commit(Number(event.target.value)) },
            }),
            flow,
            hoverNode,
          ),
        )
      }

      var noticeNode = notice === null
        ? null
        : h('div', { key: 'notice', className: 'drs-notice', role: 'status' }, notice)

      // Level two: the panel. A dialog rather than a menu, because it holds a
      // control (the bar) and not just a list of choices. The model row is the
      // panel's own model entry — the trigger only summarises the selection — and
      // the chevron-right marks it as a drill-down into the model list.
      var float = null
      if (view === 'panel') {
        var panelBody = [
          h('button', {
            key: 'model',
            type: 'button',
            className: 'drs-model-row',
            disabled: locked || busy,
            title: modelLabel,
            onClick: function () { setView('models') },
          },
            h('span', { className: 'drs-model-row-name', key: 'name' }, modelLabel),
            h('svg', {
              key: 'chevron',
              className: 'drs-chevron-right',
              viewBox: '0 0 8 12',
              width: 8,
              height: 12,
              'aria-hidden': 'true',
            }, h('path', {
              d: 'M2 2l4 4-4 4',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            })),
          ),
        ]
        if (sliderBlock !== null) {
          panelBody.push(h('div', { key: 'effort', className: 'drs-effort-block' },
            // Codex pins these two captions to the bar's ends.
            h('div', { key: 'axis', className: 'drs-axis', 'aria-hidden': 'true' },
              h('span', { key: 'faster' }, '更快'),
              h('span', { key: 'smarter' }, '更强'),
            ),
            sliderBlock,
          ))
        } else if (levels.length === 1) {
          panelBody.push(h('p', { key: 'single', className: 'drs-single' }, '该模型只有一个推理档位'))
        }
        float = h('div', {
          key: 'panel',
          id: reactId + '-panel',
          ref: panelRef,
          role: 'dialog',
          tabIndex: -1,
          'aria-label': '模型与推理强度',
          'data-drs-side': floatPos === null ? undefined : floatPos.side,
          className: 'drs-panel',
          style: floatPos === null
            ? { visibility: 'hidden', left: 0, top: 0 }
            : { left: floatPos.left, top: floatPos.top },
        }, noticeNode, panelBody)
      }

      // Level three: the model list. It replaces the panel's contents instead of
      // squeezing the bar, and it reuses the shipped menu geometry verbatim.
      var menu = null
      if (view === 'models') {
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
          tabIndex: -1,
          'data-drs-side': floatPos === null ? undefined : floatPos.side,
          style: floatPos === null
            ? { visibility: 'hidden', left: 0, top: 0 }
            : { left: floatPos.left, top: floatPos.top },
        }, noticeNode, body)
        float = menu
      }

      return h('div', { ref: rootRef, className: 'drs-root', onKeyDown: onRootKeyDown },
        children,
        float,
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
