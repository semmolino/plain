import { describe, it, expect } from 'vitest'
import { buildStructureTree, flattenTree } from './treeUtils'
import type { StructureNode } from '@/api/projekte'

// ── Helpers ──────────────────────────────────────────────────────────────────

function node(
  STRUCTURE_ID: number,
  FATHER_ID: number | null = null,
  overrides: Partial<StructureNode> = {},
): StructureNode {
  return {
    STRUCTURE_ID,
    FATHER_ID,
    NAME_LONG: `Node ${STRUCTURE_ID}`,
    SORT_ORDER: STRUCTURE_ID,
    TENANT_ID: 1,
    ...overrides,
  } as StructureNode
}

// ── buildStructureTree ────────────────────────────────────────────────────────

describe('buildStructureTree', () => {
  it('returns an empty root for an empty input', () => {
    const tree = buildStructureTree([])
    expect(tree.id).toBe('__PROJECT_ROOT__')
    expect(tree.children).toHaveLength(0)
  })

  it('puts a single root node under the root', () => {
    const tree = buildStructureTree([node(1, null)])
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].STRUCTURE_ID).toBe(1)
  })

  it('puts multiple root nodes under the root', () => {
    const tree = buildStructureTree([node(1, null), node(2, null), node(3, null)])
    expect(tree.children).toHaveLength(3)
  })

  it('nests a child under its parent', () => {
    const tree = buildStructureTree([node(1, null), node(2, 1)])
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].STRUCTURE_ID).toBe(1)
    expect(tree.children[0].children).toHaveLength(1)
    expect(tree.children[0].children[0].STRUCTURE_ID).toBe(2)
  })

  it('handles deep nesting (3 levels)', () => {
    const tree = buildStructureTree([node(1, null), node(2, 1), node(3, 2)])
    const level1 = tree.children[0]
    const level2 = level1.children[0]
    const level3 = level2.children[0]
    expect(level1.STRUCTURE_ID).toBe(1)
    expect(level2.STRUCTURE_ID).toBe(2)
    expect(level3.STRUCTURE_ID).toBe(3)
  })

  it('falls back unknown parent to root', () => {
    // Node 2 claims parent 99 which does not exist
    const tree = buildStructureTree([node(1, null), node(2, 99)])
    expect(tree.children).toHaveLength(2)
  })

  it('ignores rows with null STRUCTURE_ID', () => {
    const bad = { ...node(1, null), STRUCTURE_ID: null } as unknown as StructureNode
    const tree = buildStructureTree([bad, node(2, null)])
    // Only node 2 should appear (null STRUCTURE_ID skipped by byId.set guard)
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].STRUCTURE_ID).toBe(2)
  })
})

// ── flattenTree ───────────────────────────────────────────────────────────────

describe('flattenTree', () => {
  it('returns empty array for empty root', () => {
    const tree = buildStructureTree([])
    expect(flattenTree(tree)).toHaveLength(0)
  })

  it('returns all nodes', () => {
    const tree = buildStructureTree([node(1, null), node(2, null), node(3, 1)])
    const flat = flattenTree(tree)
    expect(flat).toHaveLength(3)
  })

  it('assigns correct depth', () => {
    const tree = buildStructureTree([node(1, null), node(2, 1), node(3, 2)])
    const flat = flattenTree(tree)
    const depths = flat.map(f => f.depth)
    expect(depths).toEqual([0, 1, 2])
  })

  it('respects SORT_ORDER for siblings', () => {
    const rows = [
      node(1, null, { SORT_ORDER: 1 } as Partial<StructureNode>),
      node(2, null, { SORT_ORDER: 3 } as Partial<StructureNode>),
      node(3, null, { SORT_ORDER: 2 } as Partial<StructureNode>),
    ]
    const tree = buildStructureTree(rows)
    const flat = flattenTree(tree)
    expect(flat.map(f => f.node.STRUCTURE_ID)).toEqual([1, 3, 2])
  })

  it('produces a pre-order traversal (parent before children)', () => {
    const tree = buildStructureTree([node(1, null), node(2, 1), node(3, null)])
    const flat = flattenTree(tree)
    const ids = flat.map(f => f.node.STRUCTURE_ID)
    // Node 1 must appear before its child node 2
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(2))
  })

  it('does not visit the same node twice (cycle guard)', () => {
    // Two nodes pointing to each other is not possible in this data model,
    // but we can at least verify no duplicates in a normal tree
    const tree = buildStructureTree([node(1, null), node(2, 1), node(3, 1)])
    const flat = flattenTree(tree)
    const ids = flat.map(f => f.node.STRUCTURE_ID)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
