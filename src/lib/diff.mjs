/**
 * Line-level composition diffing.
 *
 * `dsh --dump-config` output is the only trustworthy description of a profile
 * tree, so the kit diffs that text rather than re-deriving patch precedence.
 * Normalisation is deliberately conservative: line endings, trailing spaces and
 * blank lines only — every other difference is reported.
 */

/** Split text into normalised lines. Blank lines are dropped: a composed dump
 * uses them only as separators, and keeping them turns every diff into noise. */
export function normalizeText(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line !== '')
}

/**
 * Longest-common-subsequence diff.
 *
 * @param {string[]} before
 * @param {string[]} after
 * @returns {{ status: 'same' | 'add' | 'del', line: string }[]}
 */
export function diffLines(before, after) {
  const a = before
  const b = after
  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Int32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }
  const result = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ status: 'same', line: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      result.push({ status: 'del', line: a[i] })
      i += 1
    } else {
      result.push({ status: 'add', line: b[j] })
      j += 1
    }
  }
  while (i < a.length) {
    result.push({ status: 'del', line: a[i] })
    i += 1
  }
  while (j < b.length) {
    result.push({ status: 'add', line: b[j] })
    j += 1
  }
  return result
}

/** Count added and removed lines. */
export function summarizeDiff(diff) {
  let added = 0
  let removed = 0
  for (const entry of diff) {
    if (entry.status === 'add') added += 1
    else if (entry.status === 'del') removed += 1
  }
  return { added, removed, changed: added + removed > 0 }
}

/** Render a compact unified-style diff with context. */
export function formatDiff(diff, context = 2) {
  const lines = []
  const keep = new Set()
  diff.forEach((entry, index) => {
    if (entry.status === 'same') return
    for (let i = index - context; i <= index + context; i += 1) {
      if (i >= 0 && i < diff.length) keep.add(i)
    }
  })
  let previousKept = -2
  diff.forEach((entry, index) => {
    if (!keep.has(index)) return
    if (index !== previousKept + 1) lines.push('...')
    const marker = entry.status === 'add' ? '+' : entry.status === 'del' ? '-' : ' '
    lines.push(`${marker} ${entry.line}`)
    previousKept = index
  })
  return lines.join('\n')
}

/**
 * Scan composed YAML for entry headers without parsing YAML.
 *
 * The dump is a flat array of loader rows with indentation preserved, so a
 * line scanner can recover `id`, `name` and `disabled` reliably enough to
 * report duplicates and to list what a profile actually mounts.
 *
 * @param {string[]} lines
 * @returns {{ id: string, name: string | null, disabled: boolean | null, line: number }[]}
 */
export function scanEntries(lines) {
  const entries = []
  let current = null
  let indent = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(line)
    if (idMatch) {
      current = { id: unquote(idMatch[2]), name: null, disabled: null, line: index + 1 }
      indent = idMatch[1].length
      entries.push(current)
      continue
    }
    if (current === null) continue
    if (/^\s*-\s/.test(line) || /^\S/.test(line)) {
      current = null
      continue
    }
    if (line.length - line.trimStart().length <= indent) {
      current = null
      continue
    }
    if (current.name === null) {
      const nameMatch = /^\s+name:\s*(.+?)\s*$/.exec(line)
      if (nameMatch) {
        current.name = unquote(nameMatch[1])
        continue
      }
    }
    if (current.disabled === null) {
      const disabledMatch = /^\s+disabled:\s*(.+?)\s*$/.exec(line)
      if (disabledMatch) current.disabled = disabledMatch[1].trim() === 'true'
    }
  }
  return entries
}

function unquote(value) {
  const text = value.trim()
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1)
  }
  return text
}
