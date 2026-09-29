/**
 * Time-series sampler for the flow-particle flicker prototypes.
 *
 * Companion to `tools/preview.mjs` (which owns `.preview-work` and is not touched by
 * this script). It loads `tools/preview/flow-flicker.html` — the standalone page that
 * renders the shipped particle flow plus three flicker candidates at the real
 * 142x10 track geometry — and turns it into evidence.
 *
 * Two independent pieces of evidence:
 *
 *  1. **Deterministic frame series.** Headless Chrome is asked to pause its animations
 *     and seek them to a fixed `currentTime` (`a.currentTime = t`) before every
 *     screenshot, so each frame is a pure function of `t` and not a race against the
 *     wall clock. Frames are decoded in-process (PNG + zlib, no dependencies) and
 *     reduced to a per-column luminance profile per sample box.
 *
 *  2. **Live clock probe.** A second instance is driven over the DevTools protocol
 *     (hand-rolled WebSocket, no dependencies) and sampled twice ~900 ms of *real*
 *     time apart, to show `playState`/`currentTime` and the computed transform
 *     actually advancing. Virtual time does NOT drive the animation clock here, which
 *     is exactly why the seek in (1) is explicit.
 *
 * The question the measurement exists to answer: do *different particles* brighten and
 * dim with *different phases*, or does the whole field pulse in lockstep? A layer-wide
 * `opacity` animation is precisely the lockstep case. After motion compensation, a
 * lockstep pulse makes every particle's normalised residual move together (high
 * `signAgreement`), while staggered flicker puts them in opposition (`minPairCorr`
 * strongly negative, `meanSpatialSpread` near its maximum).
 *
 * The control candidate P0 is the shipped CSS, which has no opacity animation at all:
 * it must come out with no measurable twinkle, which is what makes the metric
 * trustworthy rather than decorative.
 *
 * Usage:
 *   node tools/flow-flicker.mjs                    # 16 frames x 150 ms, both themes
 *   node tools/flow-flicker.mjs --frames 4 --zoom  # quick smoke run + strip crops
 *
 * Options:
 *   --step <ms>       spacing between frames                (default 200)
 *   --paired-at <ms>  geometry-repeat offsets to A/B test   (default 800,3200)
 *   --out <dir>     evidence directory               (default ../../../dist/ui-preview/reasoning-slider/flow-flicker)
 *   --chrome <path> explicit browser binary
 *   --zoom          also write 4x magnified strip crops (crops/)
 *   --profiles      also write the raw per-frame profiles
 *   --no-live       skip the DevTools live-clock probe
 *   --keep          keep the generated work directory
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib, { deflateSync, inflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
/** The package is the repository root; `DRS_REPO_ROOT` covers nested checkouts. */
const REPO_ROOT = resolve(process.env.DRS_REPO_ROOT ?? PACKAGE_ROOT)

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const valueOf = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at === -1) return fallback
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(name + ' needs a value')
  return value
}

const frameCount = Number(valueOf('--frames', '16'))
const stepMs = Number(valueOf('--step', '150'))
const outDir = resolve(valueOf('--out', join(REPO_ROOT, 'dist', 'ui-preview', 'reasoning-slider', 'flow-flicker')))
const workDir = join(PACKAGE_ROOT, '.flow-work')
const frameDir = join(outDir, 'frames')
const keep = has('--keep')
const zoom = has('--zoom')
const dumpProfiles = has('--profiles')
const runLive = !has('--no-live')
// The frame schedule is anchored on the *geometry-repeat* offsets (see §2): stepping
// 200 ms up to 3200 ms always lands exactly on 800 and 3200.
const pairedOffsets = valueOf('--paired-at', '800,3200').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
const horizon = Math.max(0, ...pairedOffsets)
const schedule = []
for (let t = 0; t <= horizon; t += stepMs) schedule.push(t)
if (schedule[schedule.length - 1] !== horizon) schedule.push(horizon)
const WINDOW = { w: 800, h: 640 }
const DPR = 2
const PAGE = join(HERE, 'preview', 'flow-flicker.html')

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex')

/* ------------------------------------------------------------------ *
 * Browser
 * ------------------------------------------------------------------ */

function firstExisting(paths) {
  for (const path of paths) if (path && existsSync(path)) return path
  return null
}

function findChrome() {
  return firstExisting([
    valueOf('--chrome', null),
    process.env.DSH_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ])
}

const chrome = findChrome()
if (chrome === null) throw new Error('no Chrome/Edge found; pass --chrome <path> or DSH_CHROME')

// `chrome --version` is unreliable on Windows (it can answer "opening in existing
// session" instead of a version), so the version that matters is the one the running
// instance reports in its own UA string; the CLI output is kept as a raw note.
const chromeVersionCli = (spawnSync(chrome, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim()
let chromeVersion = null

const baseFlags = () => [
  '--headless',
  '--disable-gpu',
  '--allow-file-access-from-files',
  '--disable-lcd-text',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-device-scale-factor=' + DPR,
  '--window-size=' + WINDOW.w + ',' + WINDOW.h,
]

const pageUrl = (query) => 'file:///' + join(workDir, 'page.html').replaceAll('\\', '/') + (query ? '?' + query : '')

/** One headless page load; the page pauses and seeks its animations when asked. */
function runPage({ query, screenshot, dumpDom, budgetMs, label }) {
  const args = [
    ...baseFlags(),
    '--user-data-dir=' + join(workDir, 'chrome-profile'),
    '--virtual-time-budget=' + budgetMs,
    '--run-all-compositor-stages-before-draw',
  ]
  if (screenshot) args.push('--screenshot=' + screenshot)
  if (dumpDom) args.push('--dump-dom')
  args.push(pageUrl(query))
  const result = spawnSync(chrome, args, { encoding: 'utf8', timeout: 90000, windowsHide: true })
  if (result.status !== 0) {
    throw new Error('chrome failed for ' + label + ' (status ' + result.status + '): ' + (result.stderr ?? '').slice(-600))
  }
  if (screenshot && !existsSync(screenshot)) throw new Error('no screenshot written for ' + label)
  return result.stdout ?? ''
}

function readFacts(dom) {
  const match = /<pre id="facts"[^>]*>([A-Za-z0-9+/=]+)<\/pre>/.exec(dom)
  if (match === null) throw new Error('facts sink missing from dumped DOM (page threw before sinking?)')
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

/* ------------------------------------------------------------------ *
 * Minimal PNG reader / writer (zlib is built in; no image dependency)
 * ------------------------------------------------------------------ */

function openPng(path) {
  const buf = readFileSync(path)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + path)
  let pos = 8
  let ihdr = null
  const idat = []
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (ihdr === null) throw new Error('no IHDR in ' + path)
  if (ihdr.bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + ihdr.bitDepth)
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG unsupported')
  const channels = ihdr.colorType === 6 ? 4 : ihdr.colorType === 2 ? 3 : -1
  if (channels === -1) throw new Error('unsupported PNG color type ' + ihdr.colorType)
  return { ihdr, channels, raw: inflateSync(Buffer.concat(idat)) }
}

/** Unfilter rows, handing each reconstructed row to `onRow`. */
function eachRow(png, upToY, onRow) {
  const { width, height } = png.ihdr
  const ch = png.channels
  const stride = width * ch
  let prev = Buffer.alloc(stride)
  let cur = Buffer.alloc(stride)
  let off = 0
  const last = Math.min(height, upToY)
  for (let y = 0; y < last; y += 1) {
    const filter = png.raw[off]
    off += 1
    const line = png.raw.subarray(off, off + stride)
    off += stride
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (filter === 1) v = (v + a) & 0xff
      else if (filter === 2) v = (v + b) & 0xff
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        v = (v + pred) & 0xff
      } else if (filter !== 0) throw new Error('bad PNG filter ' + filter)
      cur[i] = v
    }
    onRow(y, cur, width, ch)
    const swap = prev
    prev = cur
    cur = swap
  }
}

