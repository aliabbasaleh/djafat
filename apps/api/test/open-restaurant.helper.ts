import type { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * BUG-PAY-INT-7 — make a restaurant OPEN for the duration of a test file,
 * whatever time it is.
 *
 * `POST /v1/orders` refuses an order when the restaurant is not taking orders
 * (`RESTAURANT_CLOSED`, orders.service.ts — added by the second pilot run,
 * docs/36 §6). The seed gives `chez-fatime` 11:00-22:00, so every suite that
 * creates an order silently depended on the WALL CLOCK: run the suite at
 * 23:25 and `cart`'s full flow fails with 409 while the code is perfectly
 * correct. docs/36 §6.4 records this for the manual pilot ("extend the window
 * through `PUT /restaurants/me/hours`"); an automated suite cannot be asked to
 * be run before 22:00.
 *
 * The fixture uses the product's OWN documented convention rather than a
 * special case: `opensMinutes === closesMinutes` means "open all day" for that
 * weekday (`computeRestaurantAvailability`, `@djafat/core`). Active closures
 * are lifted too — a closure wins over hours by design.
 *
 * Returns a restore function. Callers MUST call it in `afterAll`: the
 * integration database is long-lived and shared by the other suites (which run
 * sequentially, `fileParallelism: false`), so no file may leave the seed
 * widened behind it — `catalog.int.spec.ts` asserts on seeded availability.
 */
export async function keepRestaurantOpen(
  prisma: PrismaService,
  restaurantId: string,
): Promise<() => Promise<void>> {
  const hours = await prisma.restaurantHours.findMany({ where: { restaurantId } });
  const now = new Date();
  const closures = await prisma.restaurantClosure.findMany({
    where: { restaurantId, startsAt: { lte: now }, endsAt: { gt: now } },
  });

  await prisma.restaurantHours.deleteMany({ where: { restaurantId } });
  await prisma.restaurantHours.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      restaurantId,
      weekday,
      opensMinutes: 0,
      closesMinutes: 0, // opens === closes -> open all day (docs/20 §20)
    })),
  });
  if (closures.length > 0) {
    await prisma.restaurantClosure.deleteMany({
      where: { id: { in: closures.map((c) => c.id) } },
    });
  }

  return async () => {
    await prisma.restaurantHours.deleteMany({ where: { restaurantId } });
    if (hours.length > 0) {
      await prisma.restaurantHours.createMany({ data: hours });
    }
    if (closures.length > 0) {
      await prisma.restaurantClosure.createMany({ data: closures });
    }
  };
}
