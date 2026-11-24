// The "More relatives" list on Add a relative. The rules are in farRelatives.ts; this is only what is on screen.
//
// Pick "Cousin" and it asks whose child (when there are several uncles and aunts), then hands back that person and
// the link to make. When the person in between is not in the tree yet (no uncle, so no cousin), it says who to add
// first and offers to do that, so nobody is left looking at a choice that does nothing.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, SmallButton, TextButton } from '@/components/ui';
import { FAR_RELATIVES, maybeParents, throughPeople } from '@/tree/farRelatives';
import type { FamilyShape, FarRelative, Through } from '@/tree/farRelatives';
import { colors, fonts, minTapSize } from '@/theme/tokens';

interface Props {
  family: FamilyShape;
  anchorId: string;
  anchorName: string;
  nameOf: (personId: string) => string;
  /** The person the relative hangs from, and which of the four links to make. */
  onPick: (throughId: string, choice: FarRelative) => void;
  /** The person in between is missing: add them first. Not offered for an uncle or aunt, who has two ways in. */
  onAddFirst: (missing: Exclude<Through, 'parentSibling'>) => void;
  onClose: () => void;
}

export function FarRelativePicker({ family, anchorId, anchorName, nameOf, onPick, onAddFirst, onClose }: Props) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<FarRelative | null>(null);
  const people = chosen ? throughPeople(family, anchorId, chosen.through) : [];
  // A parent with no gender on their card: asked about, never added a second time.
  const maybe = chosen ? maybeParents(family, anchorId, chosen.through) : [];

  function choose(choice: FarRelative) {
    const found = throughPeople(family, anchorId, choice.through);
    // Only one person it can be: no question to ask.
    if (found.length === 1 && found[0]) onPick(found[0], choice);
    else setChosen(choice);
  }

  // Once a relative is chosen, the long list makes way for the one question about it. Left in place, the question
  // sat under twelve choices, below the edge of the screen, and the tap seemed to do nothing.
  if (chosen) {
    return (
      <Card>
        <Text style={styles.title}>{t(`add.far.kinds.${chosen.key}`)}</Text>
        {people.length > 1 ? (
          <View style={styles.answer}>
            <Text style={styles.question}>{t(`add.far.whose.${chosen.relation}`)}</Text>
            {people.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => onPick(id, chosen)} style={styles.person}>
                <Text style={styles.personName}>{nameOf(id)}</Text>
              </Pressable>
            ))}
          </View>
        ) : maybe.length > 0 ? (
          <View style={styles.answer}>
            <Text style={styles.question}>{t(`add.far.maybe.${chosen.through}`, { name: anchorName })}</Text>
            {maybe.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => onPick(id, chosen)} style={styles.person}>
                <Text style={styles.personName}>{t('add.far.yesThem', { name: nameOf(id) })}</Text>
              </Pressable>
            ))}
            <View style={styles.start}>
              <SmallButton
                kind="plain"
                label={t(`add.far.notThem.${chosen.through}`)}
                onPress={() => onAddFirst(chosen.through as Exclude<Through, 'parentSibling'>)}
              />
            </View>
          </View>
        ) : (
          <View style={styles.answer}>
            <Text style={styles.need}>{t(`add.far.need.${chosen.through}`, { name: anchorName })}</Text>
            {chosen.through !== 'parentSibling' ? (
              <View style={styles.start}>
                <SmallButton
                  label={t(`add.far.addFirst.${chosen.through}`)}
                  onPress={() => onAddFirst(chosen.through as Exclude<Through, 'parentSibling'>)}
                />
              </View>
            ) : null}
          </View>
        )}
        <TextButton label={t('add.far.other')} onPress={() => setChosen(null)} />
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.title}>{t('add.far.title', { name: anchorName })}</Text>
      <View style={styles.chips}>
        {FAR_RELATIVES.map((choice) => (
          <Pressable key={choice.key} accessibilityRole="button" onPress={() => choose(choice)} style={styles.chip}>
            <Text style={styles.chipText}>{t(`add.far.kinds.${choice.key}`)}</Text>
          </Pressable>
        ))}
      </View>
      <TextButton label={t('add.far.close')} onPress={onClose} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: minTapSize,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.tint,
  },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  answer: { gap: 8 },
  question: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
  person: {
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  personName: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  need: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  start: { alignItems: 'flex-start' },
});