/**
 * Per-column maximum luminance inside each sample box.
 *
 * A particle is a ~2 device-px white dot, so the *maximum* over the box's rows is
 * where its centre sits while the fill underneath stays flat. That turns each frame
 * into one profile per sample box, and a profile is all the analysis needs.
 */
function profilesFor(pngPath, boxes) {
  const png = openPng(pngPath)
  const maxY = Math.max(...boxes.map((b) => b.y1))
  const profiles = boxes.map((b) => new Float64Array(b.x1 - b.x0))
  eachRow(png, maxY, (y, row, width, ch) => {
    for (let bi = 0; bi < boxes.length; bi += 1) {
      const box = boxes[bi]
      if (y < box.y0 || y >= box.y1) continue
      const out = profiles[bi]
      for (let x = box.x0; x < box.x1; x += 1) {
        const at = x * ch
        const lum = 0.2126 * row[at] + 0.7152 * row[at + 1] + 0.0722 * row[at + 2]
        if (lum > out[x - box.x0]) out[x - box.x0] = lum
      }
    }
  })
  return { size: { width: png.ihdr.width, height: png.ihdr.height }, profiles }
}

/** Crop one box out of a frame and magnify it, so strips can be looked at. */
function cropFor(pngPath, box, padX, scale) {
  const png = openPng(pngPath)
  const x0 = Math.max(0, box.x0 - padX)
  const x1 = Math.min(png.ihdr.width, box.x1 + padX)
  const outW = (x1 - x0) * scale
  const rgba = Buffer.alloc(outW * (box.y1 - box.y0) * scale * 4)
  eachRow(png, box.y1, (y, row, width, ch) => {
    if (y < box.y0 || y >= box.y1) return
    for (let x = x0; x < x1; x += 1) {
      const at = x * ch
      for (let sy = 0; sy < scale; sy += 1) {
        let to = (((y - box.y0) * scale + sy) * outW + (x - x0) * scale) * 4
        for (let sx = 0; sx < scale; sx += 1) {
          rgba[to] = row[at]
          rgba[to + 1] = row[at + 1]
          rgba[to + 2] = row[at + 2]
          rgba[to + 3] = ch === 4 ? row[at + 3] : 255
          to += 4
        }
      }
    }
  })
  return { width: outW, height: rgba.length / (outW * 4), rgba }
}

let crcTable = null
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (crcTable === null) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function writePng(path, image) {
  const { width, height, rgba } = image
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]))
}

/* ------------------------------------------------------------------ *
 * Signal analysis
 * ------------------------------------------------------------------ */

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Local maxima at least `minGap` apart and above `threshold`. */
function findPeaks(profile, threshold, minGap) {
  const out = []
  for (let x = 1; x < profile.length - 1; x += 1) {
    if (profile[x] < threshold) continue
    if (profile[x] < profile[x - 1] || profile[x] < profile[x + 1]) continue
    const last = out[out.length - 1]
    if (last !== undefined && x - last.x < minGap) {
      if (profile[x] > last.value) out[out.length - 1] = { x, value: profile[x] }
      continue
    }
    out.push({ x, value: profile[x] })
  }
  return out
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i += 1) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    const u = a[i] - ma
    const v = b[i] - mb
    num += u * v
    da += u * u
    db += v * v
  }
  if (da === 0 || db === 0) return 0
  return num / Math.sqrt(da * db)
}

/** First local maximum of the autocorrelation, in frames. */
function autocorrPeriod(series) {
  const n = series.length
  if (n < 6) return null
  const mean = series.reduce((s, v) => s + v, 0) / n
  const centred = series.map((v) => v - mean)
  const denom = centred.reduce((s, v) => s + v * v, 0)
  if (denom === 0) return null
  const corr = []
  for (let lag = 1; lag < n - 1; lag += 1) {
    let num = 0
    for (let i = 0; i + lag < n; i += 1) num += centred[i] * centred[i + lag]
    corr.push(num / denom)
  }
  for (let i = 1; i < corr.length - 1; i += 1) {
    if (corr[i] > corr[i - 1] && corr[i] >= corr[i + 1] && corr[i] > 0.1) return i + 1
  }
  return null
}

/** Dominant spatial period of a profile, in device px. */
function latticePeriod(profile) {
  const n = profile.length
  const mean = profile.reduce((s, v) => s + v, 0) / n
  const centred = Float64Array.from(profile, (v) => v - mean)
  let denom = 0
  for (let i = 0; i < n; i += 1) denom += centred[i] * centred[i]
  if (denom === 0) return null
  const corr = []
  for (let lag = 4; lag < Math.min(140, n - 4); lag += 1) {
    let num = 0
    for (let i = 0; i + lag < n; i += 1) num += centred[i] * centred[i + lag]
    corr.push({ lag, value: num / denom })
  }
  for (let i = 1; i < corr.length - 1; i += 1) {
    if (corr[i].value > corr[i - 1].value && corr[i].value >= corr[i + 1].value && corr[i].value > 0.15) return corr[i].lag
  }
  return null
}

/**
 * Turn one sample box's frame series into per-particle evidence.
 *
 * The profiles are first motion-compensated (a rigid drift would otherwise masquerade
 * as per-column flicker), then split into particle blobs by temporal variance, and each
 * particle's brightness series is normalised against its own mean and standard
 * deviation. From there:
 *
 *   amplitude      – how much the particle actually changes, in luminance levels
 *   signAgreement  – 1 when every particle moves the same way at the same instant
 *                    (the layer-wide-pulse signature), ~0 when they disagree
 *   meanSpatialSpread – same idea, kept because it is a plain number rather than a sign
 *   minPairCorr    – the most anti-phase pair of particles
 */
