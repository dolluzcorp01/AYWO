// Pan and zoom for the line tree. Plain arithmetic, so it is the same on Android, iOS and web.
import type { Point, TreeLayout, TreeLine } from './line-tree.ts';

export interface Viewport {
  width: number;
  height: number;
}
/** A tree point (x, y) appears on screen at (x * scale + offsetX, y * scale + offsetY). */
export interface ViewState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2;
const KEEP_VISIBLE = 80;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toScreen(view: ViewState, point: Point): Point {
  return { x: point.x * view.scale + view.offsetX, y: point.y * view.scale + view.offsetY };
}

/** 'Jump to me': puts this point in the middle of the screen. */
export function centerOn(point: Point, viewport: Viewport, scale = 1): ViewState {
  const s = clampScale(scale);
  return { scale: s, offsetX: viewport.width / 2 - point.x * s, offsetY: viewport.height / 2 - point.y * s };
}

/** Zooms while the point under the fingers stays where it is. */
export function zoomAround(view: ViewState, factor: number, anchor: Point): ViewState {
  const scale = clampScale(view.scale * factor);
  const applied = scale / view.scale;
  return {
    scale,
    offsetX: anchor.x - (anchor.x - view.offsetX) * applied,
    offsetY: anchor.y - (anchor.y - view.offsetY) * applied,
  };
}

/** The tree can never be dragged fully off the screen. */
export function clampView(view: ViewState, layout: TreeLayout, viewport: Viewport): ViewState {
  const right = layout.width * view.scale;
  const bottom = layout.height * view.scale;
  return {
    scale: view.scale,
    offsetX: Math.min(viewport.width - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - right, view.offsetX)),
    offsetY: Math.min(viewport.height - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - bottom, view.offsetY)),
  };
}

export interface TreeWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the tree currently on screen, in tree coordinates. */
export function visibleWindow(view: ViewState, viewport: Viewport): TreeWindow {
  return {
    x: -view.offsetX / view.scale,
    y: -view.offsetY / view.scale,
    w: viewport.width / view.scale,
    h: viewport.height / view.scale,
  };
}

/** Lines touching the window. A line stays while any part of its bounding box is on screen. */
export function linesInView(lines: TreeLine[], win: TreeWindow, margin = 120): TreeLine[] {
  return lines.filter((line) => {
    const xs = line.points.map((p) => p.x);
    const ys = line.points.map((p) => p.y);
    return (
      Math.max(...xs) >= win.x - margin &&
      Math.min(...xs) <= win.x + win.w + margin &&
      Math.max(...ys) >= win.y - margin &&
      Math.min(...ys) <= win.y + win.h + margin
    );
  });
}

export function pinchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
