'use client';

import { useEffect, useState } from 'react';
import { Stack } from '@djafat/ui';
import type { ManagementCategory } from '@djafat/sdk';
import { Modal, Button, Input, Textarea, Switch, Alert } from '@/components/ui-client';

export interface CategoryFormValues {
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly isActive?: boolean;
}

export interface CategoryFormModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly category: ManagementCategory | null; // null = creating
  readonly onSubmit: (values: CategoryFormValues) => Promise<void>;
}

/** Create/edit a menu category (Bloc 10, docs/33 §menu). */
export function CategoryFormModal({ open, onClose, category, onSubmit }: CategoryFormModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? '');
      setDescription(category?.description ?? '');
      setImageUrl(category?.imageUrl ?? '');
      setIsActive(category?.isActive ?? true);
      setError(null);
    }
  }, [open, category]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name,
        description,
        imageUrl,
        ...(category ? { isActive } : {}),
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
      title={category ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
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
          {category && (
            <Switch
              label="Catégorie active"
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
