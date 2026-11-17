// My orders: posters, books and invites bought, with where each one is and its tracking link.
// Opened with ?paid=1 straight after paying (Stripe's return address, and the shop inside the apps): the list holds
// only orders the payment service has confirmed, so the screen thanks the person and keeps refreshing until the
// new order shows. &order=<id> names the order when the app knows it.
//
// Cancelling: money goes back only through the payment service, which the buyer's side cannot reach safely
// (refunds are a staff action that talks to Razorpay or Stripe). So an order that has not started printing gets
// "Ask to cancel this order": it sends AYWO Support a help request that already names the order.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Text';
import { showToast } from '@/components/Toast';
import { Card, ConfirmDialog, PrimaryButton, TextButton } from '@/components/ui';
import { api, deviceStore } from '@/lib/api';
import { formatMoney } from '@/ops/types';
import type { MyOrder as BasicOrder } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

/** What my_orders adds for the buyer (migration 0032): where it is going, and the payment service's own id. */
interface MyOrder extends BasicOrder {
  payment_ref?: string | null;
  shipping?: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
}

/** Orders this phone has already asked to cancel, with the help request made for each: never asked twice. */
const ASKED_KEY = 'aywo.orderCancelAsked';

/** The short order number people can read out: the first 8 characters of the id. */
const orderRef = (id: string) => id.slice(0, 8).toUpperCase();

const STEPS = ['queued', 'printing', 'shipped', 'delivered'] as const;
const REFRESH_EVERY_MS = 3000;
const REFRESH_FOR_MS = 90_000;
const JUST_NOW_MS = 15 * 60_000;

/** Only real web links open. A tracking link is typed by staff, and anything else (tel:, javascript:, a file) is not one. */
function safeLink(url: string | null): string | null {
  return url && /^https:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}

