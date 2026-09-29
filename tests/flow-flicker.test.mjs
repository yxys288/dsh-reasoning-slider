/**
 * The flicker contract for the flow particles.
 *
 * tests/bundle.test.mjs already guards the *shape* of the flow (a keyframes block, a
 * pointer-transparent overlay, a reduced-motion escape). This file guards the change
 * itself: every particle brightens and dims on its own phase while the field keeps
 * flowing, and it does so without a per-frame script and without touching the
 * silhouette it was grafted onto.
 *
 * The assertions read the shipped lib/client.js text, the same way the neighbour suite
 * reads the injected style element: a contract a reviewer cannot see is not a contract.
 * Set DRS_CLIENT_PATH to point the suite at another revision (the evidence directory
 * keeps the pre-flicker revision for exactly that purpose).
 *
 * Three families:
 *   1. phase      - each layer carries a drift animation *and* a twinkle animation, and
 *                   each lane is paired with a half-period-offset companion comb whose
 *                   twinkle is the exact mirror of its own, so adjacent particles are
 *                   always at opposite points of the cycle;
 *   2. geometry   - the doubled carrier period plus the half-period offset reproduces the
 *                   shipped net lattice (lane A 16 px, lane B 27 px) and the drift keeps
 *                   the shipped linear velocity, so silhouette and density are unchanged;
 *   3. restraint  - the peak particle alpha never exceeds the shipped .55, the escape
 *                   hatches cover the new animations, and no new DOM was added.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = process.env.DRS_CLIENT_PATH ?? join(HERE, '..', 'lib', 'client.js')
const SOURCE = readFileSync(CLIENT_PATH, 'utf8')

/** Pull one CSS rule body out of the bundle stylesheet literal. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
  // Several rules share a selector through a comma list ('.drs-flow-a,.drs-flow-b{' is
  // the shared geometry rule), so a naive search would return that instead of the rule
  // under test. Prefer the rule that opens with the selector on its own, then the one
  // where it opens a selector list, and only then the one that lists it later on.
  const candidates = [
    new RegExp("'" + escaped + '\\{'),
    new RegExp("'" + escaped + '[,{]'),
    new RegExp(escaped + '[,{]'),
  ]
  for (const pattern of candidates) {
    const at = pattern.exec(SOURCE)
    if (at === null) continue
    const open = SOURCE.indexOf('{', at.index)
    const close = SOURCE.indexOf('}', open)
    if (open === -1 || close === -1) continue
    return SOURCE.slice(open + 1, close)
  }
  assert.fail('expected ' + CLIENT_PATH + ' to declare a rule for ' + selector)
}

function keyframes(name) {
  // Sliced out by hand: a keyframes body contains braces of its own, so a single
  // brace-bounded regex would stop at the first nested rule.
  const at = SOURCE.indexOf('@keyframes ' + name + '{')
  assert.ok(at !== -1, 'expected the bundle to declare @keyframes ' + name)
  const end = SOURCE.indexOf('}}', at)
  assert.ok(end !== -1, 'expected @keyframes ' + name + ' to be a closed block')
  return SOURCE.slice(at, end + 2)
}

/** animation: a 1s linear infinite,b 2s ease -1s infinite -> [{name,duration,delay}] */
function animations(body) {
  const declaration = /animation:([^;}]*)/.exec(body)
  assert.ok(declaration, 'expected an animation declaration in ' + body.slice(0, 40))
  return declaration[1].split(',').map((part) => {
    const tokens = part.trim().split(/\s+/)
    const times = tokens.filter((token) => /^-?[\d.]+m?s$/.test(token))
    return { name: tokens[0], duration: times[0], delay: times[1] ?? '0s' }
  })
}

const seconds = (value) =>
  value === undefined ? null : value.endsWith('ms') ? Number(value.slice(0, -2)) / 1000 : Number(value.slice(0, -1))

const opacityLevels = (name) => [...keyframes(name).matchAll(/opacity:\s*([\d.]+)/g)].map((match) => match[1])

/** lane carrier, its companion, and the shipped lattice the pair has to reproduce. */
const LANES = [
  { carrier: '.drs-flow-a', companion: '.drs-flow::before', period: 32, offset: 16, net: 16, drift: 'drs-flow-a', duration: 3.2 },
  { carrier: '.drs-flow-b', companion: '.drs-flow::after', period: 54, offset: 27, net: 27, drift: 'drs-flow-b', duration: 5.8 },
]

