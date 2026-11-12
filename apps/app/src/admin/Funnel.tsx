// The signup funnel, step by step: how many devices that first opened the app in the window reached each step,
// what share of them that is, and how many were lost since the step before. Below, the same by phone/web and language.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { biggestDrop, share } from '@/admin/funnelMath';
import { Text } from '@/components/Text';
import { colors, fonts, radius } from '@/theme/tokens';

export interface FunnelAnswer {
  days: number;
  steps: { step: string; devices: number }[];
  by_platform: Record<string, number[]>;
  by_lang: Record<string, number[]>;
}

export function Funnel({ data }: { data: FunnelAnswer }) {
  const { t } = useTranslation();
  const counts = data.steps.map((s) => s.devices);
  const first = counts[0] ?? 0;
  const worst = biggestDrop(counts);

  if (first === 0) return <Text style={styles.muted}>{t('admin.funnel.empty')}</Text>;

  const line = (label: string, values: number[]) => (
    <Text key={label} style={styles.splitRow}>
      <Text style={styles.splitLabel}>{label}: </Text>
      {t('admin.funnel.splitLine', {
        opened: values[0] ?? 0,
        verified: share(values[2] ?? 0, values[0] ?? 0),
        tree: share(values[4] ?? 0, values[0] ?? 0),
        five: share(values[6] ?? 0, values[0] ?? 0),
      })}
    </Text>
  );

  return (
    <View style={styles.wrap}>
      {data.steps.map((s, i) => {
        const pct = share(s.devices, first);
        const lost = i > 0 ? counts[i - 1] - s.devices : 0;
        return (
          <View key={s.step} style={styles.row} accessibilityLabel={`${t(`admin.funnel.steps.${s.step}`)}: ${s.devices}, ${pct}%`}>
            <Text style={styles.label} numberOfLines={1}>{t(`admin.funnel.steps.${s.step}`)}</Text>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.max(pct, 1)}%` }, i === worst && styles.worstBar]} />
            </View>
            <Text style={styles.count}>{s.devices}</Text>
            <Text style={styles.pct}>{pct}%</Text>
            <Text style={[styles.lost, i === worst && styles.worstText]}>{i > 0 && lost > 0 ? `-${lost}` : ''}</Text>
          </View>
        );
      })}
      {worst !== null ? (
        <Text style={styles.hint}>{t('admin.funnel.biggestDrop', { step: t(`admin.funnel.steps.${data.steps[worst].step}`), count: counts[worst - 1] - counts[worst] })}</Text>
      ) : null}
      <View style={styles.split}>
        <Text style={styles.splitTitle}>{t('admin.funnel.byPlatform')}</Text>
        {Object.entries(data.by_platform).map(([p, v]) => line(t(`admin.funnel.platforms.${p}`), v))}
        <Text style={styles.splitTitle}>{t('admin.funnel.byLanguage')}</Text>
        {Object.entries(data.by_lang).map(([l, v]) => line(l, v))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: 170, color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  track: { flex: 1, height: 14, borderRadius: radius.button, backgroundColor: colors.tint, overflow: 'hidden' },
  bar: { height: 14, borderRadius: radius.button, backgroundColor: colors.logoIndigo },
  worstBar: { backgroundColor: colors.alert },
  count: { width: 56, textAlign: 'right', color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  pct: { width: 44, textAlign: 'right', color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  lost: { width: 52, textAlign: 'right', color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  worstText: { color: colors.alert, fontFamily: fonts.bold },
  hint: { color: colors.alert, fontFamily: fonts.semibold, fontSize: 14, marginTop: 4 },
  muted: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14 },
  split: { gap: 4, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder },
  splitTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 14, marginTop: 4 },
  splitRow: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  splitLabel: { color: colors.text, fontFamily: fonts.semibold },
});
