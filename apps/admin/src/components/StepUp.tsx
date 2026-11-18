'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Inline, Stack, Text } from '@djafat/ui';
import { Alert, Button, Input, Modal } from '@/components/ui-client';
import { api } from '@/lib/api';
import { runWithStepUp, type AskCode, type StepUpProblem } from '@/lib/step-up-flow';

type RunWithStepUp = <T>(action: () => Promise<T>) => Promise<T>;

const StepUpContext = createContext<RunWithStepUp | null>(null);

const PROBLEM_TEXT: Record<StepUpProblem, string> = {
  'invalid-code': 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.',
  'not-enrolled': 'La double authentification n’est pas encore activée sur votre compte.',
  'rate-limited': 'Trop d’essais. Attendez quelques minutes avant de réessayer.',
  error: 'La vérification n’a pas abouti. Réessayez.',
};

/**
 * Audit ADM-03: sensitive actions (roles, account status, refunds, order
 * cancellation) need a recent second factor and answered 428 with no way out
 * of the console. Wrapped in `useStepUp()`, an action that gets 428 opens this
 * prompt; the TOTP code opens the step-up window (10 min) and the action runs
 * once more.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<{
    problem: StepUpProblem | null;
    resolve: (code: string | null) => void;
  } | null>(null);
  const [code, setCode] = useState('');

  const askCode = useCallback<AskCode>(
    (problem) =>
      new Promise((resolve) => {
        setCode('');
        setPrompt({ problem, resolve });
      }),
    [],
  );

  const run = useCallback<RunWithStepUp>(
    (action) => runWithStepUp(action, askCode, (c) => api.auth.mfaVerify(c)),
    [askCode],
  );

  function answer(value: string | null) {
    prompt?.resolve(value);
    setPrompt(null);
  }

  return (
    <StepUpContext.Provider value={run}>
      {children}
      <Modal open={prompt !== null} onClose={() => answer(null)} title="Confirmez avec votre code">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) answer(code);
          }}
        >
          <Stack gap="md">
            <Text>
              Cette action demande la double authentification. Saisissez le code à 6 chiffres de
              votre application d’authentification ; il reste valable 10 minutes pour les actions
              suivantes.
            </Text>
            {prompt?.problem && <Alert tone="danger">{PROBLEM_TEXT[prompt.problem]}</Alert>}
            {prompt?.problem === 'not-enrolled' ? (
              <Link href="/admin/security" onClick={() => answer(null)}>
                Activer la double authentification
              </Link>
            ) : (
              <Input
                label="Code à 6 chiffres"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
            )}
            <Inline gap="sm">
              {prompt?.problem !== 'not-enrolled' && (
                <Button type="submit" disabled={!/^\d{6}$/.test(code)}>
                  Confirmer
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => answer(null)}>
                Annuler
              </Button>
            </Inline>
          </Stack>
        </form>
      </Modal>
    </StepUpContext.Provider>
  );
}

/** Wraps a sensitive action: on 428 it asks for the TOTP code, then retries. */
export function useStepUp(): RunWithStepUp {
  const run = useContext(StepUpContext);
  if (!run) throw new Error('useStepUp must be used inside StepUpProvider');
  return run;
}
