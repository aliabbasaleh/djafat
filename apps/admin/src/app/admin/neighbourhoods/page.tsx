'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, type AdminNeighbourhood, type TypedNeighbourhood } from '@djafat/sdk';
import { Heading, Stack, Inline, ErrorState, Skeleton, Text, Badge, cx } from '@djafat/ui';
import { Alert, Button, Input, Modal } from '@/components/ui-client';
import { DataTable } from '@/components/DataTable';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/auth-storage';
import styles from '@/components/ListPage.module.css';

type LoadState = 'loading' | 'ready' | 'error';

/** SPEC-022-09 R3: 2 to 60 characters, as the API checks again. */
function nameError(name: string): string | null {
  const tidy = name.trim();
  if (tidy.length < 2) return 'Au moins 2 caractères.';
  if (tidy.length > 60) return 'Au plus 60 caractères.';
  return null;
}

function apiMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'NEIGHBOURHOOD_EXISTS') return 'Ce quartier existe déjà dans la liste.';
    return err.message;
  }
  return 'Action impossible : réessayez.';
}

/**
 * FEAT-022 (SPEC-022-09 R3, R4): « Quartiers » — N'Djamena's list that the
 * courier and restaurant forms offer, sorted by name. Add, rename, disable or
 * enable again; never delete (applications point to them). Below, the names
 * typed under « Autre » that the list does not have yet, to add in one tap.
 */
export default function NeighbourhoodsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [rows, setRows] = useState<readonly AdminNeighbourhood[]>([]);
  const [typed, setTyped] = useState<readonly TypedNeighbourhood[]>([]);
  const [name, setName] = useState('');
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<AdminNeighbourhood | null>(null);
  const [newName, setNewName] = useState('');
  const [renameProblem, setRenameProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, names] = await Promise.all([
        api.admin.neighbourhoods.list(),
        api.admin.neighbourhoods.typed(),
      ]);
      setRows(list.neighbourhoods);
      setTyped(names.names);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(value: string) {
    const problem = nameError(value);
    if (problem) {
      setNameProblem(problem);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.admin.neighbourhoods.create(value.trim());
      setMessage({ tone: 'success', text: `« ${created.name} » ajouté à la liste.` });
      setName('');
      await load();
    } catch (err) {
      setMessage({ tone: 'danger', text: apiMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: AdminNeighbourhood) {
    setBusy(true);
    setMessage(null);
    try {
      await api.admin.neighbourhoods.update(row.id, { active: !row.active });
      setMessage({
        tone: 'success',
        text: row.active
          ? `« ${row.name} » n’est plus proposé ; les dossiers qui y renvoient le gardent.`
          : `« ${row.name} » est de nouveau proposé.`,
      });
      await load();
    } catch (err) {
      setMessage({ tone: 'danger', text: apiMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!renaming) return;
    const problem = nameError(newName);
    if (problem) {
      setRenameProblem(problem);
      return;
    }
    setBusy(true);
    try {
      await api.admin.neighbourhoods.update(renaming.id, { name: newName.trim() });
      setMessage({ tone: 'success', text: `Renommé en « ${newName.trim()} ».` });
      setRenaming(null);
      await load();
    } catch (err) {
      setRenameProblem(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg">
      <div className={cx(styles['header'])}>
        <Heading level={1}>Quartiers</Heading>
      </div>
      <Text tone="secondary">
        La liste que proposent les formulaires livreur et restaurant (N’Djamena), plus « Autre ». Un
        quartier ne se supprime jamais : désactivé, il n’est plus proposé, mais les dossiers qui y
        renvoient le gardent.
      </Text>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(name);
        }}
        noValidate
      >
        <Inline gap="sm" align="end" wrap>
          <Input
            label="Nouveau quartier"
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              if (nameProblem) setNameProblem(null);
            }}
            {...(nameProblem ? { error: nameProblem } : {})}
          />
          <Button type="submit" loading={busy}>
            Ajouter
          </Button>
        </Inline>
      </form>

      {state === 'loading' && (
        <Stack gap="sm" aria-busy="true" aria-label="Chargement des quartiers">
          <Skeleton height={40} />
          <Skeleton height={240} radius="8px" />
        </Stack>
      )}
      {state === 'error' && (
        <ErrorState
          title="Impossible de charger les quartiers"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      )}

      {state === 'ready' && typed.length > 0 && (
        <section aria-labelledby="typed-title">
          <Stack gap="sm">
            <Heading level={2} size="h3" id="typed-title">
              Noms saisis sous « Autre » ({typed.length})
            </Heading>
            <DataTable
              keyFor={(row) => row.name}
              rows={typed}
              columns={[
                { header: 'Nom saisi', render: (row) => row.name },
                { header: 'Livreurs', render: (row) => String(row.couriers) },
                { header: 'Restaurants', render: (row) => String(row.restaurants) },
                {
                  header: '',
                  render: (row) => (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void add(row.name)}
                      aria-label={`Ajouter « ${row.name} » à la liste`}
                    >
                      Ajouter à la liste
                    </Button>
                  ),
                },
              ]}
            />
          </Stack>
        </section>
      )}

      {state === 'ready' && (
        <section aria-labelledby="list-title">
          <Stack gap="sm">
            <Heading level={2} size="h3" id="list-title">
              La liste ({rows.filter((r) => r.active).length} proposés)
            </Heading>
            <DataTable
              keyFor={(row) => row.id}
              rows={rows}
              columns={[
                { header: 'Quartier', render: (row) => row.name },
                {
                  header: 'État',
                  render: (row) => (
                    <Badge tone={row.active ? 'success' : 'neutral'}>
                      {row.active ? 'Proposé' : 'Désactivé'}
                    </Badge>
                  ),
                },
                {
                  header: '',
                  render: (row) => (
                    <Inline gap="xs">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRenaming(row);
                          setNewName(row.name);
                          setRenameProblem(null);
                        }}
                        aria-label={`Renommer ${row.name}`}
                      >
                        Renommer
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void toggle(row)}
                        aria-label={`${row.active ? 'Désactiver' : 'Réactiver'} ${row.name}`}
                      >
                        {row.active ? 'Désactiver' : 'Réactiver'}
                      </Button>
                    </Inline>
                  ),
                },
              ]}
            />
          </Stack>
        </section>
      )}

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={renaming ? `Renommer ${renaming.name}` : ''}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
          noValidate
        >
          <Stack gap="md">
            <Input
              label="Nouveau nom"
              value={newName}
              maxLength={60}
              autoFocus
              onChange={(e) => {
                setNewName(e.target.value);
                if (renameProblem) setRenameProblem(null);
              }}
              {...(renameProblem ? { error: renameProblem } : {})}
            />
            <Inline gap="sm">
              <Button type="submit" loading={busy}>
                Renommer
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Annuler
              </Button>
            </Inline>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
