import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { NeighbourhoodsService } from './neighbourhoods.service';

/**
 * Geography (Bloc 0 skeleton). Bloc 2: `MapProvider` / `GeocodingProvider` /
 * `RoutingProvider` behind interfaces, default OSM/Nominatim, cache. FEAT-022:
 * N'Djamena's neighbourhoods (`NeighbourhoodsService`), read by the sign-up and
 * edited by the admin console. Leaf of the DAG (depends on no module); every
 * module may reach it.
 */
@Module({
  controllers: [GeoController],
  providers: [NeighbourhoodsService],
  exports: [NeighbourhoodsService],
})
export class GeoModule {}
