import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@djafat/sdk';
import { runWithStepUp, StepUpCancelled, type StepUpProblem } from './step-up-flow';

const apiError = (status: number, code: string) =>
  new ApiClientError({ status, code: code as never, message: code });

/** An action the API refuses with 428 until the step-up window is open. */
function sensitiveAction() {
  const state = { windowOpen: false, calls: 0 };
  const action = vi.fn(async () => {
    state.calls += 1;
    if (!state.windowOpen) throw apiError(428, 'STEP_UP_REQUIRED');
    return 'done';
  });
  return { state, action };
}

describe('runWithStepUp (audit ADM-03)', () => {
  it('no step-up needed: the action runs once, no prompt', async () => {
    const askCode = vi.fn();
    await expect(runWithStepUp(async () => 'ok', askCode, vi.fn())).resolves.toBe('ok');
    expect(askCode).not.toHaveBeenCalled();
  });

  it('428: asks for the code, verifies it, then runs the action once more', async () => {
    const { state, action } = sensitiveAction();
    const verify = vi.fn(async (code: string) => {
      expect(code).toBe('123456');
      state.windowOpen = true;
    });
    const askCode = vi.fn(async () => '123456');

    await expect(runWithStepUp(action, askCode, verify)).resolves.toBe('done');
    expect(askCode).toHaveBeenCalledWith(null);
    expect(state.calls).toBe(2);
  });

  it('a wrong code asks again, saying why; the second code works', async () => {
    const { state, action } = sensitiveAction();
    const verify = vi.fn(async (code: string) => {
      if (code !== '654321') throw apiError(409, 'MFA_INVALID');
      state.windowOpen = true;
    });
    const problems: Array<StepUpProblem | null> = [];
    const answers = ['111111', '654321'];
    const askCode = vi.fn(async (problem: StepUpProblem | null) => {
      problems.push(problem);
      return answers.shift() ?? null;
    });

    await expect(runWithStepUp(action, askCode, verify)).resolves.toBe('done');
    expect(problems).toEqual([null, 'invalid-code']);
  });

  it('MFA never set up, or too many attempts: the prompt is told so', async () => {
    for (const [err, expected] of [
      [apiError(409, 'VALIDATION_ERROR'), 'not-enrolled'],
      [apiError(429, 'RATE_LIMITED'), 'rate-limited'],
    ] as const) {
      const { action } = sensitiveAction();
      const problems: Array<StepUpProblem | null> = [];
      const askCode = vi.fn(async (problem: StepUpProblem | null) => {
        problems.push(problem);
        return problems.length === 1 ? '123456' : null;
      });
      await expect(
        runWithStepUp(action, askCode, async () => {
          throw err;
        }),
      ).rejects.toBeInstanceOf(StepUpCancelled);
      expect(problems).toEqual([null, expected]);
    }
  });

  it('cancelling throws StepUpCancelled and never runs the action again', async () => {
    const { state, action } = sensitiveAction();
    await expect(runWithStepUp(action, async () => null, vi.fn())).rejects.toBeInstanceOf(
      StepUpCancelled,
    );
    expect(state.calls).toBe(1);
  });

  it('any other error of the action is thrown unchanged, without a prompt', async () => {
    const askCode = vi.fn();
    const forbidden = apiError(403, 'FORBIDDEN');
    await expect(
      runWithStepUp(
        async () => {
          throw forbidden;
        },
        askCode,
        vi.fn(),
      ),
    ).rejects.toBe(forbidden);
    expect(askCode).not.toHaveBeenCalled();
  });
});
