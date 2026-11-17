// What each role in a tree can do. A table to compare on a wide screen; on a phone, pick a role and read its list.
// Opened from Share, the Help centre and the line under a tree's name; ?role= opens on that role.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card, Muted, TopBar } from '@/components/ui';
import { goBack } from '@/lib/nav';
import { RightMark, RoleRightsList } from '@/tree/RoleRights';
import { isTreeRole, RIGHTS, ROLE_NAME, ROLE_ORDER, type TreeRole } from '@/tree/roleRights';
import { colors, fonts, minTapSize } from '@/theme/tokens';

// Below this the five columns no longer fit with readable words.
const TABLE_WIDTH = 640;

export default function Roles() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  // The space the page really has (the side menu takes some on a computer), not the window's width.
  const [width, setWidth] = useState(0);
  const [role, setRole] = useState<TreeRole>(isTreeRole(params.role) ? params.role : 'viewer');
  const table = width >= TABLE_WIDTH;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar title={t('roles.title')} subtitle={t('roles.subtitle')} onBack={() => goBack(router)} />
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />

        {table ? (
          <Card style={styles.table}>
            <View style={[styles.tr, styles.head]}>
              <View style={styles.firstCell} />
              {ROLE_ORDER.map((r) => (
                <View key={r} style={styles.cell}>
                  <Text style={[styles.headText, r === params.role && styles.headMine]}>{t(ROLE_NAME[r])}</Text>
                </View>
              ))}
            </View>
            {RIGHTS.map((right, index) => (
              <View key={right.key} style={[styles.tr, index % 2 === 1 && styles.striped]}>
                <View style={styles.firstCell}>
                  <Text style={styles.rightText}>{t(`roles.rights.${right.key}`)}</Text>
                </View>
                {ROLE_ORDER.map((r) => (
                  <View key={r} style={styles.cell}>
                    <RightMark right={right.by[r]} compact />
                  </View>
                ))}
              </View>
            ))}
          </Card>
        ) : (
          <>
            <View accessibilityRole="radiogroup" style={styles.chips}>
              {ROLE_ORDER.map((r) => {
                const on = r === role;
                return (
                  <Pressable
                    key={r}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setRole(r)}
                    style={({ hovered }: { hovered?: boolean }) => [styles.chip, on && styles.chipOn, hovered && !on && styles.chipHover]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(ROLE_NAME[r])}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Card style={styles.listCard}>
              <Text style={styles.roleTitle}>{t(ROLE_NAME[role])}</Text>
              <Muted>{t(`roles.about.${role}`)}</Muted>
              <RoleRightsList role={role} />
            </Card>
          </>
        )}

        <Card style={styles.notes}>
          <Text style={styles.notesTitle}>{t('roles.notesTitle')}</Text>
          <Muted>{t('roles.noteApproval')}</Muted>
          <Muted>{t('roles.noteNumbers')}</Muted>
          <Muted>{t('roles.noteEditor')}</Muted>
          <Muted>{t('roles.noteOneTree')}</Muted>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  table: { padding: 0, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 12 },
  head: { borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 56 },
  striped: { backgroundColor: colors.background },
  firstCell: { flex: 2.4, paddingRight: 12, paddingVertical: 8 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  headText: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14, textAlign: 'center' },
  headMine: { color: colors.relation },
  rightText: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: minTapSize,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  chipOn: { backgroundColor: colors.activeTab, borderColor: colors.activeTab },
  chipHover: { backgroundColor: colors.tint },
  chipText: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  chipTextOn: { color: colors.white },
  listCard: { gap: 12 },
  roleTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 18 },
  notes: { gap: 8 },
  notesTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 15 },
});
