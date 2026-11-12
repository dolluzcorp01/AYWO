// 'My view', drawn (Warm Daylight): grandparents and parents above, the centre person with brothers and sisters
// beside them and partner on the right, children below, joined by lines. Tap anyone to bring them to the centre;
// tap the centre card to open it. Wide families scroll sideways.
import { focusView, graphFromApi, relationText } from '@aywo/layout';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Avatar } from '@/components/Avatar';
import { TAB_BAR_SPACE } from '@/components/TabBar';
import { DESKTOP_MIN } from '@/components/WebFrame';
import { firstName } from '@/lib/account';
import { Text } from '@/components/Text';
import { colors, fonts, minTapSize, radius, shadows } from '@/theme/tokens';
import type { TreeNode, TreeViewAnswer } from './useTreeView';

interface Props {
  data: TreeViewAnswer;
  viewerId: string;
  focusId: string;
  /** Looking through someone else's eyes, so the centre card is not 'You'. */
  seeingAs: boolean;
  onFocus: (personId: string) => void;
  /** Tapping the centre card opens the person (D1). */
  onOpenPerson: (personId: string) => void;
  /** A card showing 'Akka or Thangai?' goes straight to the question (D4). */
  onAskWord: (personId: string) => void;
  onShowAll: () => void;
  /** '+ Add' under the centre card (E1). Left out for those who cannot change the tree. */
  onAdd?: (personId: string) => void;
  /** Shown under the add button, such as the "Add your family" card. */
  children?: ReactNode;
}

const CARD_W = 92;
const CARD_H = 100;
const FOCUS_W = 118;
const FOCUS_H = 122;
const GAP = 10;
const PARTNER_GAP = 20;
/** Stands for the brothers and sisters, or children, that do not fit; tapping it shows them all. */
export const MORE_SIBLINGS = 'more:siblings';
export const MORE_CHILDREN = 'more:children';
const ROW_GAP = 46;
const EDGE = 16;
const MAX_ROW = 6;

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  focus: boolean;
}

function rowWidth(ids: string[], focusId: string | null, partnerCount = 0): number {
  const widths = ids.map((id) => (id === focusId ? FOCUS_W : CARD_W));
  return widths.reduce((a, b) => a + b, 0) + Math.max(ids.length - 1, 0) * GAP + (partnerCount ? PARTNER_GAP - GAP : 0);
}

/** Places every card and returns the lines between them. Pure layout, no drawing. */
function fitting(ids: string[], room: number, more: string, all: boolean): string[] {
  if (all || ids.length === 0) return ids.slice(0, all ? 50 : MAX_ROW);
  const fit = Math.max(Math.floor((room + GAP) / (CARD_W + GAP)), 1);
  if (ids.length <= fit) return ids;
  // The nearest ones stay; the rest wait behind '+N'. Brothers and sisters nearest are the last in the list.
  return more === MORE_SIBLINGS ? [more, ...ids.slice(ids.length - (fit - 1))] : [...ids.slice(0, fit - 1), more];
}

