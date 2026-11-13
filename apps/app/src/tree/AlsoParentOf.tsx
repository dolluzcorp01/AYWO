// "Also the parent of": ticks for the brothers and sisters added before this mother or father.
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Checkbox, SectionTitle } from '@/components/ui';
import { colors, fonts } from '@/theme/tokens';

export function AlsoParentOf({
  people,
  ticked,
  onChange,
}: {
  people: { id: string; name: string }[];
  ticked: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  if (!people.length) return null;
  return (
    <View style={styles.box}>
      <SectionTitle>{t('add.alsoParentOf')}</SectionTitle>
      <Text style={styles.help}>{t('add.alsoParentHelp')}</Text>
      {people.map((p) => (
        <Checkbox
          key={p.id}
          label={p.name}
          on={ticked.includes(p.id)}
          onChange={(on) => onChange(on ? [...ticked, p.id] : ticked.filter((id) => id !== p.id))}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  help: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
});
