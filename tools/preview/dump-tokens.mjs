/** Extract the shipped design-platform palette so preview/verification uses real values. */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const src = readFileSync(file, 'utf8')
const start = src.indexOf('var design_platform_css_default = ')
if (start === -1) throw new Error('design_platform_css_default not found')
const q = src.indexOf('"', start)
let end = -1
for (let i = q + 1; i < src.length; i += 1) {
  if (src[i] === '\\') { i += 1; continue }
  if (src[i] === '"') { end = i; break }
}
const css = JSON.parse(src.slice(q, end + 1))

function block(selector) {
  const out = {}
  const needle = selector + '{'
  let at = css.indexOf(needle)
  while (at !== -1) {
    const close = css.indexOf('}', at)
    for (const decl of css.slice(at + needle.length, close).split(';')) {
      const k = decl.indexOf(':')
      if (k > 0) out[decl.slice(0, k).trim()] = decl.slice(k + 1).trim()
    }
    at = css.indexOf(needle, close)
  }
  return out
}

const light = block('body')
const dark = { ...light, ...block('body[data-ds-dark-theme]') }

function resolve(map, value, depth = 0) {
  if (typeof value !== 'string' || depth > 6) return value
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value.trim())
  if (m === null) return value
  const next = map[m[1]] !== undefined ? map[m[1]] : m[2]
  const name = m[1]
  return resolve(map, next, depth + 1) + '   → ' + name
}

const wanted = process.argv.slice(3)
for (const key of wanted) {
  console.log(key)
  console.log('   light:', resolve(light, light[key]) ?? '(undefined)')
  console.log('   dark :', resolve(dark, dark[key]) ?? '(undefined)')
}
