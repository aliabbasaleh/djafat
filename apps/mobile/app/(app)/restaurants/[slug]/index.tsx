import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import { ApiClientError, type MenuCategoryWithProducts, type RestaurantDetail } from '@djafat/sdk';
import { Screen } from '../../../../components/Screen';
import { Button } from '../../../../components/Button';
import { api } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/format';

type LoadState = 'loading' | 'ready' | 'error' | 'not-found';

/** `/(app)/restaurants/[slug]` — restaurant detail + menu (Bloc 12, docs/20 §32-§33). Mirrors `apps/web`'s same route: public, no auth. */
export default function RestaurantDetailScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null);
  const [menu, setMenu] = useState<readonly MenuCategoryWithProducts[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [r, m] = await Promise.all([
        api.catalog.getRestaurant(slug),
        api.catalog.getMenu(slug),
      ]);
      setRestaurant(r);
      setMenu(m);
      setState('ready');
    } catch (err) {
      setState(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'error');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <Text style={styles.subtle}>Ce restaurant est introuvable.</Text>
        <Button label="Retour" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (state === 'error' || !restaurant) {
    return (
      <Screen>
        <Text style={styles.subtle}>Impossible de charger ce restaurant.</Text>
        <Button label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }

  const hasProducts = menu.some((c) => c.products.length > 0);

  return (
    <Screen>
      {restaurant.coverUrl && <Image source={{ uri: restaurant.coverUrl }} style={styles.cover} />}
      <Text style={styles.name}>{restaurant.name}</Text>
      <Text style={styles.meta}>
        ⭐ {restaurant.ratingAvg.toFixed(1)}
        {restaurant.ratingCount > 0 ? ` (${restaurant.ratingCount} avis)` : ''} ·{' '}
        {restaurant.prepTimeMin} min
        {restaurant.minOrder.minor !== '0' ? ` · Min. ${formatMoney(restaurant.minOrder)}` : ''}
      </Text>
      {restaurant.description && <Text style={styles.description}>{restaurant.description}</Text>}
      {restaurant.addressText && <Text style={styles.meta}>📍 {restaurant.addressText}</Text>}

      {!hasProducts && (
        <Text style={styles.subtle}>Ce restaurant n’a pas encore publié son menu.</Text>
      )}

      {menu
        .filter((c) => c.products.length > 0)
        .map((category) => (
          <View key={category.id} style={styles.category}>
            <Text style={styles.categoryTitle}>{category.name}</Text>
            {category.products.map((product) => (
              <Pressable
                key={product.id}
                style={styles.product}
                onPress={() =>
                  router.push(`/(app)/restaurants/${restaurant.slug}/products/${product.id}`)
                }
              >
                {product.imageUrl ? (
                  <Image source={{ uri: product.imageUrl }} style={styles.productImage} />
                ) : (
                  <View style={[styles.productImage, styles.productImageFallback]}>
                    <Text style={styles.productImageEmoji}>🍲</Text>
                  </View>
                )}
                <View style={styles.productBody}>
                  <Text style={styles.productName}>{product.name}</Text>
                  {product.description && (
                    <Text style={styles.productDescription} numberOfLines={2}>
                      {product.description}
                    </Text>
                  )}
                  <Text style={styles.productPrice}>{formatMoney(product.price)}</Text>
                  {!product.isAvailable && <Text style={styles.unavailable}>Indisponible</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  cover: {
    width: '100%',
    height: 160,
    borderRadius: tokens.radius.lg,
    marginBottom: tokens.space['3'],
  },
  name: { fontSize: tokens.type.size.display, fontWeight: '700', color: tokens.color.text.primary },
  meta: {
    fontSize: tokens.type.size.small,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['1'],
  },
  description: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginTop: tokens.space['2'],
  },
  category: { marginTop: tokens.space['6'] },
  categoryTitle: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
    marginBottom: tokens.space['2'],
  },
  product: {
    flexDirection: 'row',
    gap: tokens.space['3'],
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space['3'],
    marginBottom: tokens.space['2'],
  },
  productImage: {
    width: 64,
    height: 64,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.bg.surfaceAlt,
  },
  productImageFallback: { alignItems: 'center', justifyContent: 'center' },
  productImageEmoji: { fontSize: 24 },
  productBody: { flex: 1, gap: tokens.space['1'] },
  productName: {
    fontSize: tokens.type.size.h3,
    fontWeight: '600',
    color: tokens.color.text.primary,
  },
  productDescription: { fontSize: tokens.type.size.small, color: tokens.color.text.muted },
  productPrice: {
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  unavailable: { fontSize: tokens.type.size.caption, color: tokens.color.state.warning },
});
