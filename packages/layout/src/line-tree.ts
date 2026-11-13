// 'Names only' classic line tree (LLD L7, wireframe A9). Pure: gives positions, the app draws them.
import { bySiblingOrder, indexGraph, partnerOf } from './graph.ts';
import type { GraphIndex, TreeGraph, TreeUnion } from './graph.ts';

export interface LayoutOptions {
  focusId?: string | null;
  cardWidth?: number;
  gapX?: number;
  rowHeight?: number;
  /** Hide branches more than this many generations below the focus. Null shows everything. */
  collapseBeyond?: number | null;
  /** People whose hidden children the user has opened. */
  expanded?: string[];
}
export interface CardPos {
  personId: string;
  /** Centre of the card. */
  x: number;
  y: number;
  generation: number;
  /** Stand-in beside a partner: the real card is in the person's own family (cousin marriage). */
  ghost: boolean;
  hiddenChildren: number;
}
export interface UnionPos {
  unionId: string;
  x: number;
  y: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface TreeLine {
  kind: 'partner' | 'child' | 'ghost';
  points: Point[];
}
export interface TreeLayout {
  cards: CardPos[];
  unions: UnionPos[];
  lines: TreeLine[];
  width: number;
  height: number;
}

interface RowItem {
  personId: string;
  ghost: boolean;
  x: number;
}
interface Block {
  width: number;
  /** Row items and everything below, with x relative to this block's left edge. */
  items: RowItem[];
  unions: { unionId: string; left: string; right: string }[];
}

/** L7 step 1: generations from the focus. Blood first, so someone who married a cousin keeps their own row. */
function rankGenerations(index: GraphIndex, graph: TreeGraph, focusId: string | null): Map<string, number> {
  const rank = new Map<string, number>();
  const starts = focusId ? [focusId] : [];
  for (const p of graph.persons) starts.push(p.id);
  for (const start of starts) {
    if (rank.has(start) || !index.people.has(start)) continue;
    rank.set(start, 0);
    let blood = [start];
    let marriage: string[] = [];
    while (blood.length > 0 || marriage.length > 0) {
      if (blood.length === 0) {
        blood = marriage.filter((id, i) => marriage.indexOf(id) === i);
        marriage = [];
      }
      const id = blood.shift();
      if (id === undefined) break;
      const r = rank.get(id) ?? 0;
      for (const parent of index.parentsOf.get(id) ?? []) {
        if (!rank.has(parent)) {
          rank.set(parent, r - 1);
          blood.push(parent);
        }
      }
      for (const link of index.childLinks.get(id) ?? []) {
        if (!rank.has(link.childId)) {
          rank.set(link.childId, r + 1);
          blood.push(link.childId);
        }
      }
      for (const u of index.unionsOf.get(id) ?? []) {
        const other = partnerOf(u, id);
        if (other && !rank.has(other)) {
          rank.set(other, r);
          marriage.push(other);
        }
      }
    }
  }
  return rank;
}

function hasParents(index: GraphIndex, id: string): boolean {
  return (index.parentsOf.get(id) ?? []).length > 0;
}

export function layoutLineTree(graph: TreeGraph, options: LayoutOptions = {}): TreeLayout {
  const cardWidth = options.cardWidth ?? 84;
  const gapX = options.gapX ?? 20;
  const rowHeight = options.rowHeight ?? 140;
  const focusId = options.focusId ?? null;
  const limit = options.collapseBeyond ?? null;
  const expanded = new Set(options.expanded ?? []);

  const index = indexGraph(graph);
  const rank = rankGenerations(index, graph, focusId);
  const focusRank = focusId ? (rank.get(focusId) ?? 0) : 0;
  const placed = new Set<string>();
  const usedUnions = new Set<string>();
  const hiddenCount = new Map<string, number>();
  const hidden = new Set<string>();
  const rowOwnerRank = new Map<string, number>();

  function hideBranch(id: string): void {
    if (hidden.has(id)) return;
    hidden.add(id);
    for (const l of index.childLinks.get(id) ?? []) hideBranch(l.childId);
  }

  function shouldHide(parentId: string, childId: string): boolean {
    if (limit === null || !focusId || expanded.has(parentId)) return false;
    return (rank.get(childId) ?? 0) - focusRank > limit;
  }

  // Which children hang under which union. A link without a union id still belongs to a union holding both parents.
  function childrenOfUnion(u: TreeUnion): string[] {
    const ids = new Set<string>();
    for (const l of index.childLinks.get(u.partner1Id) ?? []) {
      if (l.unionId === u.id) ids.add(l.childId);
      else if (!l.unionId && u.partner2Id && (index.parentsOf.get(l.childId) ?? []).includes(u.partner2Id)) ids.add(l.childId);
    }
    return bySiblingOrder(index, [...ids]);
  }

  function buildBlock(ownerId: string): Block {
    placed.add(ownerId);
    const row: { personId: string; ghost: boolean }[] = [{ personId: ownerId, ghost: false }];
    const rowUnions: { unionId: string; left: string; right: string }[] = [];
    const groups: string[][] = [];
    const ownerRank = rank.get(ownerId) ?? 0;

    function addUnionsOf(personId: string, firstGoesLeft: boolean): void {
      const own = (index.unionsOf.get(personId) ?? [])
        .filter((u) => !usedUnions.has(u.id))
        .sort((a, b) => (a.seq1 ?? 0) - (b.seq1 ?? 0));
      own.forEach((u, i) => {
        usedUnions.add(u.id);
        groups.push(childrenOfUnion(u));
        const other = partnerOf(u, personId);
        if (!other) return;
        const ghost = hasParents(index, other) || placed.has(other);
        if (!ghost) placed.add(other);
        const at = row.findIndex((r) => r.personId === personId && !r.ghost);
        const entry = { personId: other, ghost };
        // L7 step 2: with several partners, the first sits on the left and the next on the right.
        if (firstGoesLeft && own.length > 1 && i === 0) {
          row.splice(at, 0, entry);
          rowUnions.push({ unionId: u.id, left: other, right: personId });
        } else {
          row.push(entry);
          rowUnions.push({ unionId: u.id, left: personId, right: other });
        }
        if (!ghost) addUnionsOf(other, false);
      });
    }
    addUnionsOf(ownerId, true);

    // Children with one known parent hang directly from that parent.
    const inGroups = new Set(groups.flat());
    const solo: string[] = [];
    for (const r of row) {
      if (r.ghost) continue;
      for (const l of index.childLinks.get(r.personId) ?? []) {
        if (!inGroups.has(l.childId) && !solo.includes(l.childId)) solo.push(l.childId);
      }
    }
    if (solo.length > 0) groups.unshift(bySiblingOrder(index, solo));

    const items: RowItem[] = [];
    const unions = rowUnions.slice();
    const childBlocks: Block[] = [];
    for (const group of groups) {
      for (const childId of group) {
        if (placed.has(childId)) continue;
        const parentId = row.find((r) => !r.ghost && (index.parentsOf.get(childId) ?? []).includes(r.personId))?.personId ?? ownerId;
        if (shouldHide(parentId, childId)) {
          hiddenCount.set(parentId, (hiddenCount.get(parentId) ?? 0) + 1);
          hideBranch(childId);
          continue;
        }
        childBlocks.push(buildBlock(childId));
      }
    }

    const rowWidth = row.length * cardWidth + (row.length - 1) * gapX;
    const childrenWidth = childBlocks.reduce((sum, b) => sum + b.width, 0) + Math.max(0, childBlocks.length - 1) * gapX;
    const width = Math.max(rowWidth, childrenWidth);

    const rowLeft = (width - rowWidth) / 2;
    row.forEach((r, i) => {
      items.push({ personId: r.personId, ghost: r.ghost, x: rowLeft + cardWidth / 2 + i * (cardWidth + gapX) });
      if (r.ghost) rowOwnerRank.set(`${r.personId}|${ownerId}`, ownerRank);
    });
    let left = (width - childrenWidth) / 2;
    for (const b of childBlocks) {
      for (const it of b.items) items.push({ personId: it.personId, ghost: it.ghost, x: it.x + left });
      unions.push(...b.unions);
      left += b.width + gapX;
    }
    return { width, items, unions };
  }

  // Start from people with no parents whose partners have none either: most partners first, so
  // a man with two wives is the centre of his row rather than one of the wives.
  const roots = graph.persons
    .map((p) => p.id)
    .filter((id) => !hasParents(index, id))
    .filter((id) => !(index.unionsOf.get(id) ?? []).some((u) => {
      const other = partnerOf(u, id);
      return other !== null && hasParents(index, other);
    }))
    .sort((a, b) => (index.unionsOf.get(b) ?? []).length - (index.unionsOf.get(a) ?? []).length);

  const built: Block[] = [];
  for (const id of roots) if (!placed.has(id) && !hidden.has(id)) built.push(buildBlock(id));
  for (const p of graph.persons) if (!placed.has(p.id) && !hidden.has(p.id)) built.push(buildBlock(p.id));

  // The row a card sits on: its own generation, or for a stand-in its partner's (the card just beside it).
  const rowOf = (b: Block, it: RowItem): number => {
    const own = rank.get(it.personId) ?? 0;
    if (!it.ghost) return own;
    const partner = (index.unionsOf.get(it.personId) ?? [])
      .map((u) => partnerOf(u, it.personId))
      .find((id) => id !== null && b.items.some((o) => o.personId === id && !o.ghost));
    return partner ? (rank.get(partner) ?? own) : own;
  };
  const realBlock = (personId: string) => built.find((b) => b.items.some((it) => it.personId === personId && !it.ghost));

  // Families joined by a marriage sit side by side: after a family whose row ends with a stand-in for someone
  // who married in, comes that person's own family.
  const blocks: Block[] = [];
  const left = built.slice();
  while (left.length) {
    let current = left.shift() as Block;
    blocks.push(current);
    for (;;) {
      const ghosts = current.items.filter((it) => it.ghost).sort((a, b) => b.x - a.x);
      const next = ghosts.map((g) => realBlock(g.personId)).find((b): b is Block => !!b && left.includes(b));
      if (!next) break;
      left.splice(left.indexOf(next), 1);
      blocks.push(next);
      current = next;
    }
  }

  // A stand-in is only needed when the real card is far away. When the person's own family sits right next door
  // and nothing is between the two cards on that row, the stand-in goes and the marriage line reaches the real card
  // (so someone who married in shows once, not twice).
  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    a.items = a.items.filter((it) => {
      if (!it.ghost) return true;
      const r = rowOf(a, it);
      const sameRowA = a.items.filter((o) => o !== it && rowOf(a, o) === r);
      if (sameRowA.some((o) => o.x > it.x)) return true;
      const real = b.items.find((o) => o.personId === it.personId && !o.ghost);
      if (!real || (rank.get(real.personId) ?? 0) !== r) return true;
      const sameRowB = b.items.filter((o) => o !== real && rowOf(b, o) === r);
      return sameRowB.some((o) => o.x < real.x);
    });
  }

