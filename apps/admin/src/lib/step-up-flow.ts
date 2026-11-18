import { ApiClientError } from '@djafat/sdk';

/** Why the prompt is shown again: the code was wrong, MFA is not set up yet, or another error. */
export type StepUpProblem = 'invalid-code' | 'not-enrolled' | 'rate-limited' | 'error';

/** Shows the code prompt; resolves with the code typed, or null if the user cancelled. */
export type AskCode = (problem: StepUpProblem | null) => Promise<string | null>;

/** The user closed the prompt: the action was not done, and there is nothing to report. */
export class StepUpCancelled extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelled';
  }
}

export function isStepUpRequired(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 428;
}

function problemOf(err: unknown): StepUpProblem {
  if (!(err instanceof ApiClientError)) return 'error';
  if (err.code === 'MFA_INVALID') return 'invalid-code';
  if (err.status === 429) return 'rate-limited';
  // 409 VALIDATION_ERROR "No MFA enrollment in progress": never set up.
  if (err.status === 409) return 'not-enrolled';
  return 'error';
}

/**
 * Runs a sensitive action (audit ADM-03). When the API asks for a recent
 * second factor (428 `STEP_UP_REQUIRED`), asks for the TOTP code, opens the
 * step-up window with it (`verify`, i.e. `POST /auth/mfa/verify`) and runs the
 * action once more. A wrong code asks again, saying why; cancelling throws
 * `StepUpCancelled`. Any other error of the action is thrown unchanged.
 */
export async function runWithStepUp<T>(
  action: () => Promise<T>,
  askCode: AskCode,
  verify: (code: string) => Promise<unknown>,
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!isStepUpRequired(err)) throw err;
  }
  let problem: StepUpProblem | null = null;
  for (;;) {
    const code = await askCode(problem);
    if (code === null) throw new StepUpCancelled();
    try {
      await verify(code);
      break;
    } catch (err) {
      problem = problemOf(err);
    }
  }
  return action();
}
