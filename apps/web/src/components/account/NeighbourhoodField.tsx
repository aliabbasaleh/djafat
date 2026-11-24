'use client';

import { Input, Select } from '@/components/ui-client';
import { OTHER_NEIGHBOURHOOD } from '@/lib/account';
import styles from './account.module.css';

export interface NeighbourhoodOption {
  readonly id: string;
  readonly name: string;
}

/**
 * « Quartier » (SPEC-022-02 « UI », SPEC-022-09): the list of N'Djamena, then
 * « Autre », which opens a field for the name. `options` is `null` while the
 * list loads, or when it could not be read — « Autre » still works.
 */
export function NeighbourhoodField({
  label,
  options,
  value,
  other,
  error,
  otherError,
  onChange,
  onOtherChange,
}: {
  readonly label: string;
  readonly options: readonly NeighbourhoodOption[] | null;
  readonly value: string;
  readonly other: string;
  readonly error?: string | undefined;
  readonly otherError?: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onOtherChange: (value: string) => void;
}) {
  return (
    <>
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(error ? { 'aria-invalid': true } : {})}
      >
        <option value="">{options ? '— Choisir —' : 'Chargement…'}</option>
        {(options ?? []).map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
        <option value={OTHER_NEIGHBOURHOOD}>Autre</option>
      </Select>
      {error && (
        <p role="alert" className={styles['fieldError']}>
          {error}
        </p>
      )}
      {value === OTHER_NEIGHBOURHOOD && (
        <Input
          label="Nom du quartier"
          value={other}
          maxLength={60}
          onChange={(e) => onOtherChange(e.target.value)}
          {...(otherError ? { error: otherError } : {})}
          required
        />
      )}
    </>
  );
}
