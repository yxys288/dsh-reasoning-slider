/**
 * dsh-reasoning-slider — Host half.
 *
 * The feature lives entirely in the browser bundle (`exports["./client"]`).
 * This half exists for one structural reason: the client module system scans
 * the host Loader's *entries* for packages declaring `dsh.client`, so a
 * client-only package would never be discovered. Keeping a real (if inert)
 * host plugin — and giving it a profile row through the bundle patch — is what
 * puts this package on the entry list the scan walks.
 *
 * The host half deliberately registers no tool, no service, no listener, and
 * requires no host injection, so it cannot fail activation on any profile.
 *
 * @module dsh-reasoning-slider
 */

/** Cordis plugin name. */
export const name = 'reasoning-slider'

/** No host services are required or consumed. */
export const inject = []

/**
 * Install the host half.
 *
 * Intentionally empty: everything this plugin does happens in the browser
 * bundle. Keeping the function (rather than exporting a bare object) matches
 * the ordinary Cordis plugin shape.
 */
export function apply() {}