  // Final positions
  const cards: CardPos[] = [];
  const realSpot = new Map<string, CardPos>();
  const anySpot = new Map<string, CardPos[]>();
  let offset = 0;
  let minRank = Infinity;
  for (const r of rank.values()) minRank = Math.min(minRank, r);
  const yOf = (r: number) => (r - minRank) * rowHeight;

  for (const b of blocks) {
    // A row's ghost sits on its partner's row, which is the row of the card just placed beside it.
    b.items.forEach((it) => {
      const r = rowOf(b, it);
      const card: CardPos = {
        personId: it.personId,
        x: it.x + offset,
        y: yOf(r),
        generation: r - focusRank,
        ghost: it.ghost,
        hiddenChildren: it.ghost ? 0 : (hiddenCount.get(it.personId) ?? 0),
      };
      cards.push(card);
      if (!it.ghost) realSpot.set(it.personId, card);
      const spots = anySpot.get(it.personId);
      if (spots) spots.push(card);
      else anySpot.set(it.personId, [card]);
    });
    offset += b.width + gapX * 2;
  }

  // Unions and lines
  const unionPos: UnionPos[] = [];
  const lines: TreeLine[] = [];
  const spotBeside = (id: string, other: CardPos | undefined) => {
    const spots = anySpot.get(id) ?? [];
    if (!other) return spots[0];
    return spots.slice().sort((a, b) => Math.abs(a.x - other.x) + Math.abs(a.y - other.y) - Math.abs(b.x - other.x) - Math.abs(b.y - other.y))[0];
  };
  const unionAt = new Map<string, UnionPos>();
  for (const b of blocks) {
    for (const u of b.unions) {
      const leftReal = realSpot.get(u.left);
      const a = leftReal && !cards.some((c) => c.personId === u.left && c.ghost) ? leftReal : spotBeside(u.left, realSpot.get(u.right));
      const c = spotBeside(u.right, a);
      if (!a || !c) continue;
      const pos = { unionId: u.unionId, x: (a.x + c.x) / 2, y: a.y };
      unionPos.push(pos);
      unionAt.set(u.unionId, pos);
      lines.push({ kind: 'partner', points: [{ x: a.x, y: a.y }, { x: c.x, y: c.y }] });
    }
  }

