/**
 * Deploy this plugin into a dsh profile.
 *
 * Three idempotent steps:
 *
 *   1. copy the package into the profile's `node_modules` so the Cordis Loader
 *      can resolve the entry name;
 *   2. declare it in the profile manifest's `dependencies` with a `link:` spec,
 *      so a future `pnpm install` keeps it (and swaps the copy for a symlink
 *      back to this source tree) instead of pruning it as an unknown directory;
 *   3. insert the loader entry into the profile's `cordis.patch.yml`.
 *
 * Step 3 is why this plugin does NOT go through `dsh.profile.bundles`: the
 * bundle layer list is read once at boot, while the user patch layer is watched
 * (`watchUserPatches` + `DEFAULT_PROFILE_PATCH_RELOAD = "live"`). Editing the
 * patch file therefore reloads the entry into the running process, and the
 * client module system's incremental scan picks the new row up — a page refresh
 * is enough, no restart.
 *
 * Usage:
 *   node scripts/deploy.mjs [--profile web] [--dry-run]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).name

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const profileIndex = argv.indexOf('--profile')
const profileName = profileIndex === -1 ? 'web' : argv[profileIndex + 1]

if (profileName === undefined || profileName.startsWith('--')) {
  console.error('deploy: --profile needs a name')
  process.exit(1)
}

const ENTRY_ID = 'reasoning-slider'
const MARKER = `# ── ${PACKAGE_NAME}`
const PATCH_BLOCK = [
  '',
  `${MARKER} ${'─'.repeat(Math.max(0, 58 - PACKAGE_NAME.length))}`,
  `# 推理强度滑块：把输入框的模型 seat 换成蓝→橙渐变滑块。`,
  `# 本段注册走 profile 的 patch 层（可热重载）；包内 cordis.patch.yml 是备用形态，`,
  `# 若改用 \`dsh plugin --profile ${profileName} add\`（走 dsh.profile.bundles），请先删掉本段。`,
  '- insert:',
  `    - id: ${ENTRY_ID}`,
  `      name: ${PACKAGE_NAME}`,
  '',
].join('\n')

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const target = join(profileDir, 'node_modules', PACKAGE_NAME)

if (!existsSync(profileDir)) {
  console.error(`deploy: no such profile directory: ${profileDir}`)
  process.exit(1)
}

/* 1 — package copy -------------------------------------------------- */

const files = ['package.json', 'lib', 'cordis.patch.yml', 'README.md']

console.log(`deploy: ${PACKAGE_NAME} -> ${target}${dryRun ? ' (dry run)' : ''}`)
for (const file of files) {
  const from = join(PACKAGE_ROOT, file)
  if (!existsSync(from)) {
    console.warn(`  skip ${file} (not present)`)
    continue
  }
  console.log(`  ${file}`)
  if (dryRun) continue
  const to = join(target, file)
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

/* 2 — profile manifest ---------------------------------------------- */

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []
const dependencies = { ...manifest.dependencies }
const linkSpec = `link:${PACKAGE_ROOT.replaceAll('\\', '/')}`

const bundlesHadIt = bundles.includes(PACKAGE_NAME)
const nextBundles = bundles.filter((name) => name !== PACKAGE_NAME)
const dependencyChanged = dependencies[PACKAGE_NAME] !== linkSpec
dependencies[PACKAGE_NAME] = linkSpec

const manifestNotes = []
if (bundlesHadIt) manifestNotes.push(`  - dsh.profile.bundles: ${PACKAGE_NAME} (patch layer owns the entry instead)`)
if (dependencyChanged) manifestNotes.push(`  + dependencies: ${PACKAGE_NAME} = ${linkSpec}`)

if (manifestNotes.length === 0) {
  console.log(`deploy: ${manifestPath} is already wired up`)
} else {
  console.log(`deploy: updating ${manifestPath}`)
  console.log(manifestNotes.join('\n'))
  if (!dryRun) {
    writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: nextBundles } },
      dependencies,
    }, null, 2)}\n`, 'utf8')
  }
}

/* 3 — profile patch layer ------------------------------------------- */

const patchPath = join(profileDir, 'cordis.patch.yml')
const patchSource = readFileSync(patchPath, 'utf8')

if (patchSource.includes(`${MARKER} `)) {
  console.log(`deploy: ${patchPath} already carries the entry`)
} else {
  console.log(`deploy: appending the loader entry to ${patchPath}`)
  if (!dryRun) {
    writeFileSync(`${patchPath}.bak-${PACKAGE_NAME.replaceAll('/', '-')}`, patchSource, 'utf8')
    const next = patchSource.endsWith('\n') ? patchSource : `${patchSource}\n`
    writeFileSync(patchPath, `${next}${PATCH_BLOCK}`, 'utf8')
  }
}

console.log(dryRun
  ? 'deploy: dry run complete'
  : `deploy: done — the profile watches ${patchPath}, so the entry reloads live; refresh the page to see the seat.`)