function layout(view: ReturnType<typeof focusView>, width: number, expanded: { siblings: boolean; children: boolean }) {
  const grand = view.grandparents.flatMap((g) => g.ids).slice(0, 4);
  const parents = view.parents.slice(0, 2);
  const partners = view.partners.slice(0, 1);
  const room = width - 2 * EDGE;
  const besideFocus = room - FOCUS_W - (partners.length ? PARTNER_GAP + CARD_W : 0) - GAP;
  const siblings = fitting(view.siblings, besideFocus, MORE_SIBLINGS, expanded.siblings);
  const children = fitting(view.children, room, MORE_CHILDREN, expanded.children);
  // Everyone keeps their birth-order place: the focus person is drawn bigger where they stand, not moved to the end.
  // A partner sits right beside them; '+N' (hidden brothers and sisters) stays at the start.
  const shown = new Set(siblings);
  const inOrder = view.siblingRow.filter((id) => id === view.focusId || shown.has(id));
  const bloodRow = [...(shown.has(MORE_SIBLINGS) ? [MORE_SIBLINGS] : []), ...inOrder];
  const middle = bloodRow.flatMap((id) => (id === view.focusId ? [id, ...partners] : [id]));

  const rows: { ids: string[]; y: number; h: number }[] = [];
  let y = EDGE;
  for (const ids of [grand, parents, middle, children]) {
    const h = ids.includes(view.focusId) ? FOCUS_H : CARD_H;
    rows.push({ ids, y, h });
    if (ids.length) y += h + ROW_GAP;
  }
  const height = y - ROW_GAP + EDGE + 8;

  const placed = new Map<string, Placed>();
  const put = (ids: string[], top: number, centre: number) => {
    const total = rowWidth(ids, view.focusId, ids === middle ? partners.length : 0);
    let x = centre - total / 2;
    ids.forEach((id) => {
      const focus = id === view.focusId;
      const w = focus ? FOCUS_W : CARD_W;
      const h = focus ? FOCUS_H : CARD_H;
      if (ids === middle && partners.includes(id)) x += PARTNER_GAP - GAP;
      placed.set(id, { id, x, y: top + (ids === middle ? (rows[2].h - h) / 2 : 0), w, h, focus });
      x += w + GAP;
    });
  };

  // The middle row is centred; parents sit over the brothers and sisters, children under the couple.
  put(middle, rows[2].y, width / 2);
  const cx = (id: string) => {
    const p = placed.get(id) as Placed;
    return p.x + p.w / 2;
  };
  const blood = bloodRow;
  const bloodMid = (cx(blood[0]) + cx(blood[blood.length - 1])) / 2;
  const coupleMid = partners.length ? (cx(view.focusId) + cx(partners[0])) / 2 : cx(view.focusId);
  if (parents.length) put(parents, rows[1].y, bloodMid);
  if (grand.length) put(grand, rows[0].y, parents.length ? (cx(parents[0]) + cx(parents[parents.length - 1])) / 2 : bloodMid);
  if (children.length) put(children, rows[3].y, coupleMid);

  // Nothing may hang off the left edge; a wide family makes the canvas wider instead.
  const all = [...placed.values()];
  const shift = Math.max(EDGE - Math.min(...all.map((p) => p.x)), 0);
  all.forEach((p) => {
    p.x += shift;
  });
  const canvasWidth = Math.max(width, Math.max(...all.map((p) => p.x + p.w)) + EDGE);

  const paths: string[] = [];
  const box = (id: string) => placed.get(id) as Placed;
  const centreX = (id: string) => box(id).x + box(id).w / 2;
  const bar = (ids: string[], fromX: number, fromY: number) => {
    if (!ids.length) return;
    const top = Math.min(...ids.map((id) => box(id).y));
    const barY = top - ROW_GAP / 2;
    const xs = ids.map(centreX);
    paths.push(`M${fromX} ${fromY} V${barY}`);
    paths.push(`M${Math.min(...xs, fromX)} ${barY} H${Math.max(...xs, fromX)}`);
    ids.forEach((id) => paths.push(`M${centreX(id)} ${barY} V${box(id).y}`));
  };
  const pairLine = (a: string, b: string) => {
    const left = box(a).x < box(b).x ? box(a) : box(b);
    const right = left === box(a) ? box(b) : box(a);
    const yMid = Math.min(left.y + left.h / 2, right.y + right.h / 2);
    paths.push(`M${left.x + left.w} ${yMid} H${right.x}`);
    return (left.x + left.w + right.x) / 2;
  };

  if (grand.length && parents.length) {
    const gMid = (centreX(grand[0]) + centreX(grand[grand.length - 1])) / 2;
    const gBottom = Math.max(...grand.map((id) => box(id).y + box(id).h));
    bar(parents, gMid, gBottom);
  }
  if (parents.length) {
    const mid = parents.length === 2 ? pairLine(parents[0], parents[1]) : centreX(parents[0]);
    const startY = parents.length === 2 ? box(parents[0]).y + box(parents[0]).h / 2 : box(parents[0]).y + box(parents[0]).h;
    bar(blood, mid, startY);
  }
  if (partners.length) pairLine(view.focusId, partners[0]);
  if (children.length) {
    const fromX = partners.length ? (box(view.focusId).x + box(view.focusId).w + box(partners[0]).x) / 2 : centreX(view.focusId);
    const fromY = partners.length ? box(view.focusId).y + box(view.focusId).h / 2 : box(view.focusId).y + box(view.focusId).h;
    bar(children, fromX, fromY);
  }

  return { placed: [...placed.values()], paths, width: canvasWidth, height };
}

