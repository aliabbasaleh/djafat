import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { CourierEarnings, CourierPayout } from '@djafat/sdk';
import { ApiClientError } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { Badge } from '../../components/Badge';
import { MobileMoneyCard } from '../../components/MobileMoneyCard';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { formatMoney } from '../../lib/format';

type LoadState = 'loading' | 'ready' | 'error';

const MIN_WITHDRAWAL = 2000n; // FEAT-014 — the server enforces it; shown here to explain the button

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const PAYOUT_STATUS: Record<
  CourierPayout['status'],
  { label: string; tone: 'info' | 'success' | 'neutral' }
> = {
  requested: { label: 'En préparation', tone: 'info' },
  sent: { label: 'Envoyé', tone: 'success' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

/**
 * "Mes gains" (FEAT-014, SPEC-014-01/02), Deliveroo-style: this week and
 * today, each delivered course with its fee (never an order amount), the
 * balance to receive (earnings minus cash still owed), "Retirer maintenant"
 * to Airtel Money, and the payouts already made.
 */
export default function EarningsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [state, setState] = useState<LoadState>('loading');
  const [earnings, setEarnings] = useState<CourierEarnings | null>(null);
  const [payouts, setPayouts] = useState<readonly CourierPayout[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api.courier.getEarnings(), api.courier.payouts.list()]);
      setEarnings(e);
      setPayouts(p);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return;
      }
      setState('error');
    }
  }, [signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw() {
    setBusy(true);
    setMessage(null);
    try {
      const p = await api.courier.payouts.request();
      setMessage(
        `Retrait de ${formatMoney(p.requested)} demandé : DJAFAT l'envoie sur votre Airtel Money.`,
      );
      await load();
    } catch (err) {
      setMessage(
        err instanceof ApiClientError ? err.message : 'Retrait impossible pour le moment.',
      );
    } finally {
      setBusy(false);
    }
  }

  const open = payouts.find((p) => p.status === 'requested');
  const net = earnings ? BigInt(earnings.balance.net.minor) : 0n;
  const owesCash = earnings ? BigInt(earnings.balance.cashHeld.minor) > 0n : false;

  // the history grouped by day, newest first
  const days: Array<{ day: string; items: CourierEarnings['items'][number][] }> = [];
  for (const item of earnings?.items ?? []) {
    const day = dayLabel(item.deliveredAt);
    const last = days.at(-1);
    if (last && last.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Mes gains</Text>
        <BigButton label="Retour" variant="ghost" onPress={() => router.back()} />
      </View>

      {state === 'loading' && <Text style={styles.subtle}>Chargement…</Text>}
      {state === 'error' && (
        <>
          <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
          <BigButton label="Réessayer" onPress={() => void load()} />
        </>
      )}

      {state === 'ready' && earnings && (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Cette semaine</Text>
            <Text style={styles.heroValue}>{formatMoney(earnings.week.amount)}</Text>
            <Text style={styles.subtle}>
              {earnings.week.count} course{earnings.week.count > 1 ? 's' : ''} · aujourd’hui{' '}
              {formatMoney(earnings.today.amount)} ({earnings.today.count})
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Gains disponibles</Text>
              <Text style={styles.value}>{formatMoney(earnings.balance.available)}</Text>
            </View>
            {owesCash && (
              <View style={styles.row}>
                <Text style={styles.label}>Espèces encaissées à reverser</Text>
                <Text style={styles.value}>− {formatMoney(earnings.balance.cashHeld)}</Text>
              </View>
            )}
            <View style={[styles.row, styles.total]}>
              <Text style={styles.labelStrong}>À recevoir</Text>
              <Text style={styles.net}>{formatMoney(earnings.balance.net)}</Text>
            </View>
            {open ? (
              <Badge
                tone="info"
                label={`Retrait de ${formatMoney(open.requested)} en préparation`}
              />
            ) : (
              <>
                <BigButton
                  label="Retirer maintenant"
                  onPress={() => void withdraw()}
                  loading={busy}
                  disabled={net < MIN_WITHDRAWAL}
                />
                <Text style={styles.note}>
                  Sur votre Airtel Money, dès 2 000 FCFA ; frais Airtel à votre charge. Sinon,
                  versement automatique chaque lundi, sans frais.
                </Text>
              </>
            )}
            {message && <Text style={styles.note}>{message}</Text>}
          </View>

          {/* FEAT-022 (SPEC-022-07 R6): where the earnings go, and a new number for DJAFAT. */}
          <MobileMoneyCard />

          <Text style={styles.section}>Mes courses</Text>
          {days.length === 0 && (
            <Text style={styles.subtle}>Aucune course livrée pour le moment.</Text>
          )}
          {days.map((d) => (
            <View key={d.day} style={styles.card}>
              <Text style={styles.dayTitle}>{d.day}</Text>
              {d.items.map((i) => (
                <View key={i.deliveryId} style={styles.row}>
                  <Text style={styles.label}>
                    {timeLabel(i.deliveredAt)} · {i.restaurantName}
                    {i.quartier ? ` → ${i.quartier}` : ''}
                  </Text>
                  <Text style={styles.fee}>{formatMoney(i.fee)}</Text>
                </View>
              ))}
            </View>
          ))}

          {payouts.length > 0 && (
            <>
              <Text style={styles.section}>Mes versements</Text>
              {payouts.map((p) => (
                <View key={p.id} style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.labelStrong}>
                      {p.kind === 'weekly' ? 'Versement du lundi' : 'Retrait'} ·{' '}
                      {dayLabel(p.sentAt ?? p.requestedAt)}
                    </Text>
                    <Badge
                      tone={PAYOUT_STATUS[p.status].tone}
                      label={PAYOUT_STATUS[p.status].label}
                    />
                  </View>
                  <Text style={styles.label}>
                    {p.received
                      ? `Reçu : ${formatMoney(p.received)}`
                      : `Montant : ${formatMoney(p.requested)}`}
                    {p.transactionRef ? ` · transaction ${p.transactionRef}` : ''}
                  </Text>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['4'],
  },
  title: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.text.primary },
  subtle: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  hero: { marginBottom: tokens.space['4'], gap: tokens.space['1'] },
  heroLabel: { fontSize: tokens.type.size.label, color: tokens.color.text.secondary },
  heroValue: { fontSize: 40, fontWeight: '800', color: tokens.color.brand.primary },
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['5'],
    marginBottom: tokens.space['3'],
    gap: tokens.space['2'],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.space['2'],
  },
  total: {
    borderTopWidth: 1,
    borderTopColor: tokens.color.border.default,
    paddingTop: tokens.space['2'],
  },
  label: { flexShrink: 1, fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  labelStrong: {
    flexShrink: 1,
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  value: { fontSize: tokens.type.size.body, fontWeight: '700', color: tokens.color.text.primary },
  net: { fontSize: tokens.type.size.h2, fontWeight: '800', color: tokens.color.brand.primary },
  note: { fontSize: tokens.type.size.label, color: tokens.color.text.secondary },
  section: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
    marginTop: tokens.space['4'],
    marginBottom: tokens.space['2'],
  },
  dayTitle: {
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
  fee: { fontSize: tokens.type.size.body, fontWeight: '700', color: tokens.color.text.primary },
});
