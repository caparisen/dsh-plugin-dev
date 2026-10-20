/** Filesystem helpers: atomic writes, directory links, hashes, JSON reads. */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

/** Write a file through a temp sibling and rename, retrying Windows contention. */
export function writeFileAtomic(path, data) {
  ensureDir(dirname(path))
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, data)
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temp, path)
      return
    } catch (error) {
      const transient = ['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)
      if (!transient || attempt >= 8) {
        rmSync(temp, { force: true })
        throw error
      }
      waitSync(20 * (attempt + 1))
    }
  }
}

function waitSync(ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin: only used for sub-200 ms rename contention */
  }
}

/** Copy a file when it exists; return whether it was copied. */
export function copyIfExists(from, to) {
  if (!existsSync(from)) return false
  ensureDir(dirname(to))
  copyFileSync(from, to)
  return true
}

export function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

export function exists(path) {
  return existsSync(path)
}

/** Remove a file, directory, junction or symlink without following links. */
export function removePath(path) {
  rmSync(path, { recursive: true, force: true })
}

/** Link a directory (junction on Windows, symlink elsewhere). */
export function linkDir(target, linkPath) {
  removePath(linkPath)
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

/** SHA-256 hex of text or bytes. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Parse JSON, returning `undefined` instead of throwing. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Read text, returning `undefined` instead of throwing. */
export function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Sortable local timestamp: `2026-10-20T10-30-05`. */
export function timestamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, '').replaceAll(':', '-')
}
