/**
 * Focus after a check (WCAG 2.4.3), as on the customer site
 * (`apps/web/src/components/account/focus.ts`): run after React rendered the
 * errors, hence the timer. Presentation only.
 */

/** A refusal before sending: the first field marked invalid takes the focus. */
export function focusFirstInvalid(form: HTMLElement | null): void {
  setTimeout(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
}

/** The element a message is about (`#id`, `[name=…]`) takes the focus. */
export function focusField(form: HTMLElement | null, selector: string): void {
  setTimeout(() => form?.querySelector<HTMLElement>(selector)?.focus(), 0);
}