export function MyView({ data, viewerId, focusId, seeingAs, onFocus, onOpenPerson, onAskWord, onShowAll, onAdd, children }: Props) {
  const { t } = useTranslation();
  // A first guess from the window (minus the side menu on a computer), corrected once the screen is measured.
  const windowWidth = useWindowDimensions().width;
  const [width, setWidth] = useState(() => Math.min(windowWidth >= DESKTOP_MIN ? windowWidth - 256 - 40 : windowWidth, 1240));
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const view = useMemo(() => focusView(graphFromApi(data), focusId), [data, focusId]);
  const [expanded, setExpanded] = useState({ siblings: false, children: false });
  useEffect(() => setExpanded({ siblings: false, children: false }), [focusId]);
  const drawn = useMemo(() => layout(view, width, expanded), [view, width, expanded]);
  const sideways = useRef<ComponentRef<typeof ScrollView>>(null);

  // A wide family scrolls sideways; it always opens with the centre person in the middle of the screen.
  // Done once the content has its size, because a scroll asked for earlier is ignored.
  const centreOnFocus = () => {
    const centre = drawn.placed.find((p) => p.focus);
    if (!centre) return;
    sideways.current?.scrollTo({ x: Math.max(centre.x + centre.w / 2 - width / 2, 0), animated: false });
  };
  useEffect(centreOnFocus, [drawn, width]);

  function relationOf(id: string): { text: string; ask: boolean } | null {
    const r = relationText(data.labels[id]);
    if (r.kind === 'word') return { text: r.word, ask: false };
    if (r.kind === 'ask') return { text: t('tree.askWord', { elder: r.elder, younger: r.younger }), ask: true };
    return null;
  }

  function nameOf(node: TreeNode | undefined): string {
    if (!node) return '';
    return node.nameUnknown ? t('tree.nameNotKnown') : node.name;
  }

  const focus = byId.get(focusId);
  if (!focus) return null;
  const isViewer = focusId === viewerId;
  const centreWord = isViewer ? (seeingAs ? t('tree.seenFromHere') : t('tree.you')) : relationOf(focusId)?.text;
  const shown = drawn.placed.length;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(e.nativeEvent.layout.width, 320))} />
      <ScrollView ref={sideways} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width: drawn.width }} onContentSizeChange={centreOnFocus}>
        <View style={{ width: drawn.width, height: drawn.height }}>
          <Svg width={drawn.width} height={drawn.height} style={StyleSheet.absoluteFill}>
            {drawn.paths.map((d, i) => (
              <Path key={i} d={d} stroke={colors.line} strokeWidth={2} strokeLinecap="round" fill="none" />
            ))}
          </Svg>
          {drawn.placed.map((p) => {
            if (p.id === MORE_SIBLINGS || p.id === MORE_CHILDREN) {
              const hidden = p.id === MORE_SIBLINGS ? view.siblings.length - drawn.placed.filter((q) => view.siblings.includes(q.id)).length : view.children.length - drawn.placed.filter((q) => view.children.includes(q.id)).length;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  onPress={() => setExpanded((e) => (p.id === MORE_SIBLINGS ? { ...e, siblings: true } : { ...e, children: true }))}
                  style={[styles.card, styles.moreCard, { left: p.x, top: p.y, width: p.w, height: p.h }]}
                >
                  <Text style={styles.moreCount}>+{hidden}</Text>
                  <Text style={styles.word}>{p.id === MORE_SIBLINGS ? t('tree.moreSiblings') : t('tree.moreChildren')}</Text>
                </Pressable>
              );
            }
            const node = byId.get(p.id);
            if (!node) return null;
            const relation = p.focus ? null : relationOf(p.id);
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={[nameOf(node), p.focus ? centreWord : relation?.text].filter(Boolean).join(', ')}
                onPress={() => (p.focus ? onOpenPerson(p.id) : relation?.ask ? onAskWord(p.id) : onFocus(p.id))}
                style={[styles.card, p.focus && styles.focusCard, { left: p.x, top: p.y, width: p.w, height: p.h }]}
              >
                <Avatar personId={node.id} size={p.focus ? 58 : 42} photoUrl={node.photoUrl} nameUnknown={node.nameUnknown} name={node.name} ring={p.focus} />
                <Text style={[styles.name, p.focus && styles.focusName]} numberOfLines={1}>{p.focus || node.nameUnknown ? nameOf(node) : (firstName(node.name) ?? nameOf(node))}</Text>
                {p.focus ? (
                  centreWord ? <Text style={styles.focusWord} numberOfLines={1}>{centreWord}</Text> : null
                ) : relation ? (
                  <Text style={[styles.word, relation.ask && styles.ask]} numberOfLines={1}>{relation.text}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        {onAdd ? (
          <Pressable accessibilityRole="button" onPress={() => onAdd(focus.id)} style={styles.addButton}>
            <Text style={styles.addText}>{t('tree.addTo', { name: nameOf(focus) })}</Text>
          </Pressable>
        ) : null}
        {children}
        {!isViewer ? (
          <Pressable accessibilityRole="button" onPress={() => onFocus(viewerId)} style={styles.link}>
            <Text style={styles.linkText}>{seeingAs ? t('tree.backToThem') : t('tree.backToMe')}</Text>
          </Pressable>
        ) : null}
        {data.nodes.length > shown ? (
          <Pressable accessibilityRole="button" onPress={onShowAll} style={styles.link}>
            <Text style={styles.linkText}>{t('tree.showAll', { count: data.nodes.length })}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: TAB_BAR_SPACE, gap: 4 },
  card: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  moreCard: { borderStyle: 'dashed', borderColor: colors.dashed, backgroundColor: colors.background },
  moreCount: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 22 },
  focusCard: { borderRadius: radius.card + 2, borderColor: '#F8D9C2', ...shadows.raised },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 13, maxWidth: '100%' },
  focusName: { fontSize: 15, fontFamily: fonts.extrabold },
  word: { color: colors.relation, fontFamily: fonts.bold, fontSize: 12 },
  ask: { color: colors.ask },
  focusWord: { color: colors.logoOrange, fontFamily: fonts.extrabold, fontSize: 12 },
  actions: { alignItems: 'center', gap: 2, paddingHorizontal: 16 },
  addButton: {
    minHeight: minTapSize,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  addText: { color: colors.logoIndigo, fontFamily: fonts.bold, fontSize: 14 },
  link: { minHeight: minTapSize, justifyContent: 'center', paddingHorizontal: 16 },
  linkText: { color: colors.relation, fontFamily: fonts.bold, fontSize: 14 },
});
