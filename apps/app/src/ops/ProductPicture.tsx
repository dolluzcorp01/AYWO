// What the shop sells. Staff choose the photographs in Admin > Offers > Shop pictures. Until they add one, a drawing
// in the app's own colours stands in (a framed family tree poster, a family book), so the card is never empty.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text } from '@/components/Text';
import { colors, fonts, radius } from '@/theme/tokens';
import type { Product } from './types';
import { useProductWords } from '@/ops/productWords';

/** A small family tree: two grandparents, two parents, three children, joined by lines. Drawn inside w x h at x, y. */
function MiniTree({ x, y, w, h, line, dots }: { x: number; y: number; w: number; h: number; line: string; dots: string[] }) {
  const r = Math.min(w, h) / 9;
  const rows = [
    [0.35, 0.65],
    [0.3, 0.7],
    [0.18, 0.5, 0.82],
  ];
  const at = (row: number, i: number) => ({ cx: x + rows[row][i] * w, cy: y + r + (row * (h - 2 * r)) / 2 });
  const top = at(0, 0).cy;
  const mid = at(1, 0).cy;
  const low = at(2, 0).cy;
  const centre = x + w / 2;
  return (
    <>
      <Path
        d={`M${at(0, 0).cx} ${top} H${at(0, 1).cx} M${centre} ${top} V${mid} M${at(1, 0).cx} ${mid} H${at(1, 1).cx} M${centre} ${mid} V${(mid + low) / 2} M${at(2, 0).cx} ${(mid + low) / 2} H${at(2, 2).cx} M${at(2, 0).cx} ${(mid + low) / 2} V${low} M${at(2, 1).cx} ${(mid + low) / 2} V${low} M${at(2, 2).cx} ${(mid + low) / 2} V${low}`}
        stroke={line}
        strokeWidth={1.6}
        fill="none"
      />
      {rows.flatMap((row, ri) => row.map((_, i) => <Circle key={`${ri}-${i}`} {...at(ri, i)} r={r} fill={dots[(ri * 2 + i) % dots.length]} />))}
    </>
  );
}

const DOTS = [colors.logoPurple, colors.logoOrange, colors.logoIndigo, colors.logoYellow];

/** The product's picture: the photograph staff chose, or the drawing. It fills the width it is given and keeps its shape. */
export function ProductPicture({ product, image }: { product: Product; image?: string | null }) {
  if (image) {
    return (
      <View style={styles.picture}>
        <Image source={{ uri: image }} resizeMode="cover" accessibilityIgnoresInvertColors style={styles.photo} />
      </View>
    );
  }
  return (
    <View style={styles.picture}>
      <Svg width="100%" height="100%" viewBox="0 0 200 130" preserveAspectRatio="xMidYMid meet">
        {product === 'family_book' ? (
          <>
            {/* The pages, seen at the edge, then the cover with its spine. */}
            <Rect x={62} y={19} width={88} height={98} rx={4} fill={colors.card} stroke={colors.line} />
            <Rect x={58} y={15} width={88} height={98} rx={4} fill={colors.card} stroke={colors.line} />
            <Rect x={52} y={11} width={90} height={100} rx={5} fill={colors.logoIndigo} />
            <Rect x={52} y={11} width={12} height={100} rx={5} fill={colors.text} />
            <Rect x={74} y={22} width={58} height={7} rx={3.5} fill={colors.logoYellow} />
            <MiniTree x={74} y={38} w={58} h={60} line={colors.onNeon} dots={[colors.logoYellow, colors.logoOrange, colors.card, colors.onNeon]} />
          </>
        ) : (
          <>
            {/* A framed poster on a wall, with a soft shadow under it. */}
            <Rect x={47} y={13} width={110} height={108} rx={4} fill={colors.line} />
            <Rect x={44} y={9} width={110} height={108} rx={4} fill={colors.card} stroke={colors.logoIndigo} strokeWidth={4} />
            <Rect x={74} y={20} width={50} height={6} rx={3} fill={colors.logoIndigo} />
            <MiniTree x={58} y={34} w={82} h={72} line={colors.line} dots={DOTS} />
          </>
        )}
      </Svg>
    </View>
  );
}

/** A product as a card to tap: its picture, its name and, when known, its price. `on` marks the chosen one. */
export function ProductCard({ product, price, image, on, onPress }: { product: Product; price?: string; image?: string | null; on?: boolean; onPress: () => void }) {
  const words = useProductWords();
  const name = words.name(product);
  return (
    <Pressable
      accessibilityRole={on === undefined ? 'button' : 'radio'}
      accessibilityState={on === undefined ? undefined : { checked: on }}
      accessibilityLabel={price ? `${name}, ${price}` : name}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [styles.card, on && styles.cardOn, hovered && !on && styles.cardHover]}
    >
      <ProductPicture product={product} image={image} />
      <View style={styles.words}>
        <Text style={styles.name}>{name}</Text>
        {price ? <Text style={styles.price}>{price}</Text> : null}
        <Text style={styles.about}>{words.about(product)}</Text>
      </View>
    </Pressable>
  );
}

/** Two or more product cards side by side; on a narrow phone they stack. */
export function ProductRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 0,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    overflow: 'hidden',
    cursor: 'pointer',
  },
  cardOn: { borderColor: colors.logoIndigo },
  cardHover: { borderColor: colors.line },
  picture: { width: '100%', aspectRatio: 200 / 130, backgroundColor: colors.tint },
  photo: { width: '100%', height: '100%' },
  words: { padding: 14, gap: 3 },
  name: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 16 },
  price: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 15 },
  about: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
});
