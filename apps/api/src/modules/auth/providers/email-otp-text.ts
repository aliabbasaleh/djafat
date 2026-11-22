import type { OtpDeliveryPurpose } from '@djafat/types';

/**
 * Subject and plain-text body of a code email (FEAT-007 SPEC-007-01 R1,
 * FEAT-020 SPEC-020-01 R5): the wording says what the code is for. Without a
 * purpose it is a login code, exactly as before FEAT-020. Pure.
 */
export function emailOtpMessage(
  code: string,
  ttlSeconds: number,
  purpose: OtpDeliveryPurpose = 'login',
): { subject: string; text: string } {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  const wording = WORDING[purpose];
  if (!wording) return loginMessage(code, minutes);
  return {
    subject: wording.subject,
    text: [
      'Bonjour,',
      '',
      `${wording.lead} ${code}`,
      `Il est valable ${minutes} min.`,
      '',
      "Ne le communiquez à personne, même à quelqu'un qui dit appeler de la part de DJAFAT.",
      wording.ifNotYou,
      '',
      "L'équipe DJAFAT",
    ].join('\n'),
  };
}

/** FEAT-007's login text, unchanged. */
function loginMessage(code: string, minutes: number): { subject: string; text: string } {
  return {
    subject: 'Votre code de connexion DJAFAT',
    text: [
      'Bonjour,',
      '',
      `Votre code DJAFAT est : ${code}`,
      `Il est valable ${minutes} min.`,
      '',
      'Ne le communiquez a personne, meme a quelqu un qui dit appeler de la part de DJAFAT.',
      "Si vous n'avez rien demande, ignorez cet e-mail.",
      '',
      "L'equipe DJAFAT",
    ].join('\n'),
  };
}

interface Wording {
  readonly subject: string;
  readonly lead: string;
  readonly ifNotYou: string;
}

/** Codes sent by email other than the login one. SMS-only purposes fall back to the login text. */
const WORDING: Partial<Record<OtpDeliveryPurpose, Wording>> = {
  register: {
    subject: 'Confirmez votre adresse e-mail DJAFAT',
    lead: 'Pour créer votre compte DJAFAT, saisissez ce code :',
    ifNotYou: "Si vous n'avez rien demandé, ignorez cet e-mail : aucun compte ne sera créé.",
  },
  login_device: {
    subject: 'Nouvel appareil : votre code DJAFAT',
    lead: 'Une connexion à votre compte DJAFAT est en cours sur un nouvel appareil. Pour la terminer, saisissez ce code :',
    ifNotYou:
      "Si ce n'est pas vous, quelqu'un connaît votre mot de passe : changez-le tout de suite avec « Mot de passe oublié ? ».",
  },
  reset_password: {
    subject: 'Réinitialisation de votre mot de passe DJAFAT',
    lead: 'Pour choisir un nouveau mot de passe, saisissez ce code :',
    ifNotYou: "Si vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.",
  },
  verify_email: {
    subject: 'Ajout de votre adresse e-mail à DJAFAT',
    lead: 'Pour ajouter cette adresse à votre compte DJAFAT, saisissez ce code :',
    ifNotYou: "Si vous n'avez rien demandé, ignorez cet e-mail.",
  },
};
