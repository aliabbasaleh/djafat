/**
 * The first super_admin of a live server (audit findings SEC-02, OPS-05). A live server
 * has no fixture accounts, so nobody can open the admin console until someone is given
 * the role. The person first signs in once on the site with their own phone number
 * (that creates their account, through the normal sign-up path), then, on the server:
 *
 *   docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate \
 *     node_modules/.bin/tsx prisma/create-super-admin.ts +235XXXXXXXX
 *
 * Further roles are granted from the admin console, behind MFA. When a super_admin
 * already exists this refuses, unless `--another` is given (e.g. the only one lost
 * their phone). Recorded in the audit log, without an actor (a server-side command).
 */
import { PrismaClient } from '@prisma/client';

const USAGE = 'Usage : create-super-admin.ts +235XXXXXXXX [--another]';

/** `+235******5678`: enough to recognise the number, not to publish it. */
function masked(phone: string): string {
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(phone.length - 8, 0))}${phone.slice(-4)}`;
}

/** A refusal: printed as is, and the process exits 1 only after Prisma disconnects. */
class Refusal extends Error {}

function fail(message: string): never {
  // Not process.exit() here: with Prisma's binary engine (`engineType = "binary"`) an
  // exit before `$disconnect()` leaves the query-engine process running and holding a
  // database connection.
  throw new Refusal(message);
}

async function main(prisma: PrismaClient): Promise<void> {
  const args = process.argv.slice(2);
  const phone = args.find((a) => !a.startsWith('--'));
  const another = args.includes('--another');
  if (!phone || !/^\+\d{8,15}$/.test(phone)) fail(USAGE);

  const user = await prisma.user.findFirst({
    where: { phone, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!user) {
    fail(
      `Aucun compte avec le numéro ${masked(phone)}. La personne doit d'abord se connecter une fois ` +
        'sur le site avec ce numéro (cela crée son compte), puis relancer cette commande.',
    );
  }
  if (user.status !== 'active') {
    fail(`Le compte ${masked(phone)} est « ${user.status} » : réactivez-le d'abord.`);
  }

  const holders = await prisma.$queryRaw<Array<{ user_id: string; phone: string }>>`
    SELECT DISTINCT r.user_id, u.phone FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.role = 'super_admin'
  `;
  if (holders.some((h) => h.user_id === user.id)) {
    console.log(`Le compte ${masked(phone)} est déjà super_admin. Rien à faire.`);
    return;
  }
  if (holders.length > 0 && !another) {
    fail(
      `Un super_admin existe déjà (${holders.map((h) => masked(h.phone)).join(', ')}). ` +
        'Donnez les rôles depuis la console admin, ou ajoutez --another pour en créer un de plus.',
    );
  }

  // The same statement as UsersService.grantRole (migration 0003's expression index).
  await prisma.$executeRaw`
    INSERT INTO user_roles (user_id, role, scope_restaurant_id)
    VALUES (${user.id}::uuid, 'super_admin', NULL)
    ON CONFLICT (
      user_id, role,
      COALESCE(scope_restaurant_id, '00000000-0000-0000-0000-000000000000'),
      COALESCE(scope_country_id,    '00000000-0000-0000-0000-000000000000'),
      COALESCE(scope_city_id,       '00000000-0000-0000-0000-000000000000')
    ) DO NOTHING
  `;
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      actorRole: 'system',
      action: 'ROLE_GRANTED',
      entityType: 'user',
      entityId: user.id,
      after: { role: 'super_admin' },
      metadata: { role: 'super_admin', via: 'prisma/create-super-admin.ts' },
    },
  });
  console.log(
    `super_admin accordé à ${masked(phone)}. Elle doit se reconnecter pour que le rôle s'applique, ` +
      'puis activer la double authentification dans la console (page « Sécurité »).',
  );
}

const prisma = new PrismaClient();
main(prisma)
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err instanceof Refusal ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
