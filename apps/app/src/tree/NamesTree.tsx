// 'Names only' classic line tree (wireframe A9). Drag to move, pinch to zoom. Only what is on screen is drawn (LLD L7).
// A drag slides one layer and draws nothing again until the finger has gone a good way: drawing every card again
// for every small move made the tree stutter on a phone.
import {
  cardsInView,
  centerOn,
  clampView,
  graphFromApi,
  layoutLineTree,
  linesInView,
  pinchDistance,
  toScreen,
  visibleWindow,
  zoomAround,
} from '@aywo/layout';
import type { Point, Viewport, ViewState } from '@aywo/layout';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { TAB_BAR_SPACE } from '@/components/TabBar';
import { colors, fonts, minTapSize } from '@/theme/tokens';
import type { ApiTree } from '@aywo/layout';

const CARD_WIDTH = 84;
const AVATAR = 52;
const ROW_HEIGHT = 124;
const COLLAPSE_BEYOND = 3;
const ZOOM_STEP = 1.25;
/** The "more below" pill is drawn 28 high; its tap area is a full minTapSize, reaching this far above and below it. */
const MORE_HEIGHT = 28;
const MORE_REACH = (minTapSize - MORE_HEIGHT) / 2;
/** How much of the tree is drawn beyond each edge of the screen, so a drag has something to slide in. */
const OVERSCAN = 280;
/** Room around the tree inside its layer, for the cards and names that reach past the outermost people. */
const LAYER_PAD = 240;
/** A drag draws the tree again once it has used up this much of that extra. */
const REDRAW_AFTER = 180;
/** A finger lifted while moving faster than this (pixels a millisecond) lets the tree glide on, like any list. */
const GLIDE_FROM = 0.5;
/** The glide is short and its speed is capped: a family tree is small, and a long glide threw it against its edge. */
const GLIDE_TOP_SPEED = 1.2;
const GLIDE_SLOWDOWN = 0.988;

interface Props {
  /** Family and outsiders use the same tree; outsider data has names and photos only. */
  data: ApiTree<{ id: string; name: string; nameUnknown: boolean; photoUrl: string | null }>;
  viewerId: string | null;
  onOpenPerson: (personId: string) => void;
  /** Room to leave at the bottom for the floating tab bar. */
  bottomSpace?: number;
}

/**
 * Where the tree may be dragged to. The middle of the screen always stays over the tree, so a fast drag can push
 * the family to one side but never off the screen, where it looked as if the tree had gone.
 */
function holdTree(view: ViewState, layout: Parameters<typeof clampView>[1], viewport: Viewport): ViewState {
  const kept = clampView(view, layout, viewport);
  const midX = viewport.width / 2;
  const midY = viewport.height / 2;
  return {
    scale: kept.scale,
    offsetX: Math.min(midX, Math.max(midX - layout.width * kept.scale, kept.offsetX)),
    offsetY: Math.min(midY, Math.max(midY - layout.height * kept.scale, kept.offsetY)),
  };
}

/**
 * Fingers in the canvas's own coordinates, which is what zoomAround works in. A touch reports where it is on the
 * whole page, so the canvas's place on the page (under the header, beside the side menu on a computer) comes off.
 */
function touchPoints(event: GestureResponderEvent, origin: Point): Point[] {
  return event.nativeEvent.touches.map((t) => ({ x: t.pageX - origin.x, y: t.pageY - origin.y }));
}

