'use client';

import { useState } from 'react';
import {
  RESTAURANT_STEP_TEXT,
  restaurantStatusLine,
  restaurantSubmitState,
  type RestaurantApplication,
} from '@djafat/sdk';
import { Heading, Stack, Text, VisuallyHidden, cx } from '@djafat/ui';
import { Alert, Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { errorText } from '@/lib/application';
import styles from './ApplicationSteps.module.css';

/** Where each step is filled (SPEC-022-05 R2): two new pages, and the console's own. */
const STEP_PAGE = {
  location: '/restaurant/location?etape=1',
  hours_menu: '/restaurant/hours?etape=2',
  photos: '/restaurant/profile?etape=3',
  papers: '/restaurant/papers?etape=4',
} as const;

/**
 * FEAT-022 (SPEC-022-05, FEAT-022-VIS04): the home of a restaurant not yet
 * validated — the four steps with their state in text (not only the icon),
 * then « Envoyer pour validation », greyed with what is left. Sent, the steps
 * read only (R5); refused, the reason shows and the form opens again (R4).
 */
export function ApplicationSteps({
  application,
  onChange,
}: {
  readonly application: RestaurantApplication;
  readonly onChange: (next: RestaurantApplication) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = restaurantSubmitState(application);
  const statusLine = restaurantStatusLine(application);
  const editable = application.status === 'to_complete' || application.status === 'rejected';

  async function send() {
    setError(null);
    setSending(true);
    try {
      onChange(await api.restaurant.application.submit());
    } catch (err) {
      setError(errorText(err, "L'envoi n'a pas abouti. Réessayez dans un instant."));
    } finally {
      setSending(false);
    }
  }

  return (
    <Stack gap="lg">
      <Heading level={1}>{application.name}</Heading>
      <div className={cx(styles['intro'])}>
        <Text>Votre restaurant n&apos;est pas encore visible des clients.</Text>
        {editable && <Text>Complétez les 4 étapes, puis envoyez-le à DJAFAT pour validation.</Text>}
      </div>
      {statusLine && (
        <Alert tone={application.status === 'rejected' ? 'warning' : 'info'}>{statusLine}</Alert>
      )}

      <ol className={cx(styles['steps'])} aria-label="Les 4 étapes">
        {application.steps.map(({ step, done }, index) => {
          const text = RESTAURANT_STEP_TEXT[step];
          const action = editable ? (done ? 'Modifier' : 'Compléter') : 'Voir';
          return (
            <li key={step} className={cx(styles['step'])}>
              <span className={cx(styles['icon'])} aria-hidden="true">
                {done ? '✅' : '⬜'}
              </span>
              <div className={cx(styles['body'])}>
                <span className={cx(styles['title'])}>
                  {index + 1}. {text.title}
                  <VisuallyHidden>{done ? ' — fait' : ' — à compléter'}</VisuallyHidden>
                </span>
                <span className={cx(styles['detail'])}>{text.detail}</span>
              </div>
              <Button
                href={STEP_PAGE[step]}
                variant={done ? 'ghost' : 'secondary'}
                size="sm"
                aria-label={`${action} : ${text.title}`}
              >
                {action}
              </Button>
            </li>
          );
        })}
      </ol>

      {editable && (
        <div className={cx(styles['send'])}>
          <Button
            onClick={() => void send()}
            disabled={!submit.canSubmit}
            loading={sending}
            aria-describedby={submit.reason ? 'submit-reason' : undefined}
          >
            Envoyer pour validation
          </Button>
          {submit.reason && (
            <p id="submit-reason" className={cx(styles['reason'])}>
              {submit.reason}
            </p>
          )}
          {error && (
            <p role="alert" className={cx(styles['error'])}>
              {error}
            </p>
          )}
        </div>
      )}
    </Stack>
  );
}
