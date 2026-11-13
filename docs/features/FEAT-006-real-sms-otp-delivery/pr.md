# feat(auth): send login codes through a real SMS gateway, refuse to start in production without one

## Objectif

FEAT-006 : en production, les codes de connexion partent vraiment par SMS.

## Avant / après

|                        | Avant                                   | Après                                             |
| ---------------------- | --------------------------------------- | ------------------------------------------------- |
| Fournisseur branché    | toujours `mock` (n'envoie rien)         | `SMS_PROVIDER=mock\|http`                         |
| Production avec `mock` | démarre ; personne ne peut se connecter | **refuse de démarrer**, avec un message explicite |
| Passerelle en panne    | —                                       | 1 nouvel essai, puis 503 `OTP_DELIVERY_FAILED`    |
| Journaux               | —                                       | numéro masqué, jamais le code ni la clé           |

## Specs et critères couverts

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                       |
| ---------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| FEAT-006-AC01                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC01 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC02                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC02 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC03 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC04 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC05 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC03                | SPEC-006-01@1 (implemented) | SPEC-006-01-SC06 | `apps/api/src/modules/auth/providers/http-sms-otp-delivery.provider.spec.ts` |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC01 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC02 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC03 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC05                | SPEC-006-02@1 (implemented) | SPEC-006-02-SC04 | `packages/config/src/env.spec.ts`                                            |
| FEAT-006-AC04, FEAT-006-AC05 | SPEC-006-02@1 (implemented) | SPEC-006-02-SC05 | _review_                                                                     |

## Vérifications

`verification.md` (`verify --full`), et `e2e-demo.md` (API réelle, numéros fictifs Airtel et Tigo).

## Déploiement

Avant de déployer en production, ajouter `SMS_PROVIDER=http`, `SMS_HTTP_URL` et
`SMS_HTTP_API_KEY` (secret). Sinon l'API refuse de démarrer, ce qui est voulu.
