// Choose someone from the tree, with a search box. Used for 'Change' and 'Someone already in the tree' on E1.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { Field, TextButton } from '@/components/ui';
import { colors, fonts } from '@/theme/tokens';
import type { TreeNode } from './useTreeView';

interface Props {
  visible: boolean;
  title: string;
  people: TreeNode[];
  excludeId?: string | null;
  onPick: (personId: string) => void;
  onClose: () => void;
}

export function PersonPicker({ visible, title, people, excludeId, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = people
    .filter((p) => p.id !== excludeId && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Field value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} accessibilityLabel={t('search.placeholder')} autoCorrect={false} />
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>{t('search.nothing')}</Text>}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => onPick(item.id)} style={styles.row}>
                <Avatar personId={item.id} size={40} photoUrl={item.photoUrl} nameUnknown={item.nameUnknown} />
                <Text style={styles.name}>{item.nameUnknown ? t('tree.nameNotKnown') : item.name}</Text>
              </Pressable>
            )}
          />
          <TextButton label={t('tree.close')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { maxHeight: '80%', backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  name: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  empty: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, padding: 12, textAlign: 'center' },
});