function analyseBox(profiles, baseline, maskGainAt) {
  const band = profiles[0].length
  const frames = profiles.length
  const span0 = Math.max(...profiles[0]) - baseline
  const seedThreshold = baseline + Math.max(5, span0 * 0.18)
  const trackThreshold = (profile) => baseline + Math.max(3, 0.12 * (Math.max(...profile) - baseline))

  // Per-particle tracking, not global motion compensation.
  //
  // A single shift for the whole band cannot align two lanes drifting at different
  // speeds, and integer-only shifts leave a sub-pixel residue that makes a particle's
  // measured brightness swing by tens of levels on its own. Tracking each particle's
  // own local maximum removes the confound at the source: the *peak value* of a dot is
  // essentially invariant under sub-pixel motion, so any change left in the series is a
  // real change in that particle's opacity.
  const seeds = findPeaks(profiles[0], seedThreshold, 12).filter((p) => p.x >= 24 && p.x <= band - 24)
  const particles = []
  for (const seed of seeds) {
    let x = seed.x
    let velocity = 0
    const positions = []
    const series = []
    for (let i = 0; i < frames; i += 1) {
      const profile = profiles[i]
      const predict = x + velocity
      const from = Math.max(2, Math.round(predict) - 5)
      const to = Math.min(band - 3, Math.round(predict) + 5)
      let bestX = -1
      let bestValue = -Infinity
      for (let j = from; j <= to; j += 1) {
        if (profile[j] > bestValue) {
          bestValue = profile[j]
          bestX = j
        }
      }
      if (bestX === -1 || bestValue < trackThreshold(profile)) {
        series.push(null)
        positions.push(null)
        continue
      }
      // Refuse to hop: neighbouring particles are >= 24 device px away and a dot moves
      // at most ~3 px per frame, so a jump of more than 6 px means a different dot.
      if (Math.abs(bestX - x) > 8) {
        series.push(null)
        positions.push(null)
        continue
      }
      velocity = 0.5 * velocity + 0.5 * (bestX - x)
      x = bestX
      series.push((bestValue - baseline) / maskGainAt(bestX))
      positions.push(bestX)
    }
    const values = series.filter((v) => v !== null)
    // Truncated particles would corrupt the pairwise correlations, so a particle must be
    // visible in most frames to count; ones that drift out of the sampled band (or enter
    // it mid-window) are dropped rather than half-counted.
    if (values.length < frames * 0.8) continue
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length
    const sigma = Math.sqrt(variance)
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    particles.push({
      deviceX: seed.x,
      cssX: Math.round((seed.x / DPR) * 10) / 10,
      headroom: Math.round(hi * 10) / 10,
      swing: Math.round((hi - lo) * 10) / 10,
      sigma: Math.round(sigma * 100) / 100,
      periodFrames: autocorrPeriod(values),
      driftDevicePx: positions.filter((v) => v !== null).length > 1
        ? positions.filter((v) => v !== null).slice(-1)[0] - positions.filter((v) => v !== null)[0]
        : 0,
      series: series.map((v) => (v === null ? null : Math.round(v * 10) / 10)),
      norm: series.map((v) => (v === null ? null : Math.round(((v - mean) / Math.max(sigma, 0.5)) * 1000) / 1000)),
    })
  }

  const amplitudes = particles.map((p) => p.sigma)
  const amplitude = amplitudes.length === 0 ? 0 : amplitudes.reduce((s, v) => s + v, 0) / amplitudes.length

  const spreads = []
  const signAgreements = []
  for (let i = 0; i < frames; i += 1) {
    const values = particles.map((p) => p.norm[i]).filter((v) => v !== null)
    if (values.length < 2) continue
    spreads.push(Math.max(...values) - Math.min(...values))
    let sum = 0
    for (const v of values) sum += Math.sign(v)
    signAgreements.push(Math.abs(sum / values.length))
  }
  const corrs = []
  for (let i = 0; i < particles.length; i += 1) {
    for (let j = i + 1; j < particles.length; j += 1) {
      const a = particles[i].series.map((v, k) => (v === null ? particles[j].series[k] : v))
      const b = particles[j].series.map((v, k) => (v === null ? particles[i].series[k] : v))
      corrs.push(pearson(a, b))
    }
  }
  const round3 = (v) => Math.round(v * 1000) / 1000
  const avg = (list) => (list.length === 0 ? null : round3(list.reduce((s, v) => s + v, 0) / list.length))
  const metrics = {
    particles: particles.length,
    amplitude: Math.round(amplitude * 100) / 100,
    signAgreement: avg(signAgreements),
    meanSpatialSpread: avg(spreads),
    meanPairCorr: avg(corrs),
    minPairCorr: corrs.length === 0 ? null : round3(Math.min(...corrs)),
    maxPairCorr: corrs.length === 0 ? null : round3(Math.max(...corrs)),
    lockstepPairs: corrs.filter((c) => c >= 0.9).length,
    antiphasePairs: corrs.filter((c) => c <= -0.5).length,
    pairCount: corrs.length,
  }
  metrics.verdict = classify(metrics)
  return {
    metrics,
    latticeDevicePx: latticePeriod(profiles[0]),
    particles,
  }
}

/**
 * The classification the report quotes. The amplitude gate matters: with no measurable
 * brightness change there is no phase to speak of, and calling that "staggered" would
 * be a reading error rather than a finding.
 */
function classify({ particles, amplitude, signAgreement, meanSpatialSpread, lockstepPairs, antiphasePairs, pairCount }) {
  if (particles < 2) return 'insufficient-particles'
  if (amplitude < 1.5) return 'no-measurable-twinkle'
  if (pairCount > 0 && lockstepPairs / pairCount >= 0.5) return 'lockstep-pulse'
  if (antiphasePairs >= 1) return 'staggered-antiphase'
  if (meanSpatialSpread !== null && meanSpatialSpread >= 0.8) return 'staggered'
  if (signAgreement !== null && signAgreement >= 0.6) return 'lockstep-pulse'
  return 'weak-mixed'
}

/* ------------------------------------------------------------------ *
 * DevTools live-clock probe (hand-rolled WebSocket; live wall-clock evidence)
 * ------------------------------------------------------------------ */

function wsFrame(payload) {
  const data = Buffer.from(payload, 'utf8')
  const mask = randomBytes(4)
  let header
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length])
  } else if (data.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(data.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(data.length), 2)
  }
  const masked = Buffer.from(data)
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4]
  return Buffer.concat([header, mask, masked])
}

