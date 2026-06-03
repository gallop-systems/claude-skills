#!/usr/bin/env node
// Postinstall: symlink this package's skills and commands into the consuming
// project's .claude directory, so a `yarn add` / `yarn install` keeps the
// project in sync with this package's version:
//
//   skills   -> .claude/skills/<name>        (a dir containing SKILL.md)
//   commands -> .claude/commands/<rel>.md    (a .md file under any commands/ dir)
//
// This runs during `yarn install`, so it MUST NOT throw — a thrown error aborts
// the whole install. Every failure path here degrades to a warning + exit 0.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/link-skills.mjs -> package root
const PKG_DIR = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const PKG_DIR_REAL = realOrSelf(PKG_DIR)
const UNLINK = process.argv.includes('--unlink')
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude'])

const log = (msg) => console.log(`[agent-skills] ${msg}`)
const warn = (msg) => console.warn(`[agent-skills] ${msg}`)

function realOrSelf(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

// Resolve the project that pulled us in. npm and Yarn (Classic + Berry) set
// INIT_CWD to the directory where the install command ran — the project root,
// or the workspace root in a monorepo, which is exactly where the shared
// .claude directory should live. Fall back to climbing out of node_modules.
function resolveProjectRoot() {
  // INIT_CWD may equal PKG_DIR when installing in this repo itself; main()
  // detects that and skips, so return it unconditionally here.
  if (process.env.INIT_CWD) return path.resolve(process.env.INIT_CWD)

  const marker = `${path.sep}node_modules${path.sep}`
  const idx = PKG_DIR.indexOf(marker)
  if (idx !== -1) return PKG_DIR.slice(0, idx)

  return null
}

// Skills: every directory that directly contains a SKILL.md. Skills don't nest,
// so stop descending once one is found. Returns Map<name, sourceDir>.
function collectSkills(root) {
  const found = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      add(found, path.basename(dir), dir, 'skill')
      return
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name))
    }
  }
  walk(root)
  return found
}

// Commands: every .md file under any directory named `commands/`, keyed by its
// path relative to that commands dir (so commands/git/sync.md -> git/sync.md).
// Returns Map<relPath, sourceFile>.
function collectCommands(root) {
  const found = new Map()
  const harvest = (cmdDir) => {
    const walk = (dir) => {
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile() && e.name.endsWith('.md')) add(found, path.relative(cmdDir, p), p, 'command')
      }
    }
    walk(cmdDir)
  }
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.name === 'commands') harvest(p)
      else walk(p)
    }
  }
  walk(root)
  return found
}

function add(map, key, src, kind) {
  if (map.has(key)) {
    warn(`duplicate ${kind} "${key}" (${src}); keeping ${map.get(key)}.`)
    return
  }
  map.set(key, src)
}

// True only for symlinks whose real target lives inside this package — i.e.
// links we created. Used so cleanup never touches the user's own files.
function isOwnedLink(linkPath) {
  let raw
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return false
    raw = fs.readlinkSync(linkPath)
  } catch {
    return false
  }
  const target = realOrSelf(path.resolve(path.dirname(linkPath), raw))
  return target === PKG_DIR_REAL || target.startsWith(PKG_DIR_REAL + path.sep)
}

// Recursively remove owned links under root whose rel path isn't wanted, then
// prune directories that we emptied out. Never recurses into a symlink, so it
// won't follow a linked skill dir back into the package.
function removeStaleLinks(root, keepRels) {
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isSymbolicLink()) {
        if (!keepRels.has(path.relative(root, p)) && isOwnedLink(p)) {
          try {
            fs.rmSync(p, { force: true })
          } catch (err) {
            warn(`could not remove stale link "${path.relative(root, p)}": ${err.message}`)
          }
        }
      } else if (e.isDirectory()) {
        walk(p)
        try {
          if (fs.readdirSync(p).length === 0) fs.rmdirSync(p)
        } catch {
          // not empty or not ours — leave it
        }
      }
    }
  }
  walk(root)
}

// Link every wanted item into destRoot, refreshing existing owned links and
// never clobbering a real path the user authored. Returns the count linked.
function linkInto(destRoot, wanted, kind) {
  const exists = fs.existsSync(destRoot)

  // Nothing to link: only tidy up previously-created links (if the dir exists),
  // so we never create an empty .claude/<kind> directory in every consumer.
  if (wanted.size === 0) {
    if (exists) removeStaleLinks(realOrSelf(destRoot), new Set())
    return 0
  }

  fs.mkdirSync(destRoot, { recursive: true })
  // Realpath the link root so relative targets stay clean even when the project
  // lives under a symlinked path (PKG_DIR is realpath-resolved via
  // import.meta.url; a mismatch blows targets up to a ../../../ chain to root).
  const root = realOrSelf(destRoot)
  removeStaleLinks(root, new Set(wanted.keys()))

  let linked = 0
  for (const [rel, src] of wanted) {
    const dest = path.join(root, rel)
    let existing = null
    try {
      existing = fs.lstatSync(dest)
    } catch {
      // doesn't exist yet
    }
    if (existing) {
      if (existing.isSymbolicLink()) {
        fs.rmSync(dest, { force: true }) // refresh the target
      } else {
        warn(`"${rel}" already exists in .claude/${kind} as a real path; leaving it untouched.`)
        continue
      }
    }
    const isDir = (() => {
      try {
        return fs.statSync(src).isDirectory()
      } catch {
        return false
      }
    })()
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true }) // for nested command paths
      fs.symlinkSync(path.relative(path.dirname(dest), src), dest, isDir ? 'dir' : 'file')
      linked++
    } catch (err) {
      warn(`failed to link "${rel}": ${err.message}`)
    }
  }
  return linked
}

function main() {
  const projectRoot = resolveProjectRoot()
  if (!projectRoot) {
    warn('could not determine the project root (INIT_CWD unset); skipping.')
    return
  }
  if (realOrSelf(projectRoot) === PKG_DIR_REAL && !process.env.CLAUDE_SKILLS_LINK_SELF) {
    log('installed in its own repo; skipping self-link (set CLAUDE_SKILLS_LINK_SELF=1 to override).')
    return
  }

  const skillsRoot = path.join(projectRoot, '.claude', 'skills')
  const commandsRoot = path.join(projectRoot, '.claude', 'commands')

  if (UNLINK) {
    for (const root of [skillsRoot, commandsRoot]) {
      if (fs.existsSync(root)) removeStaleLinks(realOrSelf(root), new Set())
    }
    log('removed managed symlinks from .claude/skills and .claude/commands.')
    return
  }

  const skills = linkInto(skillsRoot, collectSkills(PKG_DIR), 'skills')
  const commands = linkInto(commandsRoot, collectCommands(PKG_DIR), 'commands')
  log(`linked ${skills} skill${skills === 1 ? '' : 's'} and ${commands} command${commands === 1 ? '' : 's'} into .claude/`)
}

try {
  main()
} catch (err) {
  warn(`unexpected error, skipping: ${err && err.message}`)
}
