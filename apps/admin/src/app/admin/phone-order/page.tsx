'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ApiClientError,
  DIAL_CODE,
  phoneFieldShowsDialCode,
  type MenuCategoryWithProducts,
  type Order,
  type ProductDetail,
  type RestaurantListItem,
} from '@djafat/sdk';
import { Heading, Stack, Text, cx } from '@djafat/ui';
import { Alert, Button, Input, Select } from '@/components/ui-client';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import styles from './page.module.css';

interface Line {
  readonly quantity: number;
  /** groupId → optionId, for products with options. */
  readonly options: Readonly<Record<string, string>>;
}

const minor = (m: { minor: string }) => BigInt(m.minor);

/**
 * FEAT-011 — the DJAFAT operator takes an order while on the phone with a
 * customer who called the national number. Same path as an app order on the
 * server (prices, opening hours, dispatch); paid on delivery.
 */
export default function PhoneOrderPage() {
  const [restaurants, setRestaurants] = useState<RestaurantListItem[]>([]);
  const [slug, setSlug] = useState('');
  const [menu, setMenu] = useState<readonly MenuCategoryWithProducts[]>([]);
  const [details, setDetails] = useState<Record<string, ProductDetail>>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [quartier, setQuartier] = useState('');
  const [landmark, setLandmark] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payBy, setPayBy] = useState<'on_delivery' | 'airtel_money'>('on_delivery');
  const [txRef, setTxRef] = useState('');
  const [done, setDone] = useState<{
    order: Order;
    isNew: boolean;
    deliveryCode: string;
    method: 'on_delivery' | 'wallet';
    instructions: string | null;
    transfer: 'paid' | 'pending' | 'amount_mismatch' | null;
  } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    api.catalog
      .listRestaurants({ limit: 50 })
      .then((r) => setRestaurants([...r.items]))
      .catch(() => setRestaurants([]));
  }, []);

  useEffect(() => {
    setLines({});
    setMenu([]);
    if (!slug) return;
    api.catalog
      .getMenu(slug)
      .then(setMenu)
      .catch(() => setMenu([]));
  }, [slug]);

  const restaurant = restaurants.find((r) => r.slug === slug) ?? null;
  const products = useMemo(() => menu.flatMap((c) => c.products), [menu]);

  async function setQuantity(productId: string, quantity: number) {
    const product = products.find((p) => p.id === productId);
    let detail = details[productId];
    if (quantity > 0 && product?.hasOptions && !detail) {
      detail = await api.catalog.getProduct(productId);
      setDetails((d) => ({ ...d, [productId]: detail! }));
    }
    setLines((prev) => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[productId];
        return next;
      }
      const defaults: Record<string, string> = {};
      for (const g of detail?.optionGroups ?? []) {
        const first = g.options.find((o) => o.isAvailable);
        if (g.isRequired && first) defaults[g.id] = first.id;
      }
      next[productId] = { quantity, options: prev[productId]?.options ?? defaults };
      return next;
    });
  }

  function setOption(productId: string, groupId: string, optionId: string) {
    setLines((prev) => {
      const line = prev[productId];
      if (!line) return prev;
      const options = { ...line.options };
      if (optionId) options[groupId] = optionId;
      else delete options[groupId];
      return { ...prev, [productId]: { ...line, options } };
    });
  }

  const subtotal = useMemo(() => {
    let total = 0n;
    for (const [productId, line] of Object.entries(lines)) {
      const p = products.find((x) => x.id === productId);
      if (!p) continue;
      let unit = minor(p.price);
      for (const optionId of Object.values(line.options)) {
        const opt = details[productId]?.optionGroups
          .flatMap((g) => g.options)
          .find((o) => o.id === optionId);
        if (opt) unit += minor(opt.priceDelta);
      }
      total += unit * BigInt(line.quantity);
    }
    return total;
  }, [lines, products, details]);

  const currency = products[0]?.price.currency ?? 'XAF';
  const canSubmit =
    phone.trim() && quartier.trim() && landmark.trim() && Object.keys(lines).length > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.phoneOrders.place(key, {
        customerPhone: phone.trim(),
        ...(name.trim() ? { customerName: name.trim() } : {}),
        items: Object.entries(lines).map(([productId, line]) => ({
          productId,
          quantity: line.quantity,
          selectedOptionIds: Object.values(line.options),
        })),
        address: {
          quartier: quartier.trim(),
          landmark: landmark.trim(),
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        },
        payment:
          payBy === 'on_delivery'
            ? { method: 'on_delivery' }
            : {
                method: 'wallet',
                providerCode: payBy,
                ...(txRef.trim() ? { transactionRef: txRef.trim() } : {}),
              },
      });
      setDone({
        order: res.order,
        isNew: res.customer.isNew,
        deliveryCode: res.deliveryCode,
        method: res.payment.method,
        instructions: res.payment.instructions,
        transfer: res.transfer ?? null,
      });
      setTxRef('');
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'La commande n’a pas pu être envoyée. Réessayez : elle ne sera pas créée deux fois.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** Airtel paid after the order was taken: the caller reads out the transaction number. */
  async function confirmTransfer() {
    if (!done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.phoneOrders.confirmTransfer(done.order.id, txRef.trim());
      setDone({ ...done, order: res.order, transfer: res.transfer });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Vérification impossible.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null);
    setPayBy('on_delivery');
    setTxRef('');
    setLines({});
    setPhone('');
    setName('');
    setQuartier('');
    setLandmark('');
    setInstructions('');
    setKey(crypto.randomUUID()); // a new call is a new order
  }

  if (done) {
    const total = formatMoney(done.order.total);
    const paid = done.method === 'on_delivery' || done.transfer === 'paid';
    return (
      <Stack gap="lg" className={cx(styles['page'])}>
        <Heading level={1}>Commande {done.order.code}</Heading>
        <section className={cx(styles['card'], styles['codeCard'])} aria-label="Code de livraison">
          <Text>Code à donner au client — il le dira au livreur à la livraison :</Text>
          <p className={cx(styles['code'])}>{done.deliveryCode}</p>
        </section>
        {done.method === 'on_delivery' ? (
          <Alert tone="success">
            {total}, payée en espèces à la livraison. La commande part au restaurant, puis à un
            livreur.
            {done.isNew ? ' Nouveau client : son compte a été créé avec son numéro.' : ''}
          </Alert>
        ) : paid ? (
          <Alert tone="success">
            Paiement Airtel Money reçu ({total}) : la commande part au restaurant.
          </Alert>
        ) : (
          <Stack gap="sm">
            <Alert tone={done.transfer === 'amount_mismatch' ? 'danger' : 'warning'}>
              {done.transfer === 'amount_mismatch'
                ? 'Le montant reçu ne correspond pas au total. Vérifiez avec le client.'
                : 'En attente du paiement Airtel Money : la commande partira au restaurant dès que DJAFAT aura reçu le transfert.'}
            </Alert>
            {done.instructions && <Text>À dire au client : « {done.instructions} »</Text>}
            <Input
              label="Numéro de transaction (lu par le client)"
              placeholder="ex. CI251109.1015.D4417"
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
            />
            {error && <Alert tone="danger">{error}</Alert>}
            <Button onClick={() => void confirmTransfer()} disabled={busy || !txRef.trim()}>
              {busy ? 'Vérification…' : 'Vérifier le paiement'}
            </Button>
          </Stack>
        )}
        <Text>
          À dire au client : « Votre commande {done.order.code} est enregistrée.
          {done.method === 'on_delivery'
            ? ` Vous payez ${total} au livreur, en espèces.`
            : paid
              ? ' Votre paiement Airtel Money est bien reçu.'
              : ''}{' '}
          Au livreur, donnez le code {done.deliveryCode}. »
        </Text>
        <Button variant={paid ? 'primary' : 'secondary'} onClick={reset}>
          Nouvel appel
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" className={cx(styles['page'])}>
      <Heading level={1}>Commande par téléphone</Heading>

      <section className={cx(styles['card'])} aria-label="Client">
        <Heading level={2}>1. Le client</Heading>
        <div className={cx(styles['row'])}>
          <Input
            label="Numéro de téléphone"
            inputMode="tel"
            placeholder="66 12 34 56"
            {...(phoneFieldShowsDialCode(phone) ? { leadingText: DIAL_CODE } : {})}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            label="Nom (si nouveau client)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </section>

      <section className={cx(styles['card'])} aria-label="Plats">
        <Heading level={2}>2. Le restaurant et les plats</Heading>
        <Select label="Restaurant" value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">— Choisir —</option>
          {restaurants.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
              {r.availability !== 'OPEN' ? ' (fermé)' : ''}
            </option>
          ))}
        </Select>
        {restaurant && restaurant.availability !== 'OPEN' && (
          <Alert tone="warning">Ce restaurant est fermé : la commande sera refusée.</Alert>
        )}
        {menu.map((cat) => (
          <div key={cat.id} className={cx(styles['category'])}>
            <Text weight="bold">{cat.name}</Text>
            {cat.products.map((p) => {
              const line = lines[p.id];
              const qty = line?.quantity ?? 0;
              return (
                <div key={p.id} className={cx(styles['product'], qty > 0 && styles['picked'])}>
                  <div className={cx(styles['productHead'])}>
                    <span>
                      {p.name} — {formatMoney(p.price)}
                      {!p.isAvailable && ' (indisponible)'}
                    </span>
                    <span className={cx(styles['stepper'])}>
                      <button
                        type="button"
                        aria-label={`Retirer un ${p.name}`}
                        onClick={() => void setQuantity(p.id, qty - 1)}
                        disabled={qty === 0}
                      >
                        −
                      </button>
                      <output aria-label={`Quantité ${p.name}`}>{qty}</output>
                      <button
                        type="button"
                        aria-label={`Ajouter un ${p.name}`}
                        onClick={() => void setQuantity(p.id, qty + 1)}
                        disabled={!p.isAvailable}
                      >
                        +
                      </button>
                    </span>
                  </div>
                  {qty > 0 &&
                    details[p.id]?.optionGroups.map((g) => (
                      <Select
                        key={g.id}
                        label={g.name + (g.isRequired ? ' (obligatoire)' : '')}
                        value={line?.options[g.id] ?? ''}
                        onChange={(e) => setOption(p.id, g.id, e.target.value)}
                      >
                        {!g.isRequired && <option value="">— Aucun —</option>}
                        {g.options
                          .filter((o) => o.isAvailable)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                              {minor(o.priceDelta) > 0n ? ` (+${formatMoney(o.priceDelta)})` : ''}
                            </option>
                          ))}
                      </Select>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className={cx(styles['card'])} aria-label="Adresse">
        <Heading level={2}>3. L’adresse de livraison</Heading>
        <div className={cx(styles['row'])}>
          <Input
            label="Quartier"
            placeholder="ex. Moursal"
            value={quartier}
            onChange={(e) => setQuartier(e.target.value)}
          />
          <Input
            label="Repère"
            placeholder="ex. derrière la grande mosquée, portail bleu"
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
          />
        </div>
        <Input
          label="Instructions pour le livreur (facultatif)"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </section>

      <section className={cx(styles['card'])} aria-label="Paiement">
        <Heading level={2}>4. Le paiement</Heading>
        <div className={cx(styles['row'])} role="radiogroup" aria-label="Moyen de paiement">
          <label className={cx(styles['product'], payBy === 'on_delivery' && styles['picked'])}>
            <input
              type="radio"
              name="payBy"
              checked={payBy === 'on_delivery'}
              onChange={() => setPayBy('on_delivery')}
            />{' '}
            Espèces à la livraison
          </label>
          <label className={cx(styles['product'], payBy === 'airtel_money' && styles['picked'])}>
            <input
              type="radio"
              name="payBy"
              checked={payBy === 'airtel_money'}
              onChange={() => setPayBy('airtel_money')}
            />{' '}
            Airtel Money maintenant (au numéro DJAFAT)
          </label>
        </div>
        {payBy === 'airtel_money' && (
          <Input
            label="Numéro de transaction (si le client a déjà payé)"
            helpText="Sinon, vous le saisirez après : la commande attend le paiement avant de partir au restaurant."
            value={txRef}
            onChange={(e) => setTxRef(e.target.value)}
          />
        )}
      </section>

      <section className={cx(styles['card'], styles['summary'])} aria-label="Récapitulatif">
        <Text>
          Plats : <strong>{formatMoney({ minor: subtotal.toString(), currency })}</strong> + frais
          de livraison (calculés à l’envoi).
        </Text>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button fullWidth onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? 'Envoi…' : 'Envoyer la commande'}
        </Button>
      </section>
    </Stack>
  );
}