export function NamesTree({ data, viewerId, onOpenPerson, bottomSpace = TAB_BAR_SPACE - 18 }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  // `view` is what was last drawn. `live` is where the tree is right now, which runs ahead of it during a drag.
  const [view, setDrawn] = useState<ViewState | null>(null);
  const live = useRef<ViewState | null>(null);
  const slide = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  /** Move the tree and draw it again. */
  const setView = (next: ViewState) => {
    if (!Number.isFinite(next.offsetX) || !Number.isFinite(next.offsetY) || !Number.isFinite(next.scale)) return;
    live.current = next;
    slide.setValue({ x: next.offsetX, y: next.offsetY });
    setDrawn(next);
  };
  /** Move the tree without drawing it again, until it has gone far enough to need more of the tree. */
  const slideTo = (next: ViewState, drawn: ViewState) => {
    if (!Number.isFinite(next.offsetX) || !Number.isFinite(next.offsetY)) return;
    live.current = next;
    slide.setValue({ x: next.offsetX, y: next.offsetY });
    if (Math.abs(next.offsetX - drawn.offsetX) > REDRAW_AFTER || Math.abs(next.offsetY - drawn.offsetY) > REDRAW_AFTER) setDrawn(next);
  };

  const layout = useMemo(
    () =>
      layoutLineTree(graphFromApi(data), {
        focusId: viewerId,
        cardWidth: CARD_WIDTH,
        rowHeight: ROW_HEIGHT,
        collapseBeyond: viewerId ? COLLAPSE_BEYOND : null,
        expanded,
      }),
    [data, viewerId, expanded],
  );
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  function centreOnPerson(personId: string | null, scale = 1) {
    if (!viewport) return;
    const card = layout.cards.find((c) => c.personId === personId && !c.ghost) ?? layout.cards[0];
    if (card) setView(holdTree(centerOn(card, viewport, scale), layout, viewport));
  }

  // First look: you in the middle.
  useEffect(() => {
    if (viewport && !view) centreOnPerson(viewerId);
  }, [viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // The gesture handlers live for the whole screen, so they read the latest values from here.
  // After a quick flick the tree glides on by itself. While it does, each step is kept inside the edges of the
  // tree and draws more of it when needed; reaching an edge ends the glide.
  const gliding = useRef(false);
  useEffect(() => {
    const id = slide.addListener(({ x, y }) => {
      const { view: drawn, viewport: vp, layout: lay } = latest.current;
      if (!gliding.current || !live.current || !drawn || !vp) return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        slide.stopAnimation();
        return;
      }
      const next = holdTree({ scale: live.current.scale, offsetX: x, offsetY: y }, lay, vp);
      live.current = next;
      if (next.offsetX !== x || next.offsetY !== y) {
        slide.stopAnimation();
        return;
      }
      if (Math.abs(x - drawn.offsetX) > REDRAW_AFTER || Math.abs(y - drawn.offsetY) > REDRAW_AFTER) setDrawn(next);
    });
    return () => slide.removeListener(id);
  }, [slide]);
  const settle = () => {
    gliding.current = false;
    if (live.current) latest.current.setView(live.current);
  };

  const latest = useRef({ view, viewport, layout, setView, slideTo });
  latest.current = { view, viewport, layout, setView, slideTo };
  const gesture = useRef<{ start: ViewState; pinch: number } | null>(null);
  // Where the canvas sits on the page, measured when it is laid out and again as each gesture starts.
  const canvas = useRef<ComponentRef<typeof View>>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const measureOrigin = () => {
    canvas.current?.measure((_x: number, _y: number, _width: number, _height: number, pageX: number, pageY: number) => {
      if (Number.isFinite(pageX) && Number.isFinite(pageY)) origin.current = { x: pageX, y: pageY };
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      // Taps fall through to the cards. Only a real drag or a second finger takes over.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4 || g.numberActiveTouches > 1,
      onPanResponderGrant: (e) => {
        // A finger on a gliding tree stops it there.
        gliding.current = false;
        slide.stopAnimation();
        const current = live.current;
        if (!current) return;
        measureOrigin();
        const touches = touchPoints(e, origin.current);
        gesture.current = { start: current, pinch: touches.length > 1 ? pinchDistance(touches[0], touches[1]) : 0 };
      },
      onPanResponderMove: (e, g) => {
        const now = gesture.current;
        const { viewport: vp, layout: lay, view: drawn } = latest.current;
        const current = live.current;
        if (!now || !vp || !current || !drawn) return;
        const touches = touchPoints(e, origin.current);
        if (touches.length > 1) {
          const distance = pinchDistance(touches[0], touches[1]);
          if (now.pinch > 0 && distance > 0) {
            const mid = { x: (touches[0].x + touches[1].x) / 2, y: (touches[0].y + touches[1].y) / 2 };
            latest.current.setView(holdTree(zoomAround(current, distance / now.pinch, mid), lay, vp));
          }
          now.pinch = distance;
          // Whatever follows a pinch starts moving from where the pinch ended.
          now.start = { ...current, offsetX: current.offsetX - g.dx, offsetY: current.offsetY - g.dy };
          return;
        }
        latest.current.slideTo(holdTree({ ...now.start, offsetX: now.start.offsetX + g.dx, offsetY: now.start.offsetY + g.dy }, lay, vp), drawn);
      },
      // Draw once more where the finger let go, so the extra around the screen is even on every side again.
      onPanResponderRelease: (_e, g) => {
        gesture.current = null;
        const flick = Math.hypot(g.vx, g.vy);
        if (g.numberActiveTouches > 0 || !Number.isFinite(flick) || flick < GLIDE_FROM) return settle();
        gliding.current = true;
        const keep = Math.min(1, GLIDE_TOP_SPEED / flick);
        Animated.decay(slide, { velocity: { x: g.vx * keep, y: g.vy * keep }, deceleration: GLIDE_SLOWDOWN, useNativeDriver: false }).start(settle);
      },
      onPanResponderTerminate: () => {
        gesture.current = null;
        settle();
      },
    }),
  ).current;

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ width, height });
    measureOrigin();
  }

  // On a computer: the wheel or two fingers on a trackpad move the tree; a pinch, or Ctrl/Cmd + wheel, zooms around the pointer.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // On the web the view is the page element itself.
    const element = canvas.current as unknown as HTMLElement | null;
    if (!element || typeof element.addEventListener !== 'function') return;
    const onWheel = (event: WheelEvent) => {
      const { viewport: vp, layout: lay, setView } = latest.current;
      const current = live.current;
      if (!current || !vp) return;
      // Otherwise the browser scrolls or zooms the whole page instead.
      event.preventDefault();
      const box = element.getBoundingClientRect();
      // Lines (a mouse wheel in some browsers) count as about 16 pixels each.
      const unit = event.deltaMode === 1 ? 16 : 1;
      // Like a map: scrolling moves the tree, and a pinch on the trackpad (which browsers report as a wheel with
      // Ctrl held) or Ctrl/Cmd + wheel zooms. Zooming on every scroll made a laptop's two-finger scroll unusable.
      if (!event.ctrlKey && !event.metaKey) {
        // Shift + wheel moves sideways, for a mouse with one wheel.
        const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
        const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit;
        setView(holdTree({ ...current, offsetX: current.offsetX - dx, offsetY: current.offsetY - dy }, lay, vp));
        return;
      }
      const delta = event.deltaY * unit;
      const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.01);
      const at = { x: event.clientX - box.left, y: event.clientY - box.top };
      setView(holdTree(zoomAround(current, factor, at), lay, vp));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  function zoomBy(factor: number) {
    if (!view || !viewport) return;
    const middle = { x: viewport.width / 2, y: viewport.height / 2 };
    setView(holdTree(zoomAround(view, factor, middle), layout, viewport));
  }

  const onScreen = view && viewport ? visibleWindow(view, viewport) : null;
  // Drawn a little beyond the screen on every side: that is what slides in during a drag.
  const extra = view ? OVERSCAN / view.scale : 0;
  const cards = onScreen ? cardsInView(layout, onScreen.x - extra, onScreen.y - extra, onScreen.w + 2 * extra, onScreen.h + 2 * extra) : [];
  const lines = onScreen ? linesInView(layout.lines, { x: onScreen.x - extra, y: onScreen.y - extra, w: onScreen.w + 2 * extra, h: onScreen.h + 2 * extra }) : [];

  return (
    <View ref={canvas} collapsable={false} style={[styles.canvas, { marginBottom: bottomSpace }]} onLayout={onLayout} {...panResponder.panHandlers}>
      {view && viewport ? (
        <>
          {/*
            One layer the size of the whole tree. Everything in it sits at its own fixed place, and only the layer
            moves, by exactly where the tree is now. Nothing inside depends on how far it has been dragged, so the
            moving layer and what is drawn in it can never disagree. (They did once, and the tree left the screen.)
          */}
          <Animated.View
            style={{
              position: 'absolute',
              left: -LAYER_PAD,
              top: -LAYER_PAD,
              width: layout.width * view.scale + 2 * LAYER_PAD,
              height: layout.height * view.scale + 2 * LAYER_PAD,
              transform: [{ translateX: slide.x }, { translateY: slide.y }],
            }}
          >
          {/* The lines are drawn only for the part near the screen: a picture the size of a big tree would be too heavy. */}
          <Svg
            width={viewport.width + 2 * OVERSCAN}
            height={viewport.height + 2 * OVERSCAN}
            style={{ position: 'absolute', left: LAYER_PAD - view.offsetX - OVERSCAN, top: LAYER_PAD - view.offsetY - OVERSCAN }}
            pointerEvents="none"
          >
            {lines.map((line, i) => (
              <Polyline
                key={`${line.kind}-${i}`}
                points={line.points.map((p) => toScreen(view, p)).map((p) => `${p.x + OVERSCAN},${p.y + OVERSCAN}`).join(' ')}
                fill="none"
                // A gradient stroke vanishes on a perfectly straight line in SVG, so lines use a solid logo colour.
                stroke={line.kind === 'ghost' ? colors.logoOrange : colors.logoPurple}
                strokeOpacity={0.55}
                strokeWidth={2 * view.scale}
                strokeDasharray={line.kind === 'ghost' ? '4 5' : undefined}
              />
            ))}
          </Svg>

          {cards.map((card) => {
            const node = byId.get(card.personId);
            if (!node) return null;
            const isMe = card.personId === viewerId && !card.ghost;
            return (
              <View
                key={`${card.personId}-${card.ghost ? 'ghost' : 'real'}`}
                style={[
                  styles.card,
                  card.hiddenChildren > 0 && styles.cardWithMore,
                  {
                    left: card.x * view.scale - CARD_WIDTH / 2 + LAYER_PAD,
                    top: card.y * view.scale - AVATAR / 2 + LAYER_PAD,
                    transform: [{ scale: view.scale }],
                    transformOrigin: `${CARD_WIDTH / 2}px ${AVATAR / 2}px`,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={node.nameUnknown ? t('tree.nameNotKnown') : node.name}
                  // A ghost takes you to the person's real place in the tree; a real card opens the person.
                  onPress={() => (card.ghost ? centreOnPerson(card.personId, view.scale) : onOpenPerson(card.personId))}
                  style={styles.cardPress}
                >
                  <Avatar
                    personId={node.id}
                    size={AVATAR}
                    photoUrl={node.photoUrl}
                    nameUnknown={node.nameUnknown}
                    ghost={card.ghost}
                    ring={isMe}
                  />
                  <Text style={[styles.name, card.ghost && styles.ghostName]} numberOfLines={2}>
                    {node.nameUnknown ? t('tree.nameNotKnown') : node.name}
                  </Text>
                </Pressable>
                {card.hiddenChildren > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setExpanded([...expanded, card.personId])}
                    style={styles.moreTap}
                  >
                    <View style={styles.more}>
                      <Text style={styles.moreText}>{t('tree.moreBelow', { count: card.hiddenChildren })}</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          </Animated.View>

          <View style={styles.controls}>
            {viewerId ? (
              <Pressable accessibilityRole="button" onPress={() => centreOnPerson(viewerId, view.scale)} style={styles.me}>
                <Text style={styles.controlText}>{t('tree.jumpToMe')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t('tree.zoomIn')} onPress={() => zoomBy(ZOOM_STEP)} style={styles.zoom}>
              <Text style={styles.controlText}>+</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('tree.zoomOut')} onPress={() => zoomBy(1 / ZOOM_STEP)} style={styles.zoom}>
              <Text style={styles.controlText}>-</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  card: { position: 'absolute', width: CARD_WIDTH, alignItems: 'center', gap: 4 },
  cardPress: { width: CARD_WIDTH, alignItems: 'center', gap: 4, minHeight: minTapSize },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 12, lineHeight: 14, textAlign: 'center' },
  ghostName: { color: colors.muted },
  // Room under the card for the lower part of the pill's tap area, so it is inside the card on every platform.
  cardWithMore: { paddingBottom: MORE_REACH },
  // A full-size tap area around the small pill. The margins take the extra height back, so nothing in the tree moves.
  moreTap: { minHeight: minTapSize, minWidth: minTapSize, marginVertical: -MORE_REACH, alignItems: 'center', justifyContent: 'center' },
  more: {
    minHeight: MORE_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  moreText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 11 },
  controls: { position: 'absolute', end: 12, bottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  me: {
    minHeight: minTapSize,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  zoom: {
    width: minTapSize,
    height: minTapSize,
    borderRadius: minTapSize / 2,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 14 },
});
