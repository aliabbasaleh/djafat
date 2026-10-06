import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { ApiClientError, type ProductDetail, type ProductOptionGroup } from '@djafat/sdk';
import { Screen } from '../../../../../components/Screen';
import { Button } from '../../../../../components/Button';
import { Stepper } from '../../../../../components/Stepper';
import { api } from '../../../../../lib/api';
import { useAuth } from '../../../../../lib/auth-context';
import { formatMoney, formatMoneyDelta } from '../../../../../lib/format';

type LoadState = 'loading' | 'ready' | 'error' | 'not-found';
const MAX_QUANTITY = 99;

/**
 * `/(app)/restaurants/[slug]/products/[productId]` — option/quantity
 * selection + "Ajouter au panier" (Bloc 12, docs/22 §4-§6). Mirrors
 * `apps/web`'s `ProductOptionsForm` logic exactly: client-side checks are UX
 * only, the server re-validates every group/option/quantity rule from
 * scratch (same `CART_RESTAURANT_MISMATCH` handling).
 */
export default function ProductDetailScreen() {
  const router = useRouter();
  const { slug, productId } = useLocalSearchParams<{ slug: string; productId: string }>();
  const { state: authState } = useAuth();

  const [state, setState] = useState<LoadState>('loading');
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selections, setSelections] = useState<Record<string, readonly string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const p = await api.catalog.getProduct(productId);
      if (p.restaurantId && slug) {
        // Belt-and-suspenders, same check `apps/web` makes — a mismatched
        // slug/productId pair (stale link) is treated as not-found.
        const restaurant = await api.catalog.getRestaurant(slug).catch(() => null);
        if (restaurant && p.restaurantId !== restaurant.id) {
          setState('not-found');
          return;
        }
      }
      setProduct(p);
      setState('ready');
    } catch (err) {
      setState(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'error');
    }
  }, [productId, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function selectSingle(group: ProductOptionGroup, optionId: string) {
    setSelections((prev) => ({ ...prev, [group.id]: [optionId] }));
  }

  function toggleMultiple(group: ProductOptionGroup, optionId: string) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= group.maxSelections) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  const missingRequired = useMemo(
    () =>
      (product?.optionGroups ?? []).some(
        (group) => group.isRequired && (selections[group.id]?.length ?? 0) < group.minSelections,
      ),
    [product, selections],
  );
  const selectedOptionIds = useMemo(() => Object.values(selections).flat(), [selections]);

  async function submit(replaceCart: boolean) {
    if (!product) return;
    if (authState !== 'signed-in') {
      router.push(
        `/(auth)/login?redirect=${encodeURIComponent(`/(app)/restaurants/${slug}/products/${productId}`)}` as `/${string}`,
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.cart.addItem({
        productId: product.id,
        quantity,
        selectedOptionIds,
        ...(replaceCart ? { replaceCart: true } : {}),
      });
      setMismatch(false);
      router.push('/(app)/cart');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'CART_RESTAURANT_MISMATCH') {
        setMismatch(true);
        return;
      }
      setError("Impossible d'ajouter ce produit au panier. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <Screen>
        <Text style={styles.subtle}>Chargement…</Text>
      </Screen>
    );
  }
  if (state === 'not-found') {
    return (
      <Screen>
        <Text style={styles.subtle}>Ce produit est introuvable.</Text>
        <Button label="Retour" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (state === 'error' || !product) {
    return (
      <Screen>
        <Text style={styles.subtle}>Impossible de charger ce produit.</Text>
        <Button label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }

  return (
    <Screen>
      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.image} />
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          <Text style={styles.imageEmoji}>🍲</Text>
        </View>
      )}

      <Text style={styles.name}>{product.name}</Text>
      {product.description && <Text style={styles.description}>{product.description}</Text>}
      <Text style={styles.price}>{formatMoney(product.price)}</Text>

      {!product.isAvailable && <Text style={styles.unavailable}>Indisponible pour le moment</Text>}

      {product.isAvailable && (
        <>
          {product.optionGroups.map((group) => (
            <View key={group.id} style={styles.group}>
              <Text style={styles.groupTitle}>
                {group.name}
                <Text style={styles.groupHint}>
                  {group.isRequired ? ' · Obligatoire' : ' · Facultatif'}
                  {group.selectionType === 'multiple' ? ` · jusqu'à ${group.maxSelections}` : ''}
                </Text>
              </Text>
              {group.options.map((option) => {
                const checked = (selections[group.id] ?? []).includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    disabled={!option.isAvailable}
                    onPress={() =>
                      group.selectionType === 'single'
                        ? selectSingle(group, option.id)
                        : toggleMultiple(group, option.id)
                    }
                    style={[styles.option, !option.isAvailable && styles.optionDisabled]}
                  >
                    <View style={[styles.optionMark, checked && styles.optionMarkChecked]} />
                    <Text style={styles.optionLabel}>
                      {option.name} — {formatMoneyDelta(option.priceDelta)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.quantityRow}>
            <Text style={styles.quantityLabel}>Quantité</Text>
            <Stepper value={quantity} onChange={setQuantity} max={MAX_QUANTITY} />
          </View>

          {mismatch && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                Votre panier contient un autre restaurant. Ajouter ce produit le videra.
              </Text>
              <Button
                label="Remplacer le panier"
                loading={submitting}
                onPress={() => void submit(true)}
              />
            </View>
          )}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Button
            label="Ajouter au panier"
            fullWidth
            loading={submitting}
            disabled={missingRequired}
            onPress={() => void submit(false)}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.color.bg.surfaceAlt,
  },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  imageEmoji: { fontSize: 48 },
  name: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.text.primary,
    marginTop: tokens.space['3'],
  },
  description: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['2'],
  },
  price: {
    fontSize: tokens.type.size.h1,
    fontWeight: '700',
    color: tokens.color.brand.primary,
    marginTop: tokens.space['2'],
  },
  unavailable: {
    fontSize: tokens.type.size.body,
    color: tokens.color.state.warning,
    marginTop: tokens.space['3'],
  },
  group: { marginTop: tokens.space['5'] },
  groupTitle: {
    fontSize: tokens.type.size.h3,
    fontWeight: '600',
    color: tokens.color.text.primary,
    marginBottom: tokens.space['2'],
  },
  groupHint: {
    fontSize: tokens.type.size.caption,
    fontWeight: '400',
    color: tokens.color.text.muted,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['3'],
    paddingVertical: tokens.space['2'],
  },
  optionDisabled: { opacity: 0.4 },
  optionMark: {
    width: 20,
    height: 20,
    borderRadius: tokens.radius.pill,
    borderWidth: 2,
    borderColor: tokens.color.border.strong,
  },
  optionMarkChecked: {
    backgroundColor: tokens.color.brand.primary,
    borderColor: tokens.color.brand.primary,
  },
  optionLabel: { fontSize: tokens.type.size.body, color: tokens.color.text.primary },
  quantityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: tokens.space['5'],
  },
  quantityLabel: {
    fontSize: tokens.type.size.h3,
    fontWeight: '600',
    color: tokens.color.text.primary,
  },
  warningBox: {
    backgroundColor: tokens.color.state.warningBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginTop: tokens.space['4'],
    gap: tokens.space['2'],
  },
  warningText: { fontSize: tokens.type.size.body, color: tokens.color.state.warning },
  errorBox: {
    backgroundColor: tokens.color.state.dangerBg,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginTop: tokens.space['4'],
  },
  errorText: { color: tokens.color.state.danger, fontSize: tokens.type.size.body },
});
