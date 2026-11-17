// Admin side > Home: what this staff member can and can't do, so a sub admin never has to guess why a menu is missing.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { CheckIcon } from '@/components/Icons';
import { useAdminAccess } from '@/admin/access';
import { AdminNames } from '@/admin/AdminNames';
import { GRANTABLE } from '@/admin/types';
import { adminStyles, Panel } from '@/admin/ui';
import { colors, fonts } from '@/theme/tokens';

const ALL = [...GRANTABLE, 'staff', 'audit'] as const;

export function MyAccess() {
  const { t } = useTranslation();
  const me = useAdminAccess();
  if (me.role === 'aywo_admin') {
    return (
      <Panel title={t('admin.myAccess.title')}>
        <Text style={adminStyles.cellMuted}>{t('admin.myAccess.admin')}</Text>
      </Panel>
    );
  }
  const can = ALL.filter((p) => me.permissions.includes(p));
  const cannot = ALL.filter((p) => !me.permissions.includes(p));
  return (
    <Panel title={t('admin.myAccess.title')}>
      <Text style={adminStyles.cellStrong}>
        {me.team_role ? t('admin.myAccess.yourRole', { name: me.team_role }) : t('admin.myAccess.custom')}
      </Text>
      <View style={styles.cols}>
        <View style={styles.col}>
          <Text style={styles.colTitle}>{t('admin.myAccess.can')}</Text>
          {can.map((p) => (
            <View key={p} style={styles.row}>
              <View style={[styles.mark, styles.yes]}><CheckIcon color={colors.white} size={12} /></View>
              <View style={styles.text}>
                <Text style={styles.name}>{t(`admin.permissions.${p}`)}</Text>
                <Text style={styles.help}>{t(`admin.permissionHelp.${p}`)}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.col}>
          <Text style={styles.colTitle}>{t('admin.myAccess.cannot')}</Text>
          {cannot.map((p) => (
            <View key={p} style={styles.row}>
              <View style={[styles.mark, styles.no]}><Text style={styles.cross}>✕</Text></View>
              <View style={styles.text}>
                <Text style={[styles.name, styles.nameNo]}>{t(`admin.permissions.${p}`)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      <Text style={adminStyles.cellMuted}>{t('admin.myAccess.askAdmin')}</Text>
      <AdminNames />
    </Panel>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  col: { flex: 1, minWidth: 240, gap: 8 },
  colTitle: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  mark: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  yes: { backgroundColor: colors.good },
  no: { backgroundColor: colors.line },
  cross: { color: colors.muted, fontSize: 11, fontFamily: fonts.bold },
  text: { flex: 1, gap: 1 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  nameNo: { color: colors.muted, fontFamily: fonts.medium },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
});
