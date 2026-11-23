import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import {
  CreateNeighbourhoodSchema,
  ListNeighbourhoodsQuerySchema,
  UpdateNeighbourhoodSchema,
  type CreateNeighbourhoodInput,
  type ListNeighbourhoodsQueryInput,
  type UpdateNeighbourhoodInput,
} from '../geo/dto/neighbourhoods.schema';

/**
 * FEAT-022 (SPEC-022-09 R4): DJAFAT edits N'Djamena's neighbourhood list —
 * add, rename, disable; never delete. Admin roles only.
 */
@ApiTags('admin')
@Controller('admin/neighbourhoods')
export class NeighbourhoodsAdminController {
  constructor(private readonly neighbourhoods: NeighbourhoodsService) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  async list(
    @Query(new ZodValidationPipe(ListNeighbourhoodsQuerySchema))
    query: ListNeighbourhoodsQueryInput,
  ) {
    return { neighbourhoods: await this.neighbourhoods.listAll(query.city) };
  }

  @Post()
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  create(@Body(new ZodValidationPipe(CreateNeighbourhoodSchema)) body: CreateNeighbourhoodInput) {
    return this.neighbourhoods.create(body.city, body.name);
  }

  @Patch(':id')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateNeighbourhoodSchema)) body: UpdateNeighbourhoodInput,
  ) {
    return this.neighbourhoods.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });
  }
}
