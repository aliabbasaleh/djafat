import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import { ApplicationsService } from './applications.service';
import {
  AdminNeighbourhoodsQuerySchema,
  CreateNeighbourhoodSchema,
  UpdateNeighbourhoodSchema,
  type AdminNeighbourhoodsQueryInput,
  type CreateNeighbourhoodInput,
  type UpdateNeighbourhoodInput,
} from './dto/neighbourhoods-admin.schema';

/**
 * FEAT-022 (SPEC-022-09 R3, R4): DJAFAT edits N'Djamena's neighbourhood list —
 * add, rename, disable; never delete — and sees the names typed under
 * « Autre » to add them. Admin roles only.
 */
@ApiTags('admin')
@Controller('admin/neighbourhoods')
export class NeighbourhoodsAdminController {
  constructor(
    private readonly neighbourhoods: NeighbourhoodsService,
    private readonly applications: ApplicationsService,
  ) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  async list(
    @Query(new ZodValidationPipe(AdminNeighbourhoodsQuerySchema))
    query: AdminNeighbourhoodsQueryInput,
  ) {
    return { neighbourhoods: await this.neighbourhoods.listAll(query.city) };
  }

  /** R3, SC02: the names typed under « Autre », not yet in the list. */
  @Get('typed')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  async typed(
    @Query(new ZodValidationPipe(AdminNeighbourhoodsQuerySchema))
    query: AdminNeighbourhoodsQueryInput,
  ) {
    const all = await this.neighbourhoods.listAll(query.city);
    return {
      names: await this.applications.typedNeighbourhoods(
        all.filter((n) => n.active).map((n) => n.name),
      ),
    };
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
