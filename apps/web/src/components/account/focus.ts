/**
 * Focus after a check (WCAG 2.4.3; FEAT-024 SPEC-024-01, 03, 04 « UI »; review
 * of FEAT-024, note 1). Run after React has rendered the errors, hence the
 * timer. Presentation only: no rule here.
 */

/** A refusal before sending: the first field marked invalid takes the focus. */
export function focusFirstInvalid(form: HTMLElement | null): void {
  setTimeout(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
}

/** « Oui, corriger », a refused number: the field concerned takes the focus. */
export function focusField(form: HTMLElement | null, selector: string): void {
  setTimeout(() => form?.querySelector<HTMLElement>(selector)?.focus(), 0);
}
