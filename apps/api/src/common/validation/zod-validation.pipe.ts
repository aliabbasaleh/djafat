import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodTypeAny, z } from 'zod';

/**
 * Validates a handler argument against a Zod schema. Zod is the single source of
 * truth for input shape, shared with the frontends via `@djafat/validation`
 * (docs/05 §5.4). Failures surface as `422 VALIDATION_ERROR` via the exception
 * filter.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    // zod's generic `parse` is typed `any`; the schema IS the source of truth.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return this.schema.parse(value);
  }
}

/** Convenience factory: `@Body(zodBody(CreateThingSchema))`. */
export const zodBody = <T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
