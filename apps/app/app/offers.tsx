// Offers: codes AYWO is running now, and offer cards. A code is typed at checkout in the shop.
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, SmallButton } from '@/components/ui';
import { api } from '@/lib/api';
import { HomeOfferCards } from '@/ops/Announcements';
import { formatMoney } from '@/ops/types';
import type { Offer } from '@/ops/types';
import { Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

export default function Offers() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api.rpc<Offer[]>('offers_list') });
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <Page title={t('ops.offers.title')} subtitle={t('ops.offers.subtitle')}>
      <HomeOfferCards />
      <Gate query={offers}>
        {(list) =>
          list.length === 0 ? (
            <Note>{t('ops.offers.none')}</Note>
          ) : (
            <View style={styles.list}>
              {list.map((o) => (
                <Card key={o.code} style={styles.offer}>
                  <View style={styles.head}>
                    <Text style={styles.off}>
                      {o.kind === 'percent' ? t('ops.offers.percentOff', { value: o.value }) : t('ops.offers.amountOff', { amount: formatMoney(o.value, o.currency ?? 'INR', i18n.language) })}
                    </Text>
                    <View style={styles.code}>
                      <Text style={styles.codeText}>{o.code}</Text>
                    </View>
                  </View>
                  <Text style={styles.title}>{o.title}</Text>
                  {o.description ? <Text style={styles.body}>{o.description}</Text> : null}
                  <Note>
                    {o.products.map((p) => t(`ops.shop.products.${p}`)).join(', ')}
                    {o.ends_at ? ` · ${t('ops.offers.until', { date: new Date(o.ends_at).toLocaleDateString(i18n.language) })}` : ''}
                  </Note>
                  <View style={styles.actions}>
                    <SmallButton
                      kind="plain"
                      label={copied === o.code ? t('ops.offers.copied') : t('ops.offers.copy')}
                      onPress={() => {
                        void Clipboard.setStringAsync(o.code);
                        setCopied(o.code);
                      }}
                    />
                    <SmallButton label={t('ops.offers.use')} onPress={() => router.push({ pathname: '/shop', params: { coupon: o.code } })} />
                  </View>
                </Card>
              ))}
            </View>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  offer: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  off: { color: colors.relation, fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: -0.4 },
  code: { borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.logoIndigo, paddingHorizontal: 10, paddingVertical: 4 },
  codeText: { color: colors.logoIndigo, fontFamily: fonts.extrabold, fontSize: 15, letterSpacing: 1 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  body: { color: colors.muted, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
