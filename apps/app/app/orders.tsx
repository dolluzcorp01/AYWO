// My orders: posters, books and invites bought, with where each one is and its tracking link.
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { Card, PrimaryButton, TextButton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/ops/types';
import type { MyOrder } from '@/ops/types';
import { Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

const STEPS = ['queued', 'printing', 'shipped', 'delivered'] as const;

export default function MyOrders() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const orders = useQuery({ queryKey: ['my-orders'], queryFn: () => api.rpc<MyOrder[]>('my_orders') });

  return (
    <Page title={t('ops.orders.title')} subtitle={t('ops.orders.subtitle')}>
      <Gate query={orders}>
        {(list) =>
          list.length === 0 ? (
            <>
              <Note>{t('ops.orders.none')}</Note>
              <PrimaryButton label={t('ops.orders.shop')} onPress={() => router.push('/shop')} />
            </>
          ) : (
            <View style={styles.list}>
              {list.map((o) => {
                const reached = STEPS.indexOf(o.fulfilment as (typeof STEPS)[number]);
                return (
                  <Card key={o.id} style={styles.order}>
                    <Text style={styles.title}>
                      {t(`ops.shop.products.${o.product}`)}
                      {o.quantity > 1 ? ` x ${o.quantity}` : ''}
                    </Text>
                    <Note>
                      {formatMoney(o.amount_minor, o.currency, i18n.language)} · {new Date(o.created_at).toLocaleDateString(i18n.language)}
                    </Note>
                    {o.status === 'refunded' ? (
                      <Text style={styles.state}>{t('ops.orders.refunded')}</Text>
                    ) : o.fulfilment === 'none' ? (
                      <Text style={styles.state}>{t('ops.orders.digital')}</Text>
                    ) : o.fulfilment === 'cancelled' ? (
                      <Text style={styles.state}>{t('ops.orders.cancelled')}</Text>
                    ) : (
                      <View style={styles.steps} accessibilityLabel={t(`ops.orders.steps.${o.fulfilment}`)}>
                        {STEPS.map((step, i) => (
                          <View key={step} style={styles.step}>
                            <View style={[styles.dot, i <= reached && styles.dotOn]} />
                            <Text style={[styles.stepText, i <= reached && styles.stepOn]}>{t(`ops.orders.steps.${step}`)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {o.tracking_number ? (
                      <Note>{t('ops.orders.tracking', { carrier: o.carrier ?? '', number: o.tracking_number })}</Note>
                    ) : null}
                    {o.tracking_url ? <TextButton label={t('ops.orders.track')} onPress={() => void Linking.openURL(o.tracking_url as string)} /> : null}
                  </Card>
                );
              })}
              <TextButton label={t('ops.orders.help')} onPress={() => router.push('/help')} />
            </View>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  order: { gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  state: { color: colors.muted, fontFamily: fonts.bold, fontSize: 14 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cardBorder },
  dotOn: { backgroundColor: colors.logoIndigo },
  stepText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
  stepOn: { color: colors.text, fontFamily: fonts.bold },
});
