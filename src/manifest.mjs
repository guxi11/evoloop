import { join } from 'node:path'
import { readIf } from './util.mjs'

export const MANIFEST = '.evoloop-manifest.json'
export const BACKUPS = '.evoloop-backups'

// The manifest is the ownership record: everything listed here we rendered, so
// everything in a target dir that is NOT listed came from somewhere else.
// Both directions of the loop hang off that distinction.
// v1 manifests were a bare array of paths; keep reading them.
// `root` is the config repo that rendered this tree — absent in older manifests.
export const readManifest = root => {
  const raw = JSON.parse(readIf(join(root, MANIFEST)) ?? 'null')
  return Array.isArray(raw)
    ? { root: null, files: raw, managed: {} }
    : { root: raw?.root ?? null, files: raw?.files ?? [], managed: raw?.managed ?? {} }
}
