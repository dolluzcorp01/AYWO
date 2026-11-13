// Family in the tree who have not joined AYWO yet, each with an Invite button. Chat can only reach people who
// have joined, so the chat screens show this instead of a dead end ("No one yet").
import { closeFamily, focusView, graphFromApi } from '@aywo/layout';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { Card, SectionTitle, SmallButton } from '@/components/ui';
import { mainTree, useTrees } from '@/lib/account';
import { canShare } from '@/tree/roles';
import { useTreeView } from '@/tree/useTreeView';
import { colors, fonts } from '@/theme/tokens';

const MAX_SHOWN = 8;

export function InviteFamily({ title, help, fallback = null }: { title: string; help?: string; fallback?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const trees = useTrees();
  const main = mainTree(trees.data);
  const view = useTreeView(main?.id ?? '', 'mine', i18n.language, null);
  const data = main ? view.data : undefined;
  const viewerId = data?.viewer_person_id;
  if (!main || !data || !viewerId || !canShare(data.role)) return <>{fallback}</>;

  // Closest family first (parents, partner, children, brothers and sisters), then everyone else in the tree.
  const close = closeFamily(focusView(graphFromApi(data), viewerId));
  const order = [...close, ...data.nodes.map((n) => n.id).filter((id) => !close.includes(id))];
  const people = order
    .map((id) => data.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.id !== viewerId && !n.joined && !n.nameUnknown && n.living !== 'deceased')
    .slice(0, MAX_SHOWN);
  if (people.length === 0) return <>{fallback}</>;

  return (
    <View style={styles.box}>
      <SectionTitle>{title}</SectionTitle>
      {help ? <Text style={styles.help}>{help}</Text> : null}
      {people.map((n) => (
        <Card key={n.id} style={styles.row}>
          <Avatar personId={n.id} size={36} photoUrl={n.photoUrl} name={n.name} />
          <Text style={styles.name} numberOfLines={1}>
            {n.name}
          </Text>
          <SmallButton
            label={t('card.invite')}
            onPress={() => router.push({ pathname: '/share/[treeId]', params: { treeId: main.id, personId: n.id } })}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  help: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 },
  name: { flex: 1, color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
});
