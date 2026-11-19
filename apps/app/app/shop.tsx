// Shop: a printed family tree poster or a family book, sent home. Prices come from the server; a coupon is checked
// by the server too. Payment happens on Razorpay's or Stripe's own page; card details never reach AYWO.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { PhoneField } from '@/components/PhoneField';
import { Text } from '@/components/Text';
import { Card, Field, Label, Pills, PrimaryButton, SectionTitle, SmallButton } from '@/components/ui';
import { toE164 } from '@/lib/phone';
import { ApiFailure, api, deviceStore } from '@/lib/api';
import { mainTree, useMe, useTrees } from '@/lib/account';
import { startOrder } from '@/pay/order';
import type { ShippingAddress } from '@/pay/order';
import { ProductCard, ProductRow } from '@/ops/ProductPicture';
import { formatMoney } from '@/ops/types';
import type { CouponQuote, Product, Products } from '@/ops/types';
import { ActionError, Gate, Note, Page } from '@/social/parts';
import { colors, fonts } from '@/theme/tokens';

// The last delivery address, kept on this phone only, so a second order does not start from empty boxes.
const LAST_ADDRESS = 'aywo.lastAddress';

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
  const [count, setCount] = useState(1);
  const [address, setAddress] = useState<ShippingAddress>({ ...EMPTY, name: me.data?.display_name ?? '' });
  // Their name and sign-in number are the delivery name and phone unless they change them; filled in once the
  // account loads (it may still be loading on the first render), never over something typed.
  useEffect(() => {
    const ownName = me.data?.display_name ?? '';
    const ownPhone = me.data?.login_phone ?? '';
    setAddress((a) => ({ ...a, name: a.name || ownName, phone: a.phone || ownPhone }));
  }, [me.data?.display_name, me.data?.login_phone]);
  useEffect(() => {
    void deviceStore
      .get(LAST_ADDRESS)
      .then((raw) => {
        const last = raw ? (JSON.parse(raw) as Partial<ShippingAddress>) : null;
        if (!last) return;
        // Only into boxes still empty: never over something already typed.
        setAddress((a) => ({
          ...a,
          line1: a.line1 || last.line1 || '',
          line2: a.line2 || last.line2 || '',
          city: a.city || last.city || '',
          state: a.state || last.state || '',
          postal_code: a.postal_code || last.postal_code || '',
        }));
      })
      .catch(() => undefined);
  }, []);
  const [code, setCode] = useState((params.coupon ?? '').toUpperCase());
  const [quote, setQuote] = useState<CouponQuote | null>(null);
  // The code the person asked to use: by tapping Apply, or by arriving from "Use it" on an offer. It is checked again
  // whenever the product or the number changes, so the discount is never dropped without a word.
  const [applied, setApplied] = useState<string | null>(params.coupon ? params.coupon.toUpperCase() : null);
  // 'unconfirmed': the payment page was closed and the server has seen no payment (see pay/order.ts).
  const [state, setState] = useState<'idle' | 'started' | 'cancelled' | 'unconfirmed'>('idle');
  const orderId = useRef<string | null>(null);
  // The account loads after the first render; its name fills an empty name box once.
  const myName = me.data?.display_name;
  useEffect(() => {
    if (myName) setAddress((old) => (old.name ? old : { ...old, name: myName }));
  }, [myName]);

  const tree = treeId ?? mainTree(trees.data)?.id ?? null;
  const price = products.data?.products.find((p) => p.product === product);
  const full = (price?.amount_minor ?? 0) * count;
  const currency = products.data?.currency ?? 'INR';

  const check = useMutation({
    mutationFn: (input: { code: string; product: Product; amount: number }) =>
      api.rpc<CouponQuote>('coupon_quote', { p_code: input.code, p_product: input.product, p_amount_minor: input.amount, p_currency: currency }),
    // An answer for an older product or number must not show against the new total.
    onSuccess: (answer, input) => {
      if (input.code === applied && input.product === product && input.amount === full) setQuote(answer);
    },
    onError: () => setQuote(null),
  });
  const checkCoupon = check.mutate;
  useEffect(() => {
    if (applied && full > 0) checkCoupon({ code: applied, product, amount: full });
  }, [applied, product, full, currency, checkCoupon]);

  const pay = useMutation({
    mutationFn: () =>
      startOrder(
        {
          product,
          tree_id: tree ?? undefined,
          quantity: count,
          shipping: products.data?.needs_address ? { ...address, line2: address.line2 || undefined } : undefined,
          coupon: quote ? quote.code : undefined,
          expected_unit_minor: price?.amount_minor,
        },
        { description: t(`ops.shop.products.${product}`), methodLabel: t('ops.shop.pay') },
        { onOrder: (id) => { orderId.current = id; } },
      ),
    onMutate: () => {
      setState('idle');
      if (products.data?.needs_address) {
        void deviceStore
          .set(LAST_ADDRESS, JSON.stringify({ line1: address.line1, line2: address.line2, city: address.city, state: address.state, postal_code: address.postal_code }))
          .catch(() => undefined);
      }
    },
    // Staff changed the price while this page was open: fetch the new one, so the total on screen is the real one.
    onError: (error) => {
      if (error instanceof ApiFailure && error.code === 'price_changed') {
        setQuote(null);
        void products.refetch();
      }
    },
    onSuccess: (result) => {
      // The server already shows it as paid: straight to My orders, which says so.
      if (result === 'paid') router.replace({ pathname: '/orders', params: { paid: '1', ...(orderId.current ? { order: orderId.current } : {}) } });
      // 'bought' only comes from an in-app store purchase; it ends the same way as a started order.
      else setState(result === 'bought' ? 'started' : result);
    },
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
          <PrimaryButton
            label={t('ops.orders.title')}
            onPress={() => router.replace({ pathname: '/orders', params: { paid: '1', ...(orderId.current ? { order: orderId.current } : {}) } })}
          />
        </Card>
      </Page>
    );
  }

  // What is still needed before Pay works, said under the button instead of leaving it grey without a reason.
  const missing = !price
    ? null
    : !tree
      ? t('ops.shop.needTree')
      : !needsAddress || addressOk
        ? null
        : pinBad
          ? t('ops.shop.needPin')
          : phoneBad
            ? t('ops.shop.needPhone')
            : t('ops.shop.needAddress');

  return (
    <Page title={t('ops.shop.title')} subtitle={t('ops.shop.subtitle')}>
      <Gate query={products}>
        {(data) => (
          <>
            {/* Each thing on sale as a card with its picture, so it is clear what is being bought. */}
            <View accessibilityRole="radiogroup">
              <ProductRow>
                {data.products
                  .filter((p) => p.physical)
                  .map((p) => (
                    <ProductCard
                      key={p.product}
                      product={p.product}
                      image={p.images?.[0]}
                      price={formatMoney(p.amount_minor, data.currency, i18n.language)}
                      on={product === p.product}
                      onPress={() => {
                        setProduct(p.product);
                        setQuote(null);
                      }}
                    />
                  ))}
              </ProductRow>
            </View>
            {/* More pictures of the chosen product, when staff added more than one. */}
            {(price?.images?.length ?? 0) > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
                {(price?.images ?? []).slice(1).map((uri) => (
                  <Image key={uri} source={{ uri }} resizeMode="cover" accessibilityLabel={t(`ops.shop.products.${product}`)} style={styles.galleryPicture} />
                ))}
              </ScrollView>
            ) : null}

            {(trees.data ?? []).length > 1 ? (
              <>
                <SectionTitle>{t('ops.shop.whichTree')}</SectionTitle>
                <Pills options={(trees.data ?? []).map((tr) => ({ value: tr.id, label: tr.name }))} value={tree} onChange={setTreeId} />
              </>
            ) : null}

            <View style={styles.block}>
              <Label>{t('ops.shop.quantity')}</Label>
              <View style={styles.stepper}>
                <SmallButton kind="plain" label="−" accessibilityLabel={t('ops.shop.fewer')} disabled={count <= 1} onPress={() => { setCount(count - 1); setQuote(null); }} />
                <Text accessibilityLiveRegion="polite" style={styles.count}>{count}</Text>
                <SmallButton kind="plain" label="+" accessibilityLabel={t('ops.shop.more')} disabled={count >= 10} onPress={() => { setCount(count + 1); setQuote(null); }} />
              </View>
            </View>

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
                  <Field value={code} onChangeText={(v) => { setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '')); setQuote(null); setApplied(null); check.reset(); }} maxLength={20} placeholder={t('ops.shop.couponPlaceholder')} accessibilityLabel={t('ops.shop.coupon')} autoCapitalize="characters" />
                </View>
                <SmallButton label={t('ops.shop.apply')} disabled={code.length < 4 || check.isPending || !price} onPress={() => (applied === code ? checkCoupon({ code, product, amount: full }) : setApplied(code))} />
              </View>
              {quote ? <Text style={styles.good}>{t('ops.shop.saved', { amount: formatMoney(quote.discount_minor, currency, i18n.language), title: quote.title })}</Text> : null}
              {applied && check.isPending ? <Note>{t('ops.shop.checkingCoupon')}</Note> : null}
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
            {state === 'unconfirmed' ? (
              <Card style={styles.block}>
                <SectionTitle>{t('ops.shop.notPaidTitle')}</SectionTitle>
                <View accessibilityLiveRegion="polite">
                  <Note>{t('ops.shop.notPaid')}</Note>
                </View>
                <SmallButton kind="plain" label={t('ops.shop.seeOrders')} onPress={() => router.push('/orders')} />
              </Card>
            ) : null}
            <PrimaryButton
              label={pay.isPending ? t('ops.shop.paying') : state === 'unconfirmed' ? t('ops.shop.payAgain') : t('ops.shop.pay')}
              disabled={!price || pay.isPending || (!!applied && check.isPending)}
              missing={pay.isPending ? null : missing}
              onPress={() => pay.mutate()}
            />
            <Note>{t('ops.shop.secure')}</Note>
          </>
        )}
      </Gate>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  gallery: { gap: 10 },
  galleryPicture: { width: 150, height: 110, borderRadius: 14, backgroundColor: colors.tint },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  count: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 20, minWidth: 28, textAlign: 'center' },
  couponRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  couponField: { flex: 1 },
  good: { color: colors.good, fontFamily: fonts.bold, fontSize: 14 },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  totalLabel: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  totalRight: { alignItems: 'flex-end' },
  was: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13, textDecorationLine: 'line-through' },
  totalValue: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -0.5 },
});
