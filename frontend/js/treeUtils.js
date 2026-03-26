// treeUtils.js — shared tree-building utilities for structure/reporting views

export function buildStructureTree(structureRows) {
  const byId = new Map();
  for (const r of Array.isArray(structureRows) ? structureRows : []) {
    if (r && r.STRUCTURE_ID != null) byId.set(r.STRUCTURE_ID, { ...r, children: [] });
  }

  const root = { id: "__PROJECT_ROOT__", children: [] };

  for (const node of byId.values()) {
    const parentId = node.PARENT_STRUCTURE_ID ?? node.FATHER_ID ?? null;
    if (parentId == null) {
      root.children.push(node);
    } else {
      const parent = byId.get(parentId);
      if (parent) parent.children.push(node);
      else root.children.push(node); // orphan safety
    }
  }

  return root;
}

export function flattenTree(root) {
  const out = [];
  const visited = new Set();

  function walk(node, depth) {
    if (!node) return;
    const key = node.STRUCTURE_ID ?? node.id;
    if (key != null) {
      const visitKey = `${key}@${depth}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);
    }

    if (node.STRUCTURE_ID != null) out.push({ node, depth });
    const children = Array.isArray(node.children) ? node.children : [];
    children.sort((a, b) => {
      const pa = a.PARENT_STRUCTURE_ID ?? a.FATHER_ID ?? -1;
      const pb = b.PARENT_STRUCTURE_ID ?? b.FATHER_ID ?? -1;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (a.STRUCTURE_ID ?? 0) - (b.STRUCTURE_ID ?? 0);
    });
    for (const ch of children) walk(ch, depth + 1);
  }

  for (const ch of (root.children || [])) walk(ch, 0);
  return out;
}