  const drawn = new Set<string>();
  function childLine(from: Point, childId: string): void {
    const child = realSpot.get(childId);
    if (!child) return;
    const midY = from.y + rowHeight / 2;
    lines.push({ kind: 'child', points: [from, { x: from.x, y: midY }, { x: child.x, y: midY }, { x: child.x, y: child.y }] });
  }
  for (const u of graph.unions) {
    const at = unionAt.get(u.id);
    if (!at) continue;
    for (const childId of childrenOfUnion(u)) {
      drawn.add(childId);
      childLine(at, childId);
    }
  }
  for (const l of graph.links) {
    if (drawn.has(l.childId)) continue;
    const parent = realSpot.get(l.parentId);
    if (parent) childLine({ x: parent.x, y: parent.y }, l.childId);
  }
  for (const c of cards) {
    if (!c.ghost) continue;
    const real = realSpot.get(c.personId);
    if (real) lines.push({ kind: 'ghost', points: [{ x: c.x, y: c.y }, { x: real.x, y: real.y }] });
  }

  const width = Math.max(0, offset - gapX * 2);
  let maxY = 0;
  for (const c of cards) maxY = Math.max(maxY, c.y);
  return { cards, unions: unionPos, lines, width, height: maxY + rowHeight };
}

/** L7 step 6: only the cards inside the screen are drawn. */
export function cardsInView(layout: TreeLayout, x: number, y: number, w: number, h: number, margin = 120): CardPos[] {
  return layout.cards.filter(
    (c) => c.x >= x - margin && c.x <= x + w + margin && c.y >= y - margin && c.y <= y + h + margin,
  );
}
