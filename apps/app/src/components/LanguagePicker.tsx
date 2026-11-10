// The full language list ('+ 37 more'): pick a language, then its script or region where it has several (S-01).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Field, TextButton } from '@/components/ui';
import { languages } from '@/i18n/languages';
import type { Language } from '@/i18n/languages';
import { colors, fonts, minTapSize } from '@/theme/tokens';

interface Props {
  visible: boolean;
  /** Open straight on one language's variants, for a Welcome chip that has several. */
  startWith?: Language | null;
  current: string;
  onPick: (code: string) => void;
  onClose: () => void;
}

export function LanguagePicker({ visible, startWith, current, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Language | null>(startWith ?? null);

  useEffect(() => {
    if (visible) {
      setOpen(startWith ?? null);
      setQuery('');
    }
  }, [visible, startWith]);

  const q = query.trim().toLowerCase();
  const shown = q ? languages.filter((l) => l.native.toLowerCase().includes(q) || l.english.toLowerCase().includes(q)) : languages;

  function choose(language: Language) {
    if (language.variants.length === 1) onPick(language.variants[0].code);
    else setOpen(language);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {open ? t('language.whichOf', { language: open.native }) : t('language.title')}
          </Text>
          {open ? (
            <FlatList
              data={open.variants}
              keyExtractor={(v) => v.code}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.code === current }}
                  onPress={() => onPick(item.code)}
                  style={styles.row}
                >
                  <Text style={[styles.name, item.code === current && styles.on]}>{item.label}</Text>
                </Pressable>
              )}
            />
          ) : (
            <>
              <Field value={query} onChangeText={setQuery} placeholder={t('language.search')} accessibilityLabel={t('language.search')} />
              <FlatList
                data={shown}
                keyExtractor={(l) => l.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const on = item.variants.some((v) => v.code === current);
                  return (
                    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => choose(item)} style={styles.row}>
                      <Text style={[styles.name, on && styles.on]}>{item.native}</Text>
                      <Text style={styles.english}>{item.english}</Text>
                    </Pressable>
                  );
                }}
              />
            </>
          )}
          <TextButton label={open && !startWith ? t('card.goBack') : t('tree.close')} onPress={open && !startWith ? () => setOpen(null) : onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { maxHeight: '80%', backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: minTapSize + 4 },
  name: { flexShrink: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  on: { color: colors.relation, fontFamily: fonts.extrabold },
  english: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
});
