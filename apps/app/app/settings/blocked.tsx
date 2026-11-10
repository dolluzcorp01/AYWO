// People this person blocked. Blocked people can't start a chat with them, and neither sees the other's memories,
// comments or messages. Unblocking puts things back.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useTimeAgo } from '@/lib/time';
import { BlockDialog } from '@/ops/Report';
import { Gate, Note, Page, useName } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

interface Blocked {
  profile_id: string;
  name: string;
  since: string;
}

export default function BlockedPeople() {
  const { t } = useTranslation();
  const ago = useTimeAgo();
  const showName = useName();
  const list = useQuery({ queryKey: ['blocked'], queryFn: () => api.rpc<Blocked[]>('blocked_list') });
  const [unblocking, setUnblocking] = useState<Blocked | null>(null);

  return (
    <Page title={t('ops.block.listTitle')} subtitle={t('ops.block.listSubtitle')}>
      <Gate query={list}>
        {(rows) =>
          rows.length === 0 ? (
            <Note>{t('ops.block.none')}</Note>
          ) : (
            <Card style={styles.list}>
              {rows.map((b, i) => (
                <View key={b.profile_id} style={[styles.row, i < rows.length - 1 && styles.line]}>
                  <View style={styles.text}>
                    <Text style={styles.name}>{showName(b.name)}</Text>
                    <Text style={styles.meta}>{t('ops.block.since', { when: ago(b.since) })}</Text>
                  </View>
                  <TextButton label={t('ops.block.unblock')} onPress={() => setUnblocking(b)} />
                </View>
              ))}
            </Card>
          )
        }
      </Gate>
      {unblocking ? (
        <BlockDialog visible profileId={unblocking.profile_id} name={showName(unblocking.name)} blocked onClose={() => setUnblocking(null)} />
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { padding: 0, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.tint },
  text: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
  meta: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
});
