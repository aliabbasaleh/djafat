import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { placeNameKey, tidyPlaceName } from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** A neighbourhood offered by the sign-up forms (SPEC-022-09 R2). */
export interface NeighbourhoodDto {
  readonly id: string;
  readonly name: string;
}

/** The admin console's view (R4): disabled ones too, and whether it came from the reference data. */
export interface NeighbourhoodAdminDto extends NeighbourhoodDto {
  readonly active: boolean;
  readonly fromReferenceData: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const exists = () =>
  new ConflictException({
    code: 'NEIGHBOURHOOD_EXISTS',
    message: 'Ce quartier existe déjà dans la liste.',
  });

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr');

/**
 * N'Djamena's neighbourhoods (FEAT-022, SPEC-022-09): the list the courier and
 * restaurant sign-up forms offer, edited by DJAFAT — added, renamed, disabled,
 * never deleted (applications point to them). Two active neighbourhoods of a
 * city never share a name, accents and case aside (`placeNameKey`, also
 * enforced by a partial unique index, migration 0041).
 */
@Injectable()
export class NeighbourhoodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** R2, R5: the active neighbourhoods of a city, by name. An unknown city has none. */
  async listActive(citySlug: string): Promise<NeighbourhoodDto[]> {
    const cityId = await this.cityId(citySlug);
    if (!cityId) return [];
    const rows = await this.prisma.neighbourhood.findMany({
      where: { cityId, active: true },
      select: { id: true, name: true },
    });
    return rows.sort(byName);
  }

  /** Sign-up (SPEC-022-02, 03): an id is accepted only for an active neighbourhood. */
  async findActive(id: string): Promise<NeighbourhoodDto | null> {
    return this.prisma.neighbourhood.findFirst({
      where: { id, active: true },
      select: { id: true, name: true },
    });
  }

  /** R4: every neighbourhood of the city, active first, then by name. */
  async listAll(citySlug: string): Promise<NeighbourhoodAdminDto[]> {
    const cityId = await this.cityId(citySlug);
    if (!cityId) return [];
    const rows = await this.prisma.neighbourhood.findMany({
      where: { cityId },
      select: { id: true, name: true, active: true, code: true },
    });
    return rows
      .map((row) => this.toAdmin(row))
      .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b));
  }

  /** R4: add a neighbourhood; 409 `NEIGHBOURHOOD_EXISTS` if an active one has the same name. */
  async create(citySlug: string, name: string): Promise<NeighbourhoodAdminDto> {
    const cityId = await this.cityId(citySlug);
    if (!cityId)
      throw new NotFoundException({ code: 'CITY_NOT_FOUND', message: 'Ville inconnue.' });
    const tidy = tidyPlaceName(name);
    const nameKey = placeNameKey(tidy);
    if (await this.activeNamed(cityId, nameKey)) throw exists();
    try {
      const row = await this.prisma.neighbourhood.create({
        data: { cityId, name: tidy, nameKey },
        select: { id: true, name: true, active: true, code: true },
      });
      return this.toAdmin(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw exists(); // a concurrent add of the same name
      throw err;
    }
  }

  /** R4: rename and/or disable (or enable again) — a neighbourhood is never deleted. */
  async update(
    id: string,
    patch: { readonly name?: string; readonly active?: boolean },
  ): Promise<NeighbourhoodAdminDto> {
    const current = await this.prisma.neighbourhood.findUnique({
      where: { id },
      select: { id: true, cityId: true, name: true, active: true },
    });
    if (!current) {
      throw new NotFoundException({
        code: 'NEIGHBOURHOOD_NOT_FOUND',
        message: 'Quartier inconnu.',
      });
    }
    const name = patch.name === undefined ? current.name : tidyPlaceName(patch.name);
    const active = patch.active ?? current.active;
    const nameKey = placeNameKey(name);
    if (active && (await this.activeNamed(current.cityId, nameKey, id))) throw exists();
    try {
      const row = await this.prisma.neighbourhood.update({
        where: { id },
        data: { name, nameKey, active, updatedAt: new Date() },
        select: { id: true, name: true, active: true, code: true },
      });
      return this.toAdmin(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw exists();
      throw err;
    }
  }

  private async cityId(citySlug: string): Promise<string | null> {
    const city = await this.prisma.city.findFirst({
      where: { slug: citySlug, active: true },
      select: { id: true },
    });
    return city?.id ?? null;
  }

  private activeNamed(cityId: string, nameKey: string, exceptId?: string) {
    return this.prisma.neighbourhood.findFirst({
      where: { cityId, nameKey, active: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
  }

  private toAdmin(row: {
    id: string;
    name: string;
    active: boolean;
    code: string | null;
  }): NeighbourhoodAdminDto {
    return { id: row.id, name: row.name, active: row.active, fromReferenceData: row.code !== null };
  }
}
