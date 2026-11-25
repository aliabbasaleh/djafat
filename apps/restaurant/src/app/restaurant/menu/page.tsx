'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type ManagementCategory, type ManagementProduct } from '@djafat/sdk';
import {
  Heading,
  Text,
  Stack,
  Inline,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  cx,
} from '@djafat/ui';
import { Button, Switch } from '@/components/ui-client';
import { CategoryFormModal, type CategoryFormValues } from '@/components/CategoryFormModal';
import { ProductFormModal, type ProductFormValues } from '@/components/ProductFormModal';
import { StepBackLink } from '@/components/StepBackLink';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Menu management (Bloc 10, docs/33 §menu) — categories, products, quick
 * availability toggle. Both `restaurant_owner` and `restaurant_staff` hold
 * `menus:write` (seed, docs/19), so this page is NOT owner-gated the way
 * `/profile` and `/hours` are. Option groups are intentionally READ-ONLY
 * here (listed under each product) — see docs/33 §dette for why their full
 * create/edit UI was left for a follow-up.
 */
export default function MenuPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('XAF');
  const [categories, setCategories] = useState<ManagementCategory[]>([]);

  const [categoryModal, setCategoryModal] = useState<{
    open: boolean;
    category: ManagementCategory | null;
  }>({
    open: false,
    category: null,
  });
  const [productModal, setProductModal] = useState<{
    open: boolean;
    product: ManagementProduct | null;
    defaultCategoryId?: string;
  }>({ open: false, product: null });

  const handleUnauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return true;
      }
      return false;
    },
    [router],
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [profile, menu] = await Promise.all([
        api.restaurant.getMine(),
        api.restaurant.getMenu(),
      ]);
      setRestaurantId(profile.id);
      setCurrency(profile.currency);
      setCategories([...menu]);
      setState('ready');
    } catch (err) {
      if (handleUnauthorized(err)) return;
      setState('error');
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitCategory(values: CategoryFormValues) {
    try {
      if (categoryModal.category) {
        await api.restaurant.categories.update(categoryModal.category.id, values);
      } else if (restaurantId) {
        await api.restaurant.categories.create(restaurantId, values);
      }
      await load();
    } catch (err) {
      if (handleUnauthorized(err)) return;
      throw err;
    }
  }

  async function submitProduct(values: ProductFormValues) {
    try {
      if (productModal.product) {
        await api.restaurant.products.update(productModal.product.id, values);
      } else if (restaurantId) {
        await api.restaurant.products.create(restaurantId, values);
      }
      await load();
    } catch (err) {
      if (handleUnauthorized(err)) return;
      throw err;
    }
  }

  async function toggleAvailability(product: ManagementProduct) {
    try {
      await api.restaurant.products.setAvailability(product.id, !product.isAvailable);
      await load();
    } catch (err) {
      if (handleUnauthorized(err)) return;
      await load();
    }
  }

  if (state === 'loading') {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement du menu">
        <Skeleton height={40} />
        <Skeleton height={400} radius="8px" />
      </Stack>
    );
  }
  if (state === 'error') {
    return (
      <ErrorState
        title="Impossible de charger le menu"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <StepBackLink />
      <Inline justify="between" align="center" wrap>
        <Heading level={1}>Menu</Heading>
        <Button
          size="sm"
          disabled={!restaurantId}
          onClick={() => setCategoryModal({ open: true, category: null })}
        >
          + Nouvelle catégorie
        </Button>
      </Inline>

      {categories.length === 0 && (
        <EmptyState
          icon="🍽️"
          title="Aucune catégorie"
          message="Créez une première catégorie pour commencer à ajouter des produits."
        />
      )}

      {categories.map((category) => (
        <section key={category.id} className={cx(styles['category'])}>
          <Inline justify="between" align="center" wrap>
            <Inline gap="sm" align="center">
              <Heading level={2} size="h3">
                {category.name}
              </Heading>
              {!category.isActive && <Badge tone="neutral">Inactive</Badge>}
            </Inline>
            <Inline gap="sm">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCategoryModal({ open: true, category })}
              >
                Modifier
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setProductModal({ open: true, product: null, defaultCategoryId: category.id })
                }
              >
                + Produit
              </Button>
            </Inline>
          </Inline>

          {category.products.length === 0 ? (
            <Text size="small" tone="muted">
              Aucun produit dans cette catégorie.
            </Text>
          ) : (
            <div className={cx(styles['productGrid'])}>
              {category.products.map((product) => (
                <div key={product.id} className={cx(styles['productCard'])}>
                  <Inline justify="between" align="start">
                    <Stack gap="xs">
                      <Text weight="semibold">{product.name}</Text>
                      <Text size="small" tone="secondary">
                        {formatMoney(product.price)}
                      </Text>
                    </Stack>
                    {!product.isActive && <Badge tone="neutral">Inactif</Badge>}
                  </Inline>

                  {product.optionGroups.length > 0 && (
                    <Stack gap="xs" className={cx(styles['optionGroups'])}>
                      {product.optionGroups.map((group) => (
                        <Text key={group.id} size="caption" tone="muted">
                          {group.name} : {group.options.map((o) => o.name).join(', ')}
                        </Text>
                      ))}
                    </Stack>
                  )}

                  <Inline justify="between" align="center">
                    <Switch
                      label="Disponible"
                      checked={product.isAvailable}
                      onChange={() => void toggleAvailability(product)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProductModal({ open: true, product })}
                    >
                      Modifier
                    </Button>
                  </Inline>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      <CategoryFormModal
        open={categoryModal.open}
        category={categoryModal.category}
        onClose={() => setCategoryModal({ open: false, category: null })}
        onSubmit={submitCategory}
      />
      <ProductFormModal
        open={productModal.open}
        product={productModal.product}
        defaultCategoryId={productModal.defaultCategoryId}
        categories={categories}
        currency={currency}
        onClose={() => setProductModal({ open: false, product: null })}
        onSubmit={submitProduct}
      />
    </Stack>
  );
}
