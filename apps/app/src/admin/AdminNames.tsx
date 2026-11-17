// "Ask an AYWO Admin" is no help to a sub admin who cannot see who they are. This line names them.
// Names only: the server gives no phone numbers. Shows nothing while loading or when the list cannot be read.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import { api } from '@/lib/api';
import { colors, fonts } from '@/theme/tokens';

export function AdminNames() {
  const { t } = useTranslation();
  // The team changes rarely, so one read serves every page for a few minutes.
  const names = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => api.get<string[]>('/admin/admins'), staleTime: 5 * 60_000 });
  if (!names.data || names.data.length === 0) return null;
  return <Text style={styles.text}>{t('admin.myAccess.admins', { names: names.data.join(', '), count: names.data.length })}</Text>;
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
});
