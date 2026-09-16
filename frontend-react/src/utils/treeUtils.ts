import type { StructureNode } from '@/api/projekte'

interface TreeNode extends StructureNode {
  children: TreeNode[]
}

interface RootNode {
  id:       string
  children: TreeNode[]
}

export function buildStructureTree(rows: StructureNode[]): RootNode {
  const byId = new Map<number, TreeNode>()
  for (const r of rows) {
    if (r.STRUCTURE_ID != null) byId.set(r.STRUCTURE_ID, { ...r, children: [] })
  }

  const root: RootNode = { id: '__PROJECT_ROOT__', children: [] }

  for (const node of byId.values()) {
    const parentId = node.FATHER_ID ?? null
    if (parentId == null) {
      root.children.push(node)
    } else {
      const parent = byId.get(parentId)
      if (parent) parent.children.push(node)
      else root.children.push(node)
    }
  }

  return root
}

export interface FlatNode { node: TreeNode; depth: number }

export function flattenTree(root: RootNode): FlatNode[] {
  const out: FlatNode[] = []
  const visited = new Set<string>()

  function walk(node: TreeNode | RootNode, depth: number) {
    const key = 'STRUCTURE_ID' in node ? node.STRUCTURE_ID : (node as RootNode).id
    if (key != null) {
      const vk = `${key}@${depth}`
      if (visited.has(vk)) return
      visited.add(vk)
    }
    if ('STRUCTURE_ID' in node) out.push({ node: node as TreeNode, depth })
    const children = Array.isArray(node.children) ? node.children : []
    const sorted = [...children].sort((a, b) => {
      const sa = a.SORT_ORDER ?? a.STRUCTURE_ID ?? 0
      const sb = b.SORT_ORDER ?? b.STRUCTURE_ID ?? 0
      return sa - sb
    })
    for (const ch of sorted) walk(ch, depth + 1)
  }

  const sortedRoot = [...root.children].sort((a, b) => (a.SORT_ORDER ?? a.STRUCTURE_ID ?? 0) - (b.SORT_ORDER ?? b.STRUCTURE_ID ?? 0))
  for (const ch of sortedRoot) walk(ch, 0)
  return out
}

/**
 * Elemente, die Kinder haben — also KEINE Blätter.
 *
 * Gebucht (und umgebucht) wird ausschließlich auf Blätter: ein Element mit
 * Unterpositionen summiert seine Kinder, eine Buchung darauf zählte in jeder
 * Auswertung doppelt. Das Backend prüft dasselbe (services/buchungen.js).
 */
export function parentStructureIds(rows: StructureNode[]): Set<number> {
  return new Set(rows.filter(r => r.FATHER_ID != null).map(r => Number(r.FATHER_ID)))
}

/**
 * Voller Pfad je Element: „LP1 > LP5: Ausführungsplanung".
 *
 * Vorfahren mit Kürzel, das Element selbst mit Kürzel und Langtext — ohne den
 * Pfad sind „LP5" in zwei Zweigen nicht unterscheidbar, und genau das ist der
 * Grund, aus dem falsch gebucht wird.
 */
export function structurePaths(rows: StructureNode[]): Map<number, string> {
  const byId = new Map(rows.map(r => [r.STRUCTURE_ID, r]))
  const out  = new Map<number, string>()
  for (const row of rows) {
    const leaf = row.NAME_LONG ? `${row.NAME_SHORT}: ${row.NAME_LONG}` : row.NAME_SHORT
    const ancestors: string[] = []
    let fatherId = row.FATHER_ID != null ? Number(row.FATHER_ID) : null
    // Schleifenschutz: ein zyklischer FATHER_ID (Importfehler) darf die
    // Oberfläche nicht einfrieren.
    const seen = new Set<number>([row.STRUCTURE_ID])
    while (fatherId != null && !seen.has(fatherId)) {
      seen.add(fatherId)
      const parent = byId.get(fatherId)
      if (!parent) break
      ancestors.unshift(parent.NAME_SHORT)
      fatherId = parent.FATHER_ID != null ? Number(parent.FATHER_ID) : null
    }
    out.set(row.STRUCTURE_ID, ancestors.length ? `${ancestors.join(' > ')} > ${leaf}` : leaf)
  }
  return out
}