export default function MyOrders() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ paid?: string; order?: string }>();
  const justPaid = params.paid === '1';
  const [openedAt] = useState(() => Date.now());
  const [stopped, setStopped] = useState(false);
  const [linkFailed, setLinkFailed] = useState<string | null>(null);

  // The order just paid for is in the list: the named one, or else one paid in the last few minutes.
  const arrived = (list: MyOrder[] | undefined) =>
    !!list?.some((o) => (params.order ? o.id === params.order : !!o.paid_at && Math.abs(openedAt - new Date(o.paid_at).getTime()) < JUST_NOW_MS));

  const orders = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.rpc<MyOrder[]>('my_orders'),
    refetchInterval: (query) => (justPaid && !stopped && !arrived(query.state.data) ? REFRESH_EVERY_MS : false),
  });
  const confirmed = justPaid && arrived(orders.data);

  useEffect(() => {
    if (!justPaid) return;
    const timer = setTimeout(() => setStopped(true), REFRESH_FOR_MS);
    return () => clearTimeout(timer);
  }, [justPaid]);

  const [asked, setAsked] = useState<Record<string, string>>({});
  useEffect(() => {
    void deviceStore
      .get(ASKED_KEY)
      .then((saved) => (saved ? setAsked(JSON.parse(saved) as Record<string, string>) : undefined))
      .catch(() => undefined);
  }, []);
  // The order the "are you sure" is open for.
  const [cancelling, setCancelling] = useState<MyOrder | null>(null);
  const day = (value: string) => new Date(value).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });

  const askCancel = useMutation({
    mutationFn: (o: MyOrder) =>
      api.rpc<{ id: string }>('ticket_create', {
        p_subject: t('ops.orders.cancelSubject', { ref: orderRef(o.id) }),
        p_category: 'order',
        p_body: t('ops.orders.cancelBody', {
          product: t(`ops.shop.products.${o.product}`),
          quantity: o.quantity,
          id: o.id,
          date: day(o.paid_at ?? o.created_at),
          amount: formatMoney(o.amount_minor, o.currency, i18n.language),
        }),
      }),
    onSuccess: (ticket, o) => {
      const next = { ...asked, [o.id]: ticket.id };
      setAsked(next);
      void deviceStore.set(ASKED_KEY, JSON.stringify(next)).catch(() => undefined);
      showToast('success', t('ops.orders.cancelAsked'));
    },
    onSettled: () => setCancelling(null),
  });

  async function openTracking(id: string, url: string) {
    setLinkFailed(null);
    await Linking.openURL(url).catch(() => setLinkFailed(id));
  }

  return (
    <Page title={t('ops.orders.title')} subtitle={t('ops.orders.subtitle')}>
      {justPaid ? (
        <Card style={styles.paid}>
          <Text accessibilityRole="header" style={styles.title}>{t(confirmed ? 'ops.orders.paidTitle' : 'ops.shop.thanksTitle')}</Text>
          <View accessibilityLiveRegion="polite">
            <Note>{t(confirmed ? 'ops.orders.paidDone' : stopped ? 'ops.orders.paidSlow' : 'ops.orders.paidWaiting')}</Note>
          </View>
          {!confirmed && stopped ? (
            <>
              <TextButton
                label={orders.isFetching ? t('ops.orders.checking') : t('ops.orders.checkAgain')}
                disabled={orders.isFetching}
                onPress={() => void orders.refetch()}
              />
              <TextButton label={t('ops.orders.help')} onPress={() => router.push('/help')} />
            </>
          ) : null}
        </Card>
      ) : null}
      <Gate query={orders}>
        {(list) =>
          list.length === 0 ? (
            justPaid && !confirmed ? null : (
              <>
                <Note>{t('ops.orders.none')}</Note>
                <PrimaryButton label={t('ops.orders.shop')} onPress={() => router.push('/shop')} />
              </>
            )
          ) : (
            <View style={styles.list}>
              {list.map((o) => {
                const reached = STEPS.indexOf(o.fulfilment as (typeof STEPS)[number]);
                const trackingLink = safeLink(o.tracking_url);
                const to = o.shipping;
                // The address as written on a parcel: one line each, empty parts left out.
                const addressLines = to
                  ? [to.name, to.line1, to.line2, [to.city, to.state, to.postal_code].filter(Boolean).join(', '), to.country].filter((line): line is string => !!line && line.trim() !== '')
                  : [];
                const canAskCancel = o.status === 'paid' && o.fulfilment === 'queued';
                return (
                  <Card key={o.id} style={styles.order}>
                    <Text style={styles.title}>
                      {t(`ops.shop.products.${o.product}`)}
                      {o.quantity > 1 ? ` x ${o.quantity}` : ''}
                    </Text>
                    <Note>{t('ops.orders.paidLine', { amount: formatMoney(o.amount_minor, o.currency, i18n.language), date: day(o.paid_at ?? o.created_at) })}</Note>
                    {o.discount_minor > 0 ? <Note>{t('ops.orders.discountLine', { amount: formatMoney(o.discount_minor, o.currency, i18n.language) })}</Note> : null}
                    <Text selectable style={styles.ref}>{t('ops.orders.orderNo', { ref: orderRef(o.id) })}</Text>
                    {o.payment_ref ? <Text selectable style={styles.ref}>{t('ops.orders.paymentRef', { ref: o.payment_ref })}</Text> : null}
                    {addressLines.length > 0 ? (
                      <View style={styles.address}>
                        <Text style={styles.addressLabel}>{t('ops.orders.sendingTo')}</Text>
                        {addressLines.map((line, i) => (
                          <Text key={i} style={styles.addressLine}>{line}</Text>
                        ))}
                      </View>
                    ) : null}
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
                    {trackingLink ? <TextButton label={t('ops.orders.track')} onPress={() => void openTracking(o.id, trackingLink)} /> : null}
                    {linkFailed === o.id ? <Note>{t('ops.orders.trackFailed')}</Note> : null}
                    {asked[o.id] && o.status === 'paid' && o.fulfilment !== 'cancelled' ? (
                      <>
                        <Note>{t('ops.orders.cancelAsked')}</Note>
                        <TextButton label={t('ops.orders.cancelSee')} onPress={() => router.push({ pathname: '/help/[id]', params: { id: asked[o.id] } })} />
                      </>
                    ) : canAskCancel ? (
                      <TextButton label={t('ops.orders.cancelAsk')} danger onPress={() => setCancelling(o)} />
                    ) : o.status === 'paid' && (o.fulfilment === 'printing' || o.fulfilment === 'shipped') ? (
                      // No button without a reason: say why this one can no longer be stopped.
                      <Note>{t('ops.orders.cancelTooLate')}</Note>
                    ) : null}
                  </Card>
                );
              })}
              <ActionError error={askCancel.error} />
              <TextButton label={t('ops.orders.help')} onPress={() => router.push('/help')} />
              <ConfirmDialog
                visible={cancelling !== null}
                title={t('ops.orders.cancelTitle')}
                message={t('ops.orders.cancelText')}
                confirmLabel={t('ops.orders.cancelYes')}
                danger
                busy={askCancel.isPending}
                onConfirm={() => (cancelling ? askCancel.mutate(cancelling) : undefined)}
                onCancel={() => setCancelling(null)}
              />
            </View>
          )
        }
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  paid: { gap: 8, marginBottom: 12 },
  order: { gap: 8 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 17 },
  state: { color: colors.muted, fontFamily: fonts.bold, fontSize: 14 },
  ref: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
  address: { gap: 2 },
  addressLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  addressLine: { color: colors.text, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.cardBorder },
  dotOn: { backgroundColor: colors.logoIndigo },
  stepText: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 11, textAlign: 'center' },
  stepOn: { color: colors.text, fontFamily: fonts.bold },
});
