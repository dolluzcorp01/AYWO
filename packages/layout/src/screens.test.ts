import { describe, expect, it } from 'vitest';
import { graphFromApi } from './api-graph.ts';
import { closeFamily, focusSections, relationText } from './focus-sections.ts';
import { focusView } from './focus-view.ts';
import { layoutLineTree } from './line-tree.ts';
import type { TreeLine } from './line-tree.ts';
import { centerOn, clampView, linesInView, pinchDistance, toScreen, visibleWindow, zoomAround } from './viewport.ts';

const api = {
  nodes: [
    { id: 'gm', name: 'gm' }, { id: 'mum', name: 'mum' }, { id: 'dad', name: 'dad' }, { id: 'me', name: 'me' },
    { id: 'sis', name: 'sis' }, { id: 'bro', name: 'bro' }, { id: 'third', name: 'third' }, { id: 'wife', name: 'wife' },
  ],
  unions: [
    { id: 'u1', partner1_id: 'dad', partner2_id: 'mum', seq1: 1 },
    { id: 'u2', partner1_id: 'me', partner2_id: 'wife', seq1: 1 },
  ],
  links: [
    { parent_id: 'gm', child_id: 'mum', union_id: null },
    ...['me', 'sis', 'bro', 'third'].flatMap((c) => [
      { parent_id: 'dad', child_id: c, union_id: 'u1' },
      { parent_id: 'mum', child_id: c, union_id: 'u1' },
    ]),
  ],
};

describe('My view sections', () => {
  const sections = focusSections(focusView(graphFromApi(api), 'me'));

  it('grandparents, then parents, above the centre card', () => {
    expect(sections.above.map((s) => s.key)).toEqual(['grandparents', 'parents']);
    expect(sections.above[0].viaPersonId).toBe('mum');
  });
  it('family below, skipping empty groups', () => {
    expect(sections.below.map((s) => s.key)).toEqual(['partners', 'siblings']);
  });
  it('two tiles to a row', () => {
    const siblings = sections.below[1];
    expect(siblings.rows.map((r) => r.length)).toEqual([2, 1]);
  });
  it('someone with no family shows no sections', () => {
    const empty = focusSections(focusView({ persons: [{ id: 'a' }], unions: [], links: [] }, 'a'));
    expect(empty.above).toEqual([]);
    expect(empty.below).toEqual([]);
  });
});

describe('close family on the person card', () => {
  const view = focusView(graphFromApi(api), 'me');
  it('partner first, then parents, then siblings', () => {
    const ids = closeFamily(view);
    expect(ids[0]).toBe('wife');
    expect(ids.slice(1, 3).sort()).toEqual(['dad', 'mum']);
    expect(ids.includes('sis')).toBe(true);
  });
  it('stops at the limit', () => {
    expect(closeFamily(view, 2).length).toBe(2);
  });
});

describe('words under the name', () => {
  it('a known word', () => {
    expect(relationText({ label: 'Mama', source: 'ai' })).toEqual({ kind: 'word', word: 'Mama' });
  });
  it('a question when elder or younger is not known', () => {
    const text = relationText({ label: 'Akka / Thangai', source: 'ask', ask: [{ term: 'Akka' }, { term: 'Thangai' }] });
    expect(text).toEqual({ kind: 'ask', elder: 'Akka', younger: 'Thangai' });
  });
  it('nothing in names-only mode', () => {
    expect(relationText(undefined)).toEqual({ kind: 'none' });
  });
});

describe('pan and zoom', () => {
  const layout = layoutLineTree(graphFromApi(api), { focusId: 'me' });
  const screen = { width: 390, height: 600 };
  const me = layout.cards.find((c) => c.personId === 'me' && !c.ghost);

  it('jump to me puts the card in the middle', () => {
    const view = centerOn({ x: me?.x ?? 0, y: me?.y ?? 0 }, screen);
    expect(toScreen(view, { x: me?.x ?? 0, y: me?.y ?? 0 })).toEqual({ x: 195, y: 300 });
  });
  it('zoom keeps the point under the fingers still', () => {
    const view = { offsetX: 30, offsetY: 40, scale: 1 };
    const anchor = { x: 100, y: 200 };
    const before = { x: (anchor.x - view.offsetX) / view.scale, y: (anchor.y - view.offsetY) / view.scale };
    const zoomed = zoomAround(view, 1.5, anchor);
    expect(zoomed.scale).toBe(1.5);
    expect(toScreen(zoomed, before)).toEqual(anchor);
  });
  it('zoom stops at the limits', () => {
    expect(zoomAround({ offsetX: 0, offsetY: 0, scale: 1 }, 100, { x: 0, y: 0 }).scale).toBe(2);
    expect(zoomAround({ offsetX: 0, offsetY: 0, scale: 1 }, 0.001, { x: 0, y: 0 }).scale).toBe(0.4);
  });
  it('the tree cannot be dragged off the screen', () => {
    const away = clampView({ offsetX: 99999, offsetY: -99999, scale: 1 }, layout, screen);
    expect(away.offsetX).toBe(310);
    expect(away.offsetY).toBe(80 - layout.height);
  });
  it('the window matches what is on screen', () => {
    const win = visibleWindow({ offsetX: -100, offsetY: -50, scale: 2 }, screen);
    expect(win).toEqual({ x: 50, y: 25, w: 195, h: 300 });
  });
  it('lines off screen are not drawn', () => {
    const lines: TreeLine[] = [{ kind: 'child', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, { kind: 'child', points: [{ x: 5000, y: 0 }, { x: 5010, y: 0 }] }];
    expect(linesInView(lines, { x: 0, y: 0, w: 100, h: 100 }, 0).length).toBe(1);
  });
  it('pinch distance', () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
