'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Heading, Stack, Text } from '@djafat/ui';
import { Alert, Button, Checkbox, Input } from '@/components/ui-client';
import { RESEND_COOLDOWN_SECONDS } from '@/lib/account';
import styles from './account.module.css';

interface CodeStepProps {
  readonly title: string;
  /** e.g. « Entrez le code à 6 chiffres envoyé à a***@gmail.com (valable 5 min). » */
  readonly intro: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly submitLabel?: string | undefined;
  /** New device only (FEAT-020-VIS03): « Se souvenir de cet appareil ». */
  readonly remember?:
    | { readonly checked: boolean; readonly onChange: (v: boolean) => void }
    | undefined;
  /** Shown above the code (the channel choice of a new device). */
  readonly before?: ReactNode;
  /** Shown under the code (the new password of a reset). */
  readonly children?: ReactNode;
  readonly onSubmit: (code: string) => void;
  readonly onResend?: (() => Promise<void>) | undefined;
  readonly onBack: () => void;
}

/**
 * The code step (FEAT-020-VIS03): registration, new device, code-only login,
 * forgotten password. « Renvoyer le code » waits 60 s between two sends.
 */
export function CodeStep(props: CodeStepProps) {
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function resend() {
    if (!props.onResend || wait > 0) return;
    await props.onResend();
    setWait(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <form
      className={styles['panel']}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(code.trim());
      }}
    >
      <Stack gap="xs">
        <Heading level={2}>{props.title}</Heading>
        <Text tone="secondary">{props.intro}</Text>
      </Stack>
      {props.before}
      {props.error && <Alert tone="danger">{props.error}</Alert>}
      <Input
        label="Code à 6 chiffres"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        autoFocus
        required
      />
      {props.children}
      {props.remember && (
        <Checkbox
          label="Se souvenir de cet appareil"
          checked={props.remember.checked}
          onChange={(e) => props.remember?.onChange(e.target.checked)}
        />
      )}
      <Button type="submit" loading={props.busy} fullWidth>
        {props.submitLabel ?? 'Vérifier'}
      </Button>
      {props.onResend && (
        <button
          type="button"
          className={styles['linkButton']}
          disabled={wait > 0}
          onClick={() => void resend()}
        >
          {wait > 0 ? `Renvoyer le code (dans ${wait} s)` : 'Renvoyer le code'}
        </button>
      )}
      <Button type="button" variant="ghost" fullWidth onClick={props.onBack}>
        Retour
      </Button>
    </form>
  );
}
