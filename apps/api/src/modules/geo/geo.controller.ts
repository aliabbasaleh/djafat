import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { NeighbourhoodsService } from './neighbourhoods.service';
import {
  ListNeighbourhoodsQuerySchema,
  type ListNeighbourhoodsQueryInput,
} from './dto/neighbourhoods.schema';

/**
 * Public geography reads. FEAT-022 (SPEC-022-09 R5): the neighbourhood list is
 * read by the sign-up forms before any account exists — no `@RequireAuth()`.
 */
@ApiTags('geo')
@Controller('geo')
export class GeoController {
  constructor(private readonly neighbourhoods: NeighbourhoodsService) {}

  @Get('neighbourhoods')
  async listNeighbourhoods(
    @Query(new ZodValidationPipe(ListNeighbourhoodsQuerySchema))
    query: ListNeighbourhoodsQueryInput,
  ) {
    return { neighbourhoods: await this.neighbourhoods.listActive(query.city) };
  }
}
