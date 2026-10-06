import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { RestaurantListItem } from '@djafat/sdk';
import { Screen } from '../../../components/Screen';
import { Button } from '../../../components/Button';
import { api } from '../../../lib/api';

type LoadState = 'loading' | 'ready' | 'error';

const AVAILABILITY_LABEL: Record<string, string> = {
  OPEN: 'Ouvert',
  CLOSED: 'Fermé',
  PAUSED: 'En pause',
  UNAVAILABLE: 'Indisponible',
};

/**
 * `/(app)/restaurants` — catalog home (Bloc 12, docs/20 §26-§30). Public,
 * no auth required — mirrors `apps/web`'s `/restaurants` exactly (same
 * `api.catalog.listRestaurants` call), minus server-side search/sort/
 * pagination UI for this first vertical slice (listed as debt).
 */
export default function RestaurantsScreen() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<readonly RestaurantListItem[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await api.catalog.listRestaurants({ limit: 30 });
      setItems(result.items);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>DJAFAT</Text>
        <Button label="Panier" variant="secondary" onPress={() => router.push('/(app)/cart')} />
      </View>

      {state === 'loading' && <Text style={styles.subtle}>Chargement…</Text>}
      {state === 'error' && (
        <View>
          <Text style={styles.subtle}>Impossible de charger les restaurants.</Text>
          <Button label="Réessayer" onPress={() => void load()} />
        </View>
      )}
      {state === 'ready' && items.length === 0 && (
        <Text style={styles.subtle}>Aucun restaurant disponible pour le moment.</Text>
      )}

      {state === 'ready' && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/(app)/restaurants/${item.slug}`)}
            >
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverFallback]}>
                  <Text style={styles.coverFallbackEmoji}>🍽️</Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {AVAILABILITY_LABEL[item.availability] ?? item.availability} · ⭐{' '}
                  {item.ratingAvg.toFixed(1)} · {item.prepTimeMin} min
                </Text>
                {item.description && (
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['4'],
  },
  title: {
    fontSize: tokens.type.size.display,
    fontWeight: '700',
    color: tokens.color.brand.primary,
  },
  subtle: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.secondary,
    marginBottom: tokens.space['4'],
  },
  list: { gap: tokens.space['4'], paddingBottom: tokens.space['6'] },
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
  },
  cover: { width: '100%', height: 140, backgroundColor: tokens.color.bg.surfaceAlt },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverFallbackEmoji: { fontSize: 40 },
  cardBody: { padding: tokens.space['4'], gap: tokens.space['1'] },
  cardName: { fontSize: tokens.type.size.h2, fontWeight: '700', color: tokens.color.text.primary },
  cardMeta: { fontSize: tokens.type.size.small, color: tokens.color.text.secondary },
  cardDescription: { fontSize: tokens.type.size.small, color: tokens.color.text.muted },
});