/* ------------------------------------------------------------------ *
 * 1. phase: two animations per layer, mirrored companions per lane
 * ------------------------------------------------------------------ */

test('each flow layer drifts and twinkles on separate timelines', () => {
  for (const lane of LANES) {
    const list = animations(rule(lane.carrier))
    assert.equal(list.length, 2, lane.carrier + ' should carry a drift animation and a twinkle animation, got ' + JSON.stringify(list))
    assert.equal(list[0].name, lane.drift, 'the translational keyframes stay first on ' + lane.carrier)
    assert.match(list[1].name, /^drs-flow-twinkle/, 'the second animation on ' + lane.carrier + ' is the twinkle')
  }
})

test('a twinkling comb is a real animation, not a static opacity', () => {
  for (const name of ['drs-flow-twinkle', 'drs-flow-twinkle-alt']) {
    const levels = opacityLevels(name)
    assert.ok(levels.length >= 2, name + ' must animate opacity between at least two values')
    assert.equal(new Set(levels).size, 2, name + ' must actually change opacity, got ' + levels.join('/'))
  }
})

test('each lane is paired with a half-period-offset companion that mirrors its twinkle', () => {
  for (const lane of LANES) {
    const companion = rule(lane.companion)
    assert.match(rule('.drs-flow::before,.drs-flow::after'), /content:\s*["']{2}/, 'the companion combs need generated content to paint dots')
    assert.match(companion, /background-image:radial-gradient/, lane.companion + ' paints its own dot lattice')
    assert.match(companion, /left:[\d.]+px/, lane.companion + ' must be offset to interleave with its lane')
    const [drift, twinkle] = animations(rule(lane.carrier))
    const partner = animations(companion)
    assert.equal(partner.length, 2, lane.companion + ' carries its own drift plus the mirrored twinkle')
    assert.equal(partner[0].name, drift.name, lane.companion + ' must reuse the drift keyframes of ' + lane.carrier + ', or the pair would slip')
    assert.equal(seconds(partner[0].duration), seconds(drift.duration), lane.companion + ' must drift at the same speed as ' + lane.carrier)
    assert.notEqual(partner[1].name, twinkle.name, lane.companion + ' must twinkle on mirrored keyframes')
    assert.equal(seconds(partner[1].duration), seconds(twinkle.duration), lane.companion + ' must share the twinkle duration of ' + lane.carrier + ', or the antiphase would drift')
  }
})

test('the mirror images are exact, and the lanes twinkle at different tempos', () => {
  const main = opacityLevels('drs-flow-twinkle')
  const alt = opacityLevels('drs-flow-twinkle-alt')
  assert.deepEqual(main, [...alt].reverse(), 'the companion must be the mirror of the comb it sits on')
  assert.equal(new Set(main).size, 2, 'two opacity levels keep this a flicker rather than a fade')
  const laneA = seconds(animations(rule('.drs-flow-a'))[1].duration)
  const laneB = seconds(animations(rule('.drs-flow-b'))[1].duration)
  assert.notEqual(laneA, laneB, 'the lanes must not share a twinkle period, or the whole field beats as one')
})

test('a companion is never nested inside an animated layer', () => {
  // This is the bug the pixel evidence caught: a pseudo-element child of an animating
  // layer is multiplied by that layer group opacity, and because the two combs are in
  // antiphase the product is constant (.5 x 1 == 1 x .5) -- the flicker cancels itself
  // out and every particle keeps a fixed brightness. The companions live on the
  // container, which animates nothing itself.
  for (const selector of ['.drs-flow-a::before', '.drs-flow-b::before']) {
    assert.ok(!SOURCE.includes(selector), selector + ' must not exist: a nested companion would cancel the antiphase')
  }
  for (const lane of LANES) {
    assert.ok(SOURCE.includes(lane.companion + '{'), 'expected the companion rule ' + lane.companion)
  }
})

/* ------------------------------------------------------------------ *
 * 2. geometry: net lattice and linear velocity match the shipped control
 * ------------------------------------------------------------------ */

test('the doubled carrier plus the half-period offset reproduces the shipped net lattice', () => {
  for (const lane of LANES) {
    const body = rule(lane.carrier)
    const size = Number(/background-size:(\d+)px 100%/.exec(body)[1])
    assert.equal(size, lane.period, lane.carrier + ' carries a doubled carrier period')
    const companion = rule(lane.companion)
    assert.equal(Number(/left:([\d.]+)px/.exec(companion)[1]), lane.offset, lane.companion + ' sits half a carrier away from its lane')
    assert.equal(Number(/background-size:(\d+)px 100%/.exec(companion)[1]), lane.period, lane.companion + ' repeats on the same carrier period')
    assert.equal(size - lane.offset, lane.net, lane.carrier + ' net particle spacing must stay at the shipped value')
    assert.equal(
      /circle at ([\d.]+)px/.exec(body)[1],
      /circle at ([\d.]+)px/.exec(companion)[1],
      lane.carrier + ' and its companion must place the dot identically inside the tile',
    )
  }
})

test('the drift keeps the shipped linear velocity, so the flow speed is unchanged', () => {
  const cases = [
    { name: 'drs-flow-a', shift: 32, duration: 3.2, shipped: 16 / 1.6 },
    { name: 'drs-flow-b', shift: 54, duration: 5.8, shipped: 27 / 2.9 },
  ]
  for (const item of cases) {
    const shift = Number(new RegExp('translateX\\(-([\\d.]+)px\\)').exec(keyframes(item.name))[1])
    assert.equal(shift, item.shift, item.name + ' translates exactly one doubled carrier period')
    const duration = seconds(animations(rule('.' + item.name))[0].duration)
    assert.equal(duration, item.duration, item.name + ' duration is scaled with the period')
    assert.ok(
      Math.abs(shift / duration - item.shipped) < 0.02,
      item.name + ' must keep the shipped velocity ' + item.shipped + ' px/s, got ' + shift / duration,
    )
  }
})

test('the overlay still cannot be clicked through or leak past the fill', () => {
  const body = rule('.drs-flow')
  assert.match(body, /overflow:hidden/, 'the companion combs must stay clipped to the fill')
  assert.match(body, /pointer-events:none/, 'the decoration never eats a click')
  assert.match(body, /mask-image:linear-gradient/, 'the left-faint ramp that gives the flow a direction survives')
})

/* ------------------------------------------------------------------ *
 * 3. restraint: brightness ceiling and the escape hatches
 * ------------------------------------------------------------------ */

test('no particle ever shines brighter than the shipped fill dots', () => {
  const alphas = []
  for (const lane of LANES) {
    for (const selector of [lane.carrier, lane.companion]) {
      for (const match of rule(selector).matchAll(/rgba\(255,255,255,\.([\d]+)\)/g)) alphas.push(Number('0.' + match[1]))
    }
  }
  assert.ok(alphas.length >= 4, 'expected a dot alpha for every comb, got ' + alphas.length)
  assert.ok(Math.max(...alphas) <= 0.55, 'the brightest comb must not exceed the shipped alpha .55, got ' + Math.max(...alphas))
  for (const name of ['drs-flow-twinkle', 'drs-flow-twinkle-alt']) {
    assert.ok(Math.max(...opacityLevels(name).map(Number)) <= 1, name + ' must not magnify a comb above its own alpha')
    assert.ok(Math.min(...opacityLevels(name).map(Number)) > 0, name + ' must keep a floor: no particle is allowed to disappear')
  }
})

test('reduced motion switches the new animations off as well', () => {
  const block = /@media \(prefers-reduced-motion:reduce\)\{([^}]*\}\})/.exec(SOURCE)
  assert.ok(block, 'the reduced-motion escape hatch must exist')
  const body = block[1]
  assert.ok(body.startsWith('.drs-flow-a,'), 'the block must still open with .drs-flow-a, which tests/bundle.test.mjs pins')
  for (const selector of ['.drs-flow-a', '.drs-flow-b', '.drs-flow::before', '.drs-flow::after']) {
    assert.ok(body.includes(selector), selector + ' must be silenced under reduced motion')
  }
  assert.match(body, /animation:none/)
})

test('a locked seat pauses the twinkle too, not just the drift', () => {
  assert.match(rule('.drs-flow--idle .drs-flow-a'), /animation-play-state:paused/)
  for (const selector of ['.drs-flow-b', '.drs-flow--idle::before', '.drs-flow--idle::after']) {
    assert.ok(SOURCE.includes(selector), 'the locked seat must reach ' + selector)
  }
  assert.match(rule('.drs-flow--idle::before'), /animation-play-state:paused/)
})

test('the flicker needed no new elements', () => {
  assert.equal(
    [...SOURCE.matchAll(/className: .drs-flow-[ab]./g)].length,
    2,
    'the overlay is still exactly two spans; the companion combs are pseudo-elements',
  )
})
