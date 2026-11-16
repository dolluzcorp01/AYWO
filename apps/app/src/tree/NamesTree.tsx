// 'Names only' classic line tree (wireframe A9). Drag to move, pinch to zoom. Only what is on screen is drawn (LLD L7).
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
import { PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
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

interface Props {
  /** Family and outsiders use the same tree; outsider data has names and photos only. */
  data: ApiTree<{ id: string; name: string; nameUnknown: boolean; photoUrl: string | null }>;
  viewerId: string | null;
  onOpenPerson: (personId: string) => void;
  /** Room to leave at the bottom for the floating tab bar. */
  bottomSpace?: number;
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
  const [view, setView] = useState<ViewState | null>(null);

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
    if (card) setView(clampView(centerOn(card, viewport, scale), layout, viewport));
  }

  // First look: you in the middle.
  useEffect(() => {
    if (viewport && !view) centreOnPerson(viewerId);
  }, [viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // The gesture handlers live for the whole screen, so they read the latest values from here.
  const latest = useRef({ view, viewport, layout });
  latest.current = { view, viewport, layout };
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
        const current = latest.current.view;
        if (!current) return;
        measureOrigin();
        const touches = touchPoints(e, origin.current);
        gesture.current = { start: current, pinch: touches.length > 1 ? pinchDistance(touches[0], touches[1]) : 0 };
      },
      onPanResponderMove: (e, g) => {
        const now = gesture.current;
        const { viewport: vp, layout: lay, view: current } = latest.current;
        if (!now || !vp || !current) return;
        const touches = touchPoints(e, origin.current);
        if (touches.length > 1) {
          const distance = pinchDistance(touches[0], touches[1]);
          if (now.pinch > 0 && distance > 0) {
            const mid = { x: (touches[0].x + touches[1].x) / 2, y: (touches[0].y + touches[1].y) / 2 };
            setView(clampView(zoomAround(current, distance / now.pinch, mid), lay, vp));
          }
          now.pinch = distance;
          // Whatever follows a pinch starts moving from where the pinch ended.
          now.start = { ...current, offsetX: current.offsetX - g.dx, offsetY: current.offsetY - g.dy };
          return;
        }
        setView(clampView({ ...now.start, offsetX: now.start.offsetX + g.dx, offsetY: now.start.offsetY + g.dy }, lay, vp));
      },
      onPanResponderRelease: () => {
        gesture.current = null;
      },
      onPanResponderTerminate: () => {
        gesture.current = null;
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
      const { view: current, viewport: vp, layout: lay } = latest.current;
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
        setView(clampView({ ...current, offsetX: current.offsetX - dx, offsetY: current.offsetY - dy }, lay, vp));
        return;
      }
      const delta = event.deltaY * unit;
      const factor = Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.01);
      const at = { x: event.clientX - box.left, y: event.clientY - box.top };
      setView(clampView(zoomAround(current, factor, at), lay, vp));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  function zoomBy(factor: number) {
    if (!view || !viewport) return;
    const middle = { x: viewport.width / 2, y: viewport.height / 2 };
    setView(clampView(zoomAround(view, factor, middle), layout, viewport));
  }

  const onScreen = view && viewport ? visibleWindow(view, viewport) : null;
  const cards = onScreen ? cardsInView(layout, onScreen.x, onScreen.y, onScreen.w, onScreen.h) : [];
  const lines = onScreen ? linesInView(layout.lines, onScreen) : [];

  return (
    <View ref={canvas} collapsable={false} style={[styles.canvas, { marginBottom: bottomSpace }]} onLayout={onLayout} {...panResponder.panHandlers}>
      {view && viewport ? (
        <>
          <Svg width={viewport.width} height={viewport.height} style={StyleSheet.absoluteFill} pointerEvents="none">
            {lines.map((line, i) => (
              <Polyline
                key={`${line.kind}-${i}`}
                points={line.points.map((p) => toScreen(view, p)).map((p) => `${p.x},${p.y}`).join(' ')}
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
            const at = toScreen(view, card);
            const isMe = card.personId === viewerId && !card.ghost;
            return (
              <View
                key={`${card.personId}-${card.ghost ? 'ghost' : 'real'}`}
                style={[
                  styles.card,
                  card.hiddenChildren > 0 && styles.cardWithMore,
                  {
                    left: at.x - CARD_WIDTH / 2,
                    top: at.y - AVATAR / 2,
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
