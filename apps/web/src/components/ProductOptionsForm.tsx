'use client';

import { useMemo, useState } from 'react';
import type { Route } from 'next';
import { useRouter, usePathname } from 'next/navigation';
import { ApiClientError, type ProductDetail, type ProductOptionGroup } from '@djafat/sdk';
import { Text, Alert, cx } from '@djafat/ui';
import { Button, Radio, Checkbox } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated } from '@/lib/auth-storage';
import { formatMoneyDelta } from '@/lib/format';
import styles from './ProductOptionsForm.module.css';

const MAX_QUANTITY = 99;

function optionLabel(name: string, priceDelta: Parameters<typeof formatMoneyDelta>[0]): string {
  return `${name} — ${formatMoneyDelta(priceDelta)}`;
}

/**
 * Client-side option/quantity selection + "Ajouter au panier" (docs/22 §4-§6,
 * §17.5). Client-side checks here are UX only — the server re-validates
 * every group/option/quantity rule from scratch and is the only source of
 * truth for whether the add actually succeeds.
 */
export function ProductOptionsForm({ product }: { readonly product: ProductDetail }) {
  const router = useRouter();
  const pathname = usePathname();

  const [selections, setSelections] = useState<Record<string, readonly string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function selectSingle(group: ProductOptionGroup, optionId: string) {
    setSelections((prev) => ({ ...prev, [group.id]: [optionId] }));
  }

  function toggleMultiple(group: ProductOptionGroup, optionId: string, checked: boolean) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (checked) {
        if (current.length >= group.maxSelections) return prev;
        return { ...prev, [group.id]: [...current, optionId] };
      }
      return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
    });
  }

  const missingRequired = useMemo(
    () =>
      product.optionGroups.some(
        (group) => group.isRequired && (selections[group.id]?.length ?? 0) < group.minSelections,
      ),
    [product.optionGroups, selections],
  );

  const selectedOptionIds = useMemo(() => Object.values(selections).flat(), [selections]);

  async function submit(replaceCart: boolean) {
    if (!isAuthenticated()) {
      router.push(`/compte?redirect=${encodeURIComponent(pathname)}` as Route);
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
      window.dispatchEvent(new Event('djafat:cart-changed'));
      router.push('/panier' as Route);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'CART_RESTAURANT_MISMATCH') {
        setMismatch(true);
        return;
      }
      setError("Impossible d'ajouter ce produit au panier. Réessayez dans un instant.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!product.isAvailable) {
    return (
      <Button disabled fullWidth title="Ce produit est indisponible pour le moment">
        Ajouter au panier
      </Button>
    );
  }

  return (
    <div className={cx(styles['form'])}>
      {product.optionGroups.map((group) => (
        <fieldset key={group.id} className={cx(styles['group'])}>
          <legend className={cx(styles['groupLegend'])}>
            {group.name}
            <span className={cx(styles['groupHint'])}>
              {group.isRequired ? ' · Obligatoire' : ' · Facultatif'}
              {group.selectionType === 'multiple' && ` · jusqu'à ${group.maxSelections} choix`}
            </span>
          </legend>
          <div className={cx(styles['optionList'])}>
            {group.options.map((option) => {
              const checked = (selections[group.id] ?? []).includes(option.id);
              return group.selectionType === 'single' ? (
                <Radio
                  key={option.id}
                  name={group.id}
                  label={optionLabel(option.name, option.priceDelta)}
                  checked={checked}
                  disabled={!option.isAvailable}
                  onChange={() => selectSingle(group, option.id)}
                />
              ) : (
                <Checkbox
                  key={option.id}
                  name={group.id}
                  label={optionLabel(option.name, option.priceDelta)}
                  checked={checked}
                  disabled={!option.isAvailable}
                  onChange={(e) => toggleMultiple(group, option.id, e.target.checked)}
                />
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className={cx(styles['quantityRow'])}>
        <Text weight="medium">Quantité</Text>
        <div className={cx(styles['stepper'])}>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Diminuer la quantité"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            −
          </Button>
          <span className={cx(styles['quantityValue'])} aria-live="polite">
            {quantity}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Augmenter la quantité"
            disabled={quantity >= MAX_QUANTITY}
            onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
          >
            +
          </Button>
        </div>
      </div>

      {mismatch && (
        <Alert tone="warning" title="Votre panier contient un autre restaurant">
          <span className={cx(styles['mismatchBody'])}>
            Ajouter ce produit videra votre panier actuel.
            <Button size="sm" loading={submitting} onClick={() => void submit(true)}>
              Remplacer le panier
            </Button>
          </span>
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <Button
        fullWidth
        loading={submitting}
        disabled={missingRequired}
        onClick={() => void submit(false)}
      >
        Ajouter au panier
      </Button>
    </div>
  );
}
