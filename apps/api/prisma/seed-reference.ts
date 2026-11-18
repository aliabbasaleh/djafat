/**
 * `pnpm db:seed:reference` — the reference data only (`reference-data.ts`): no user, no
 * restaurant, no test data. Safe on a live production server, and run there at every
 * deploy by `infra/deploy/docker-compose.prod.yml` (audit OPS-05): it only creates what
 * is missing and never undoes a setting changed on the server.
 */
import { PrismaClient } from '@prisma/client';
import { seedReferenceData } from './reference-data';

const prisma = new PrismaClient();

seedReferenceData(prisma, { resetTunables: false })
  .then(async ({ country, city, counts }) => {
    console.log(
      `Reference data OK — market ${country.isoCode}/${city.slug}, ${counts.roles} roles, ` +
        `${counts.permissions} permissions, ${counts.accounts} ledger accounts, ` +
        `${counts.providers} payment providers. No user or test data created.`,
    );
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
