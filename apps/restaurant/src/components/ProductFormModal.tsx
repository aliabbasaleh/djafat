'use client';

import { useEffect, useState } from 'react';
import { Stack } from '@djafat/ui';
import type { ManagementCategory, ManagementProduct } from '@djafat/sdk';
import { Modal, Button, Input, Textarea, Select, Switch, Alert } from '@/components/ui-client';
import { toMinorString } from '@/lib/format';

export interface ProductFormValues {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly priceMinor: string;
  readonly isActive?: boolean;
}

export interface ProductFormModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly product: ManagementProduct | null; // null = creating
  readonly categories: readonly ManagementCategory[];
  readonly defaultCategoryId?: string | undefined;
  readonly currency: string;
  readonly onSubmit: (values: ProductFormValues) => Promise<void>;
}

/**
 * Create/edit a product (Bloc 10, docs/33 §menu). `categoryId` is REQUIRED
 * here (no "no category" option), even though the API accepts omitting it:
 * `listForManagement`/the customer-facing `getMenu` both walk the tree
 * category-first (Bloc 2 behaviour, unchanged by this bloc) — a product with
 * no category would be created successfully, then be invisible on every menu
 * screen including this one. Rather than reproduce that trap in a brand-new
 * UI, every "Nouveau produit" action on the menu page supplies a
 * `defaultCategoryId`. Option groups are managed separately (listed
 * read-only on the menu page) — see docs/33 §dette.
 */
export function ProductFormModal({
  open,
  onClose,
  product,
  categories,
  defaultCategoryId,
  currency,
  onSubmit,
}: ProductFormModalProps) {
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [price, setPrice] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategoryId(product?.categoryId ?? defaultCategoryId ?? '');
      setName(product?.name ?? '');
      setDescription(product?.description ?? '');
      setImageUrl(product?.imageUrl ?? '');
      setPrice(product ? Number(product.price.minor) : 0);
      setIsActive(product?.isActive ?? true);
      setError(null);
    }
  }, [open, product, defaultCategoryId]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...(categoryId ? { categoryId } : {}),
        name,
        description,
        imageUrl,
        priceMinor: toMinorString(price),
        ...(product ? { isActive } : {}),
      });
      onClose();
    } catch {
      setError('Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Modifier le produit' : 'Nouveau produit'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack gap="md">
          {error && <Alert tone="danger">{error}</Alert>}
          <Input
            label="Nom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Select
            label="Catégorie"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label={`Prix (${currency})`}
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            required
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <Input
            label="URL de l’image"
            type="url"
            placeholder="https://…"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          {product && (
            <Switch
              label="Produit actif au catalogue"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          )}
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
