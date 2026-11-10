// 'See as...': the Creator picks whose place in the tree to look from (F-VIEW).
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { colors, fonts, minTapSize } from '@/theme/tokens';
import type { TreeNode } from './useTreeView';

interface Props {
  visible: boolean;
  people: TreeNode[];
  onPick: (personId: string) => void;
  onClose: () => void;
}

export function SeeAsPicker({ visible, people, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const named = people.filter((p) => !p.nameUnknown).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('tree.seeAsTitle')}</Text>
          <FlatList
            data={named}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => onPick(item.id)} style={styles.row}>
                <Avatar personId={item.id} size={40} photoUrl={item.photoUrl} />
                <Text style={styles.name}>{item.name}</Text>
              </Pressable>
            )}
          />
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>{t('tree.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
  sheet: { maxHeight: '75%', backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  name: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  close: { minHeight: minTapSize, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 15 },
});
