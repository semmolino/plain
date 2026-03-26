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
      const fa = a.FATHER_ID ?? -1
      const fb = b.FATHER_ID ?? -1
      if (fa !== fb) return fa < fb ? -1 : 1
      return (a.STRUCTURE_ID ?? 0) - (b.STRUCTURE_ID ?? 0)
    })
    for (const ch of sorted) walk(ch, depth + 1)
  }

  for (const ch of root.children) walk(ch, 0)
  return out
}
