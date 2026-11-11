// Shop: a printed family tree poster or a family book, sent home. Prices come from the server; a coupon is checked
// by the server too. Payment happens on Razorpay's or Stripe's own page; card details never reach AYWO.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PhoneField } from '@/components/PhoneField';
import { Text } from '@/components/Text';
import { Card, Field, Pills, PrimaryButton, SectionTitle, SmallButton } from '@/components/ui';
import { toE164 } from '@/lib/phone';
import { api } from '@/lib/api';
import { mainTree, useMe, useTrees } from '@/lib/account';
import { startOrder } from '@/pay/order';
import type { ShippingAddress } from '@/pay/order';
import { formatMoney } from '@/ops/types';
import type { CouponQuote, Product, Products } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

const EMPTY: ShippingAddress = { name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: 'IN', phone: '' };

export default function Shop() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ coupon?: string; product?: Product }>();
  const me = useMe();
  const trees = useTrees();
  const products = useQuery({ queryKey: ['shop-products'], queryFn: () => api.get<Products>('/pay/products') });
  const [product, setProduct] = useState<Product>(params.product === 'family_book' ? 'family_book' : 'tree_poster');
  const [treeId, setTreeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [address, setAddress] = useState<ShippingAddress>({ ...EMPTY, name: me.data?.display_name ?? '' });
  const [code, setCode] = useState((params.coupon ?? '').toUpperCase());
  const [quote, setQuote] = useState<CouponQuote | null>(null);
  const [state, setState] = useState<'idle' | 'started' | 'cancelled'>('idle');
  // The account loads after the first render; its name fills an empty name box once.
  const myName = me.data?.display_name;
  useEffect(() => {
    if (myName) setAddress((old) => (old.name ? old : { ...old, name: myName }));
  }, [myName]);

  const tree = treeId ?? mainTree(trees.data)?.id ?? null;
  const count = Math.min(10, Math.max(1, Number(quantity) || 1));
  const price = products.data?.products.find((p) => p.product === product);
  const full = (price?.amount_minor ?? 0) * count;
  const currency = products.data?.currency ?? 'INR';

  const check = useMutation({
    mutationFn: () => api.rpc<CouponQuote>('coupon_quote', { p_code: code.trim(), p_product: product, p_amount_minor: full, p_currency: currency }),
    onSuccess: setQuote,
    onError: () => setQuote(null),
  });

  const pay = useMutation({
    mutationFn: () =>
      startOrder(
        {
          product,
          tree_id: tree ?? undefined,
          quantity: count,
          shipping: products.data?.needs_address ? { ...address, line2: address.line2 || undefined } : undefined,
          coupon: quote ? quote.code : undefined,
        },
        { description: t(`ops.shop.products.${product}`), methodLabel: t('ops.shop.pay') },
      ),
    // 'bought' only comes from an in-app store purchase; it ends the same way as a started order.
    onSuccess: (result) => setState(result === 'bought' ? 'started' : result),
  });

  const needsAddress = !!products.data?.needs_address;
  const addressOk =
    !needsAddress ||
    (address.name.trim() && address.line1.trim() && address.city.trim() && address.state.trim() && /^\d{6}$/.test(address.postal_code.trim()) && !!toE164(address.phone));
  // Typed but not right yet: outlined in red, so it is clear why Pay is still grey.
  const pinBad = !!address.postal_code.trim() && !/^\d{6}$/.test(address.postal_code.trim());
  const phoneBad = !!address.phone.trim() && !toE164(address.phone);
  const set = (key: keyof ShippingAddress) => (value: string) => setAddress((old) => ({ ...old, [key]: value }));

  if (state === 'started') {
    return (
      <Page title={t('ops.shop.title')}>
        <Card style={styles.block}>
          <SectionTitle>{t('ops.shop.thanksTitle')}</SectionTitle>
          <Note>{t('ops.shop.thanks')}</Note>
          <PrimaryButton label={t('ops.orders.title')} onPress={() => router.replace('/orders')} />
        </Card>
      </Page>
    );
  }

  return (
    <Page title={t('ops.shop.title')} subtitle={t('ops.shop.subtitle')}>
      <Gate query={products}>
        {(data) => (
          <>
            <Pills
              options={data.products.filter((p) => p.physical).map((p) => ({ value: p.product, label: `${t(`ops.shop.products.${p.product}`)} · ${formatMoney(p.amount_minor, data.currency, i18n.language)}` }))}
              value={product}
              onChange={(p) => {
                setProduct(p);
                setQuote(null);
              }}
            />
            <Note>{t(`ops.shop.about.${product}`)}</Note>

            {(trees.data ?? []).length > 1 ? (
              <>
                <SectionTitle>{t('ops.shop.whichTree')}</SectionTitle>
                <Pills options={(trees.data ?? []).map((tr) => ({ value: tr.id, label: tr.name }))} value={tree} onChange={setTreeId} />
              </>
            ) : null}

            <Field label={t('ops.shop.quantity')} value={quantity} onChangeText={(v) => { setQuantity(v.replace(/\D/g, '').slice(0, 2)); setQuote(null); }} keyboardType="number-pad" />

            {needsAddress ? (
              <Card style={styles.block}>
                <SectionTitle>{t('ops.shop.address')}</SectionTitle>
                <Field label={t('ops.shop.name')} value={address.name} onChangeText={set('name')} maxLength={120} autoComplete="name" />
                <Field label={t('ops.shop.line1')} value={address.line1} onChangeText={set('line1')} maxLength={200} autoComplete="street-address" />
                <Field label={t('ops.shop.line2')} value={address.line2 ?? ''} onChangeText={set('line2')} maxLength={200} />
                <Field label={t('ops.shop.city')} value={address.city} onChangeText={set('city')} maxLength={100} />
                <Field label={t('ops.shop.state')} value={address.state} onChangeText={set('state')} maxLength={100} />
                <Field label={t('ops.shop.pin')} value={address.postal_code} onChangeText={set('postal_code')} maxLength={6} keyboardType="number-pad" autoComplete="postal-code" invalid={pinBad} />
                <PhoneField label={t('ops.shop.phone')} value={address.phone} onChangeText={set('phone')} autoComplete="tel" invalid={phoneBad} />
              </Card>
            ) : (
              <Note>{t('ops.shop.addressAbroad')}</Note>
            )}

            <Card style={styles.block}>
              <SectionTitle>{t('ops.shop.coupon')}</SectionTitle>
              <View style={styles.couponRow}>
                <View style={styles.couponField}>
                  <Field value={code} onChangeText={(v) => { setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '')); setQuote(null); }} maxLength={20} placeholder="FAMILY20" accessibilityLabel={t('ops.shop.coupon')} autoCapitalize="characters" />
                </View>
                <SmallButton label={t('ops.shop.apply')} disabled={code.length < 4 || check.isPending || !price} onPress={() => check.mutate()} />
              </View>
              {quote ? <Text style={styles.good}>{t('ops.shop.saved', { amount: formatMoney(quote.discount_minor, currency, i18n.language), title: quote.title })}</Text> : null}
              <ActionError error={check.error} />
            </Card>

            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t('ops.shop.total')}</Text>
              <View style={styles.totalRight}>
                {quote ? <Text style={styles.was}>{formatMoney(full, currency, i18n.language)}</Text> : null}
                <Text style={styles.totalValue}>{formatMoney(quote ? quote.final_minor : full, currency, i18n.language)}</Text>
              </View>
            </View>
            <ActionError error={pay.error} />
            {state === 'cancelled' ? <Note>{t('ops.shop.cancelled')}</Note> : null}
            <PrimaryButton label={t('ops.shop.pay')} disabled={!price || !tree || !addressOk || pay.isPending} onPress={() => pay.mutate()} />
            <Note>{t('ops.shop.secure')}</Note>
          </>
        )}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  couponRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  couponField: { flex: 1 },
  good: { color: '#1F7A4D', fontFamily: fonts.bold, fontSize: 14 },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  totalLabel: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  totalRight: { alignItems: 'flex-end' },
  was: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, textDecorationLine: 'line-through' },
  totalValue: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5 },
});
