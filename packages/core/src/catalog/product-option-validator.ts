import type { OptionSelectionType } from '@djafat/types';

/**
 * "Is this set of option selections valid for this product?" (docs/20 §18)
 * — pure, no I/O, reusable by the future cart/order module without
 * reimplementing the rule (exactly the point of building it now).
 */

export interface OptionLike {
  readonly id: string;
  readonly isAvailable: boolean;
}

export interface OptionGroupLike {
  readonly id: string;
  readonly selectionType: OptionSelectionType;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly isRequired: boolean;
  readonly options: readonly OptionLike[];
}

export type OptionValidationErrorCode =
  | 'REQUIRED'
  | 'MIN_SELECTIONS'
  | 'MAX_SELECTIONS'
  | 'UNAVAILABLE_OPTION'
  | 'UNKNOWN_OPTION';

export interface OptionValidationError {
  readonly groupId: string;
  readonly code: OptionValidationErrorCode;
  readonly message: string;
  readonly optionId?: string;
}

export interface OptionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly OptionValidationError[];
}

/** `selections`: groupId -> the option ids selected for that group. */
export function validateProductOptionSelections(
  groups: readonly OptionGroupLike[],
  selections: ReadonlyMap<string, readonly string[]>,
): OptionValidationResult {
  const errors: OptionValidationError[] = [];

  for (const group of groups) {
    const selected = selections.get(group.id) ?? [];
    const availableIds = new Set(group.options.filter((o) => o.isAvailable).map((o) => o.id));
    const allIds = new Set(group.options.map((o) => o.id));

    for (const optionId of selected) {
      if (!allIds.has(optionId)) {
        errors.push({
          groupId: group.id,
          optionId,
          code: 'UNKNOWN_OPTION',
          message: `Option ${optionId} does not belong to group ${group.id}.`,
        });
      } else if (!availableIds.has(optionId)) {
        errors.push({
          groupId: group.id,
          optionId,
          code: 'UNAVAILABLE_OPTION',
          message: `Option ${optionId} is not currently available.`,
        });
      }
    }

    // A required group (or one with an explicit positive minimum) must meet
    // that minimum even at zero selections — that IS the "required" signal.
    const effectiveMin = group.isRequired ? Math.max(group.minSelections, 1) : group.minSelections;

    if (group.isRequired && selected.length === 0) {
      errors.push({
        groupId: group.id,
        code: 'REQUIRED',
        message: `Group "${group.id}" is required — at least one selection is expected.`,
      });
    } else if (selected.length < effectiveMin) {
      errors.push({
        groupId: group.id,
        code: 'MIN_SELECTIONS',
        message: `Group "${group.id}" requires at least ${effectiveMin} selection(s), got ${selected.length}.`,
      });
    }

    if (selected.length > group.maxSelections) {
      errors.push({
        groupId: group.id,
        code: 'MAX_SELECTIONS',
        message: `Group "${group.id}" allows at most ${group.maxSelections} selection(s), got ${selected.length}.`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