/** Pull complete server frames out of a growing buffer. */
function wsParse(buffer) {
  const messages = []
  let offset = 0
  let fragments = []
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let cursor = offset + 2
    if (len === 126) {
      if (buffer.length - cursor < 2) break
      len = buffer.readUInt16BE(cursor)
      cursor += 2
    } else if (len === 127) {
      if (buffer.length - cursor < 8) break
      len = Number(buffer.readBigUInt64BE(cursor))
      cursor += 8
    }
    let maskKey = null
    if (masked) {
      if (buffer.length - cursor < 4) break
      maskKey = buffer.subarray(cursor, cursor + 4)
      cursor += 4
    }
    if (buffer.length - cursor < len) break
    const payload = Buffer.from(buffer.subarray(cursor, cursor + len))
    if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4]
    offset = cursor + len
    if (opcode === 0x8) messages.push({ close: true })
    else if (opcode === 0x9) messages.push({ ping: payload })
    else if (opcode === 0xa) continue
    else if (opcode === 0x1 || opcode === 0x0) {
      fragments.push(payload)
      if (fin) {
        messages.push({ text: Buffer.concat(fragments).toString('utf8') })
        fragments = []
      }
    }
  }
  return { messages, rest: buffer.subarray(offset) }
}

function httpJson(port, path) {
  return new Promise((resolve_, reject) => {
    const req = get({ host: '127.0.0.1', port, path, timeout: 4000 }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve_(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('devtools http timeout')))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Load the page in a browser whose animation clock is the *real* one, and read the
 * animation inventory twice from inside the page.
 */
async function liveClockProbe(url) {
  const profileDir = join(workDir, 'live-profile')
  rmSync(profileDir, { recursive: true, force: true })
  const child = spawn(chrome, [
    ...baseFlags(),
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=0',
    url,
  ], { stdio: 'ignore', windowsHide: true })

  const stop = () => {
    try { child.kill() } catch {}
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' })
  }

  try {
    const portFile = join(profileDir, 'DevToolsActivePort')
    let port = null
    for (let i = 0; i < 60; i += 1) {
      if (existsSync(portFile)) {
        const text = readFileSync(portFile, 'utf8').split('\n')[0].trim()
        if (text !== '') { port = Number(text); break }
      }
      await sleep(250)
    }
    if (port === null) throw new Error('DevToolsActivePort never appeared')

    let target = null
    for (let i = 0; i < 40; i += 1) {
      try {
        const list = await httpJson(port, '/json/list')
        target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
        if (target) break
      } catch {}
      await sleep(250)
    }
    if (target === null) throw new Error('no page target on the DevTools endpoint')

    const socket = connect({ host: '127.0.0.1', port: Number(new URL(target.webSocketDebuggerUrl).port) })
    await new Promise((resolve_, reject) => {
      socket.once('connect', resolve_)
      socket.once('error', reject)
    })
    const key = randomBytes(16).toString('base64')
    const handshake =
      'GET ' + new URL(target.webSocketDebuggerUrl).pathname + ' HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + port + '\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
    let incoming = Buffer.alloc(0)
    let handshakeDone = false
    const pending = new Map()
    let nextId = 1
    let closed = false
    socket.on('data', (chunk) => {
      incoming = Buffer.concat([incoming, chunk])
      if (!handshakeDone) {
        const end = incoming.indexOf('\r\n\r\n')
        if (end === -1) return
        const head = incoming.subarray(0, end).toString('latin1')
        if (!/ 101 /.test(head)) throw new Error('websocket upgrade refused: ' + head.split('\r\n')[0])
        incoming = incoming.subarray(end + 4)
        handshakeDone = true
      }
      const { messages, rest } = wsParse(incoming)
      incoming = rest
      for (const message of messages) {
        if (message.ping) { socket.write(Buffer.concat([Buffer.from([0x8a, 0x80]), randomBytes(4)])); continue }
        if (message.close) { closed = true; continue }
        if (!message.text) continue
        const parsed = JSON.parse(message.text)
        const waiter = pending.get(parsed.id)
        if (waiter) {
          pending.delete(parsed.id)
          waiter(parsed)
        }
      }
    })
    socket.write(Buffer.from(handshake, 'latin1'))
    const deadline = Date.now() + 8000
    while (!handshakeDone && Date.now() < deadline) await sleep(50)
    if (!handshakeDone) throw new Error('websocket handshake timed out')

    const send = (method, params) =>
      new Promise((resolve_, reject) => {
        const id = nextId
        nextId += 1
        pending.set(id, (message) => {
          if (message.error) reject(new Error(method + ': ' + JSON.stringify(message.error)))
          else resolve_(message.result)
        })
        socket.write(wsFrame(JSON.stringify({ id, method, params })))
        setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ' timed out')) }, 8000)
      })

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(result.exceptionDetails.exception))
      return result.result.value
    }

    // Serialised as a single expression so the same text runs unchanged in the page.
    const probeExpression = [
      'JSON.stringify({',
      '  wallClockMs: Math.round(performance.now()),',
      '  readyState: document.readyState,',
      '  animations: document.getAnimations().map(function (a) {',
      '    var timing = a.effect.getTiming();',
      '    var target = a.effect.target;',
      '    return {',
      '      name: a.animationName,',
      '      target: target ? String(target.className) : null,',
      '      pseudo: a.effect.pseudoElement || null,',
      '      playState: a.playState,',
      '      currentTime: Number(a.currentTime),',
      '      duration: timing.duration,',
      '      delay: timing.delay,',
      '      iterations: timing.iterations',
      '    };',
      '  }),',
      '  rendered: Array.prototype.map.call(document.querySelectorAll(\'[data-strip="light|p2|128"] .drs-flow-a\'), function (el) {',
      '    return getComputedStyle(el).transform + \' | before-opacity \' + getComputedStyle(el, \'::before\').opacity;',
      '  })',
      '})',
    ].join('\n')

    // Wait for the page to have live animations before the first sample.
    let first = null
    for (let i = 0; i < 40; i += 1) {
      const raw = await evaluate(probeExpression)
      const parsed = JSON.parse(raw)
      if (parsed.animations.length > 0 && parsed.readyState === 'complete') { first = parsed; break }
      await sleep(150)
    }
    if (first === null) throw new Error('page never reported ready animations')
    await sleep(900)
    const second = JSON.parse(await evaluate(probeExpression))

    // Bonus: a real-clock pixel check - screenshot the same strip twice via CDP would
    // need a heavier client, so sample the computed transform instead, which is what the
    // compositor is animating.
    const perAnimation = first.animations.map((a, i) => {
      const b = second.animations[i] ?? {}
      return {
        name: a.name,
        target: a.target,
        pseudo: a.pseudo,
        playState: a.playState,
        duration: a.duration,
        delay: a.delay,
        from: Math.round(a.currentTime * 10) / 10,
        to: b.currentTime === undefined ? null : Math.round(b.currentTime * 10) / 10,
        advancedMs: b.currentTime === undefined ? null : Math.round((b.currentTime - a.currentTime) * 10) / 10,
      }
    })
    const result = {
      available: true,
      wallClockDeltaMs: Math.round(second.wallClockMs - first.wallClockMs),
      animationCount: perAnimation.length,
      playStates: [...new Set(perAnimation.map((a) => a.playState))],
      advanced: perAnimation.filter((a) => a.advancedMs !== null && a.advancedMs > 0).length,
      distinctAnimationNames: [...new Set(perAnimation.map((a) => a.name))],
      animatedLayersWithOwnPhase: (() => {
        const seen = new Map()
        for (const a of perAnimation) {
          const key = (a.target ?? '?') + (a.pseudo ?? '')
          if (!seen.has(key)) seen.set(key, new Set())
          seen.get(key).add(a.name)
        }
        return [...seen.entries()].map(([key, names]) => ({ layer: key, animations: [...names] }))
      })(),
      renderedTransformFirst: first.rendered,
      renderedTransformSecond: second.rendered,
      renderedTransformChanged: JSON.stringify(first.rendered) !== JSON.stringify(second.rendered),
      perAnimation,
    }
    try { socket.destroy() } catch {}
    stop()
    return result
  } catch (error) {
    stop()
    return { available: false, error: String(error && error.message ? error.message : error) }
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

rmSync(workDir, { recursive: true, force: true })
mkdirSync(workDir, { recursive: true })
mkdirSync(frameDir, { recursive: true })
copyFileSync(PAGE, join(workDir, 'page.html'))

const provenance = {
  page: { path: PAGE, md5: md5(PAGE) },
  driver: { path: fileURLToPath(import.meta.url), md5: md5(fileURLToPath(import.meta.url)) },
  chrome: { path: chrome, version: null, versionCli: chromeVersionCli },
  devicePixelRatio: DPR,
  windowSize: WINDOW,
  frameCount: schedule.length,
  stepMs,
  pairedOffsets,
  capturedAt: new Date().toISOString(),
}

console.log('flow-flicker: inputs')
console.log('  page   ', provenance.page.path, provenance.page.md5.slice(0, 8))
console.log('  chrome ', chrome)
console.log('  frames ', schedule.length + ' frames, ' + stepMs + 'ms apart, up to ' + horizon + 'ms (paired offsets ' + pairedOffsets.join('/') + ')')

/* ── 1. geometry facts (seek t=0; the layout is identical in every frame) ── */
const firstFrame = join(frameDir, 't0000.png')
const dom = runPage({ query: 'seek=0', screenshot: firstFrame, dumpDom: true, budgetMs: 4000, label: 'facts' })
const facts = readFacts(dom)
if (facts.mode !== 'seek' || facts.seekedTo !== 0) throw new Error('page did not enter seek mode: ' + JSON.stringify(facts.mode))
chromeVersion = (/Chrome\/[\d.]+/.exec(facts.ua) ?? [facts.ua])[0]
provenance.chrome.version = chromeVersion
provenance.ua = facts.ua
console.log('  version', chromeVersion)
if (facts.scrollHeight > facts.viewport.h) {
  throw new Error('page overflows the window (' + facts.scrollHeight + ' > ' + facts.viewport.h + '); raise WINDOW.h')
}
console.log('  strips ', facts.rects.length, 'rects, dpr', facts.dpr, ', viewport', JSON.stringify(facts.viewport))

const boxes = facts.rects.map((rect) => {
  const xd = Math.round(rect.x * facts.dpr)
  const wd = Math.round(rect.w * facts.dpr)
  const yd = Math.round(rect.y * facts.dpr)
  const hd = Math.round(rect.h * facts.dpr)
  return {
    id: rect.id,
    flowLeftDevice: xd,
    flowWidthDevice: wd,
    // The container is masked left-faint -> right-bright, and that gradient is fixed in
    // the container's own coordinates while the particles slide through it. Sampling from
    // u = 0.30 keeps the gain correction below ~2.5x, so noise is not amplified.
    x0: xd + Math.round(wd * 0.3),
    x1: xd + wd - 2,
    y0: yd,
    y1: yd + hd,
    cssWidth: rect.w,
    computed: { a: rect.aAnim, b: rect.bAnim, aBefore: rect.aBeforeAnim, bBefore: rect.bBeforeAnim },
  }
})

/**
 * The container's mask as a pure function of device x.
 *
 * `.drs-flow` carries `mask-image:linear-gradient(90deg, transparent 0, rgba(0,0,0,.4) 30%, #000 100%)`,
 * so a particle drifting left crosses into progressively fainter mask territory and its
 * *measured* brightness falls even when its own opacity never changes. Left uncorrected
 * that ramp is a monotone decline shared by every particle — i.e. it fakes exactly the
 * in-phase signature this measurement exists to look for. Dividing the excess over the
 * fill by the mask gain removes it at the source.
 */
function maskGain(box, xDevice) {
  const u = (xDevice - box.flowLeftDevice) / box.flowWidthDevice
  if (u <= 0.3) return Math.max(0.05, (0.4 * u) / 0.3)
  if (u >= 1) return 1
  return 0.4 + (0.6 * (u - 0.3)) / 0.7
}

/* ── 2. the deterministic time series, one pass per lane configuration ──
 *
 * The paired-frame test below compares frame t0 with frame t0+Δ, where Δ is chosen so the
 * translating pattern lands on *identical positions with the same comb identity* (an even
 * number of net lattices). Then any brightness difference at the same x is the opacity
 * animation and nothing else — no drift estimate, no particle identity, no mask ramp.
 *
 * That only works if *every* visible layer repeats at Δ. The two lanes do not share a
 * repeat time (lane A's shipped drift is one 16 px period per 1600 ms, lane B's is 27 px
 * per 2900 ms; their common multiple is ~46 s), so each lane is measured in its own pass
 * with the other hidden through the page's preview-only `?only=` switch:
 *   pass a  (only=a)      Δ = 3200 ms = 2 lane-A periods = an even number of net lattices
 *                          (and 800 ms for P3, whose twinkle *is* the 800 ms step)
 *   pass b  (only=b)      Δ = 5800 ms = 2 lane-B periods
 * The `both` pass keeps the full field for the tracked-particle analysis and the
 * real-scale sequence images.
 */
const laneBRepeatMs = 5800
const range = (from, to, step) => {
  const out = []
  for (let t = from; t <= to; t += step) out.push(t)
  if (out[out.length - 1] !== to) out.push(to)
  return out
}
const passes = [
  { id: 'both', query: '', times: schedule, pairedAt: [] },
  { id: 'a', query: 'only=a', times: schedule, pairedAt: [800, horizon] },
  { id: 'b', query: 'only=b', times: range(0, laneBRepeatMs, stepMs), pairedAt: [laneBRepeatMs] },
]

/* ── 3. decode each pass once, reduce to profiles ── */
const passData = {}
for (const pass of passes) {
  const frames = []
  for (const t of pass.times) {
    const file = join(frameDir, (pass.id === 'both' ? '' : pass.id + '-') + 't' + String(t).padStart(4, '0') + '.png')
    if (t !== 0 || pass.id !== 'both') {
      runPage({ query: 'seek=' + t + (pass.query ? '&' + pass.query : ''), screenshot: file, dumpDom: false, budgetMs: 4000, label: 'frame ' + pass.id + ' t=' + t })
    }
    frames.push({ t, file, md5: md5(file) })
  }
  const decoded = frames.map((frame) => {
    const { size, profiles } = profilesFor(frame.file, boxes)
    return { t: frame.t, file: frame.file, size, profiles }
  })
  passData[pass.id] = { pass, frames, decoded }
}
const frames = passData.both.frames
const perFrame = passData.both.decoded
const imageSize = perFrame[0].size
console.log('  image  ', imageSize.width + 'x' + imageSize.height)

if (zoom) {
  const cropDir = join(outDir, 'crops')
  mkdirSync(cropDir, { recursive: true })
  let written = 0
  for (const frame of [perFrame[0], perFrame[perFrame.length - 1]]) {
    for (const box of boxes) {
      writePng(join(cropDir, box.id.replaceAll('|', '-') + '-t' + String(frame.t).padStart(4, '0') + '.png'), cropFor(frame.file, box, 6 * DPR, 4))
      written += 1
    }
  }
  console.log('  crops  ', written, 'magnified strips ->', cropDir)
}

if (dumpProfiles) {
  const dump = (decoded) => decoded.map((frame) => ({
    t: frame.t,
    profiles: frame.profiles.map((p) => [...p].map((v) => Math.round(v * 10) / 10)),
  }))
  writeFileSync(join(outDir, 'flow-flicker.profiles.json'), JSON.stringify({
    provenance,
    note: 'Raw per-column peak luminance inside each sample box, one array per frame, per measurement pass. Index 0 == box.x0. The fill baseline is ~129 for the light blue and ~59 for the dark. Pass "both" keeps the full field; "a"/"b" hide one lane through the page\'s preview-only ?only= switch so a single lane can be A/B tested at a geometry-repeat offset.',
    boxes: boxes.map((b) => ({ id: b.id, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 })),
    passes: Object.fromEntries(Object.entries(passData).map(([id, data]) => [id, dump(data.decoded)])),
  }, null, 2) + '\n', 'utf8')
}

/* ── 3b. paired-frame alternation test (geometry-matched, tracker-free) ──
 *
 * The strongest available test of "each particle flickers on its own phase" needs no
 * tracking at all. Comparing frame t0 with frame t0+3200 ms compares the *same dot
 * positions* of the *same comb* (the drift advanced by exactly two net lattices, an even
 * number, so comb identity is preserved) at a *different twinkle phase*. Any brightness
 * difference at the same x is therefore the opacity animation alone — no drift, no mask
 * ramp, no particle identity to guess.
 *
 * What the difference profile looks like then decides it: a layer-wide pulse moves every
 * site the same way (all brighter, or all dimmer), while staggered flicker moves adjacent
 * sites in opposite directions, because adjacent sites belong to the two anti-phase combs.
 */
function pairedVerdict(entry) {
  if (entry.maxAbsDiff < 6) return 'no-measurable-change'
  if (entry.brighter >= 2 && entry.dimmer === 0) return 'lockstep-brighter'
  if (entry.dimmer >= 2 && entry.brighter === 0) return 'lockstep-dimmer'
  if (entry.alternationRate !== null && entry.alternationRate >= 0.75 && entry.brighter >= 2 && entry.dimmer >= 2) return 'per-particle-alternation'
  if (entry.brighter >= 1 && entry.dimmer >= 1) return 'mixed-phases'
  return 'single-site'
}

const pairedTest = {}
for (const pass of passes) {
  if (pass.pairedAt.length === 0) continue
  const decoded = passData[pass.id].decoded
  for (const theme of ['light', 'dark']) {
    pairedTest[theme] = pairedTest[theme] || {}
    for (const cand of ['p0', 'p1', 'p2', 'p3']) {
      const box = boxes.find((b) => b.id === theme + '|' + cand + '|128')
      if (box === undefined) continue
      const bi = boxes.indexOf(box)
      const profiles = decoded.map((frame) => frame.profiles[bi])
      const band = profiles[0].length
      const base = median(profiles.flatMap((p) => [...p]))
      const corrected = (frameIndex, x) => (profiles[frameIndex][x] - base) / maskGain(box, box.x0 + x)
      pairedTest[theme][cand] = pairedTest[theme][cand] || { passes: {} }
      const entry = { pass: pass.id, baseline: Math.round(base * 10) / 10, referenceFrame: decoded[0].t, frameCount: decoded.length, deltas: {} }
      pairedTest[theme][cand].passes[pass.id] = entry
      for (const delta of pass.pairedAt) {
      const frameIndex = decoded.findIndex((frame) => frame.t === delta)
      if (frameIndex === -1) {
        entry.deltas[delta] = { note: 'frame not sampled' }
        continue
      }
      const diff = new Float64Array(band)
      for (let x = 0; x < band; x += 1) diff[x] = corrected(frameIndex, x) - corrected(0, x)
      let absMax = 0
      for (let x = 0; x < band; x += 1) absMax = Math.max(absMax, Math.abs(diff[x]))
      const threshold = Math.max(6, absMax * 0.25)
      const blobs = []
      let current = null
      for (let x = 0; x < band; x += 1) {
        if (Math.abs(diff[x]) >= threshold) {
          if (current === null) current = { from: x, to: x, peak: x }
          else {
            current.to = x
            if (Math.abs(diff[x]) > Math.abs(diff[current.peak])) current.peak = x
          }
        } else if (current !== null) {
          blobs.push(current)
          current = null
        }
      }
      if (current !== null) blobs.push(current)
      const sites = blobs.map((blob) => ({
        bandX: blob.peak,
        flowCssX: Math.round(((box.x0 - box.flowLeftDevice + blob.peak) / DPR) * 10) / 10,
        delta: Math.round(diff[blob.peak] * 10) / 10,
        sign: diff[blob.peak] > 0 ? 1 : -1,
      }))
      let alternations = 0
      for (let i = 1; i < sites.length; i += 1) if (sites[i].sign !== sites[i - 1].sign) alternations += 1
      const siteAbs = sites.map((s) => Math.abs(s.delta))
      entry.deltas[delta] = {
        threshold: Math.round(threshold * 10) / 10,
        maxAbsDiff: Math.round(absMax * 10) / 10,
        meanSiteAbsDelta: siteAbs.length === 0 ? 0 : Math.round((siteAbs.reduce((s, v) => s + v, 0) / siteAbs.length) * 10) / 10,
        changedSites: sites.length,
        brighter: sites.filter((s) => s.delta > 0).length,
        dimmer: sites.filter((s) => s.delta < 0).length,
        adjacentAlternations: alternations,
        alternationRate: sites.length > 1 ? Math.round((alternations / (sites.length - 1)) * 1000) / 1000 : null,
        sites,
      }
      entry.deltas[delta].verdict = pairedVerdict(entry.deltas[delta])
      }
    }
  }
}

/* ── 4. per particle evidence ── */
const report = {}
for (let bi = 0; bi < boxes.length; bi += 1) {
  const box = boxes[bi]
  const [theme, cand, width] = box.id.split('|')
  const profiles = perFrame.map((frame) => frame.profiles[bi])
  const baseline = median(profiles.flatMap((p) => [...p]))
  const analysis = analyseBox(profiles, baseline, (x) => maskGain(box, box.x0 + x))
  const entry = {
    theme,
    candidate: cand,
    cssWidth: box.cssWidth,
    bandDevice: profiles[0].length,
    baseline: Math.round(baseline * 10) / 10,
    latticeDevicePx: analysis.latticeDevicePx,
    computedAnimations: box.computed,
    ...analysis,
  }
  if (!report[theme]) report[theme] = {}
  if (!report[theme][cand]) report[theme][cand] = {}
  report[theme][cand][width] = entry
}

/**
 * Real-scale (1x) evidence.
 *
 * The 4x crops are for reading the geometry; they cannot answer "is this visible at the
 * size the control actually ships at". These are the untouched strips at 1x: for each
 * candidate a stacked sequence of every frame (real width, one row per frame), plus the
 * frame where the widest-swinging particle is at its dimmest and at its brightest — the
 * A/B a reviewer can look at without trusting any statistic in this file.
 */
const oneToOne = {}
if (zoom) {
  const dir = join(outDir, 'crops-1x')
  mkdirSync(dir, { recursive: true })
  for (const theme of Object.keys(report)) {
    oneToOne[theme] = {}
    for (const cand of Object.keys(report[theme])) {
      const entry = report[theme][cand][128]
      const box = boxes.find((b) => b.id === theme + '|' + cand + '|128')
      if (entry === undefined || box === undefined) continue
      const usable = entry.particles.filter((p) => p.series.every((v) => v !== null))
      if (usable.length === 0) {
        oneToOne[theme][cand] = { note: 'no fully tracked particle at ratio 1.0' }
        continue
      }
      const reference = usable.reduce((a, b) => (b.swing > a.swing ? b : a))
      const minIndex = reference.series.indexOf(Math.min(...reference.series))
      const maxIndex = reference.series.indexOf(Math.max(...reference.series))
      const strip = { x0: box.flowLeftDevice, x1: box.flowLeftDevice + box.flowWidthDevice, y0: box.y0, y1: box.y1 }
      const gap = 2
      const width = box.flowWidthDevice
      const height = box.y1 - box.y0
      const stackHeight = perFrame.length * (height + gap) - gap
      const stack = { width, height: stackHeight, rgba: Buffer.alloc(width * stackHeight * 4) }
      for (let i = 0; i < perFrame.length; i += 1) {
        const crop = cropFor(perFrame[i].file, strip, 0, 1)
        for (let row = 0; row < crop.height; row += 1) {
          crop.rgba.copy(stack.rgba, (i * (height + gap) + row) * width * 4, row * width * 4, (row + 1) * width * 4)
        }
        for (let p = 0; p < gap * width; p += 1) {
          const at = (i * (height + gap) + height) * width * 4 + p * 4
          stack.rgba[at] = 0xd4
          stack.rgba[at + 1] = 0xd4
          stack.rgba[at + 2] = 0xd8
          stack.rgba[at + 3] = 0xff
        }
      }
      const prefix = dir + '\\' + theme + '-' + cand + '-128'
      writePng(prefix + '-sequence.png', stack)
      writePng(prefix + '-min-t' + String(perFrame[minIndex].t).padStart(4, '0') + '.png', cropFor(perFrame[minIndex].file, strip, 0, 1))
      writePng(prefix + '-max-t' + String(perFrame[maxIndex].t).padStart(4, '0') + '.png', cropFor(perFrame[maxIndex].file, strip, 0, 1))
      oneToOne[theme][cand] = {
        referenceParticleBandX: reference.deviceX,
        referenceParticleCssX: reference.cssX,
        swing: reference.swing,
        minFrameT: perFrame[minIndex].t,
        maxFrameT: perFrame[maxIndex].t,
        minValue: Math.round(Math.min(...reference.series) * 10) / 10,
        maxValue: Math.round(Math.max(...reference.series) * 10) / 10,
        sequence: theme + '-' + cand + '-128-sequence.png',
      }
    }
  }
  console.log('  1x     ', 'real-scale strips ->', dir)
}

/**
 * Per theme+candidate: the width-averaged headline numbers.
 *
 * The control matters twice here. Its amplitude is the *noise floor* — a layer whose
 * transform animates is re-rasterised at a slightly different device-pixel phase, which
 * shows up as a small, perfectly in-phase brightness wobble on every particle. That
 * floor is quoted next to each candidate, and the verdict is derived from the averaged
 * metrics rather than voted per width.
 */
const summary = {}
const verdictCounts = {}
for (const theme of Object.keys(report)) {
  summary[theme] = {}
  verdictCounts[theme] = {}
  for (const cand of Object.keys(report[theme])) {
    const entries = Object.values(report[theme][cand])
    const avg = (key) => {
      const values = entries.map((e) => e.metrics[key]).filter((v) => typeof v === 'number')
      return values.length === 0 ? null : Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000
    }
    const verdicts = {}
    for (const e of entries) verdicts[e.metrics.verdict] = (verdicts[e.metrics.verdict] ?? 0) + 1
    verdictCounts[theme][cand] = verdicts
    const antiphasePairs = entries.reduce((s, e) => s + e.metrics.antiphasePairs, 0)
    const lockstepPairs = entries.reduce((s, e) => s + e.metrics.lockstepPairs, 0)
    const pairs = entries.reduce((s, e) => s + e.metrics.pairCount, 0)
    const aggregate = {
      particles: Math.max(...entries.map((e) => e.metrics.particles)),
      amplitude: avg('amplitude'),
      signAgreement: avg('signAgreement'),
      meanSpatialSpread: avg('meanSpatialSpread'),
      meanPairCorr: avg('meanPairCorr'),
      minPairCorr: avg('minPairCorr'),
      lockstepPairs,
      antiphasePairs,
      pairCount: pairs,
    }
    summary[theme][cand] = {
      widths: entries.length,
      particlesTotal: entries.reduce((s, e) => s + e.metrics.particles, 0),
      ...aggregate,
      ambiguousWidths: entries.filter((e) => e.metrics.verdict === 'insufficient-particles').map((e) => e.cssWidth),
      verdictPerWidth: verdicts,
      verdict: classify(aggregate),
    }
  }
  const floor = summary[theme].p0 === undefined ? null : summary[theme].p0.amplitude
  summary[theme].noiseFloor = {
    note: 'amplitude of the P0 control (shipped CSS, no opacity animation); same geometry as P1, so it is P1\'s matched floor too',
    amplitude: floor,
  }
  for (const cand of Object.keys(summary[theme])) {
    if (cand === 'noiseFloor') continue
    const entry = summary[theme][cand]
    entry.amplitudeOverFloor = floor === null || floor === 0 || entry.amplitude === null
      ? null
      : Math.round((entry.amplitude / floor) * 100) / 100
  }
}

/* ── 5. live clock probe (real time, no virtual clock) ── */
const live = runLive ? await liveClockProbe(pageUrl('live=1')) : { available: false, error: 'skipped (--no-live)' }
if (live.available) {
  console.log('')
  console.log('live clock probe: ' + live.animationCount + ' animations, playState ' + live.playStates.join('/') +
    ', ' + live.advanced + '/' + live.animationCount + ' advanced over ' + live.wallClockDeltaMs + 'ms of real time')
  console.log('  computed transform changed over real time: ' + live.renderedTransformChanged)
} else {
  console.log('')
  console.log('live clock probe unavailable: ' + live.error)
}

/* ── 6. write evidence ── */
const timeseries = {
  provenance: {
    ...provenance,
    frames: frames.map((f) => ({ t: f.t, file: 'frames/' + f.file.split(/[\\/]/).pop(), md5: f.md5 })),
  },
  imageSize,
  sampleBoxes: boxes,
  pageFacts: {
    mode: facts.mode,
    seekedTo: facts.seekedTo,
    dpr: facts.dpr,
    viewport: facts.viewport,
    scrollHeight: facts.scrollHeight,
    ua: facts.ua,
    cssRules: facts.css,
    seekedAnimations: facts.animations.map((a) => ({
      name: a.name, target: a.target, pseudo: a.pseudo, playState: a.playState,
      currentTime: a.currentTime, duration: a.duration, delay: a.delay, iterations: a.iterations,
    })),
  },
  live,
  oneToOne,
  pairedTest,
  summary,
  report,
}
writeFileSync(join(outDir, 'flow-flicker.facts.json'), JSON.stringify({
  provenance,
  facts: { mode: facts.mode, dpr: facts.dpr, viewport: facts.viewport, scrollHeight: facts.scrollHeight, rects: facts.rects, css: facts.css },
}, null, 2) + '\n', 'utf8')
writeFileSync(join(outDir, 'flow-flicker.timeseries.json'), JSON.stringify(timeseries, null, 2) + '\n', 'utf8')

/* ── 7. stdout summary ── */
const pad = (s, n) => String(s === null ? '-' : s).padEnd(n)
console.log('')
console.log('')
console.log('paired-frame test  (same dot positions, same comb, different twinkle phase)')
for (const theme of Object.keys(pairedTest)) {
  console.log('  theme ' + theme)
  console.log('    ' + pad('cand', 6) + pad('Δt(ms)', 8) + pad('变化块', 8) + pad('变亮/变暗', 11) + pad('相邻反相率', 12) + pad('|Δ|均值', 9) + pad('maxΔ', 8) + '判读')
  for (const cand of Object.keys(pairedTest[theme])) {
    for (const passId of Object.keys(pairedTest[theme][cand].passes)) {
      const p = pairedTest[theme][cand].passes[passId]
      for (const delta of Object.keys(p.deltas)) {
        const d = p.deltas[delta]
        if (d.note !== undefined) { console.log('    ' + pad(cand, 6) + pad(passId + ' @' + delta, 10) + d.note); continue }
        console.log('    ' + pad(cand, 6) + pad(passId + ' @' + delta, 10) + pad(d.changedSites, 8) + pad(d.brighter + '/' + d.dimmer, 11) + pad(d.alternationRate === null ? '-' : (d.alternationRate * 100) + '%', 12) + pad(d.meanSiteAbsDelta, 9) + pad(d.maxAbsDiff, 8) + d.verdict)
      }
    }
  }
}
console.log('')
for (const theme of Object.keys(summary)) {
  console.log('theme ' + theme + '   (noise floor = P0 amplitude ' + summary[theme].noiseFloor.amplitude + ')')
  console.log('  ' + pad('cand', 6) + pad('粒子', 6) + pad('幅度', 8) + pad('/floor', 8) + pad('同相度', 9) + pad('空间极差', 10) + pad('同相对', 8) + pad('反相对', 8) + '判读')
  for (const cand of Object.keys(summary[theme])) {
    const s = summary[theme][cand]
    if (cand === 'noiseFloor') continue
    console.log('  ' + pad(cand, 6) + pad(s.particles, 6) + pad(s.amplitude, 8) + pad(s.amplitudeOverFloor, 8) + pad(s.signAgreement, 9) + pad(s.meanSpatialSpread, 10) + pad(s.lockstepPairs + '/' + s.pairCount, 8) + pad(s.antiphasePairs + '/' + s.pairCount, 8) + s.verdict)
  }
  console.log('    per-width verdicts: ' + Object.entries(verdictCounts[theme]).map(([cand, counts]) => cand + ' [' + Object.entries(counts).map(([k, v]) => k + ' x' + v).join(', ') + ']').join('  '))
}
console.log('')
console.log('  幅度    = 各粒子亮度时间序列标准差的均值（亮度级，0 = 完全不动）')
console.log('  同相度  = 同一帧里各粒子归一化残差符号一致的程度（1 = 整层同相脉冲）')
console.log('  空间极差= 同一帧里各粒子归一化残差的极差（越大越"有的亮有的暗"）')
console.log('')
console.log('evidence -> ' + outDir)

if (!keep) rmSync(workDir, { recursive: true, force: true })
