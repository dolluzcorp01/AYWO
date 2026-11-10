import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { colors, fonts, minTapSize, shadows } from '@/theme/tokens';
import type { TreeMode } from './useTreeView';

interface Props {
  mode: TreeMode;
  onChange: (mode: TreeMode) => void;
  /** Only the tree's Creator and Co-creators see 'See as...' (wireframe B3 does not have it). */
  canSeeAs: boolean;
  /** No card of your own yet, so there is no 'My view' to show. */
  hasOwnPlace: boolean;
}

export function ViewSwitch({ mode, onChange, canSeeAs, hasOwnPlace }: Props) {
  const { t } = useTranslation();
  const options: { key: TreeMode; label: string }[] = [];
  if (hasOwnPlace) options.push({ key: 'mine', label: t('tree.myView') });
  options.push({ key: 'names', label: t('tree.namesOnly') });
  if (canSeeAs) options.push({ key: 'see_as', label: t('tree.seeAs') });

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === mode;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={styles.option}
          >
            <View style={[styles.fill, on && styles.fillOn]}>
              <Text style={[styles.text, on && styles.textOn]}>{o.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 4, backgroundColor: colors.card, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.cardBorder, ...shadows.card },
  option: { flex: 1, minHeight: minTapSize - 6 },
  fill: { flex: 1, minHeight: minTapSize - 6, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  fillOn: { backgroundColor: colors.logoIndigo },
  text: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14 },
  textOn: { color: colors.white },
});
