import type { AccountNotice } from '../account-notice.port';

/** Wording of the account notices (FEAT-020, SPEC-020-01 R6). Pure. */
export function accountNoticeMessage(notice: AccountNotice): { subject: string; text: string } {
  if (notice.kind === 'already_registered') {
    return {
      subject: 'Vous avez déjà un compte DJAFAT',
      text: [
        'Bonjour,',
        '',
        "Quelqu'un, sans doute vous, a voulu créer un compte DJAFAT avec cette adresse e-mail.",
        'Cette adresse a déjà un compte : il suffit de vous connecter.',
        '',
        'Dans DJAFAT, ouvrez « Compte », puis « Se connecter » :',
        '- avec votre mot de passe ;',
        '- ou avec « Recevoir un code par e-mail » ;',
        '- mot de passe oublié, ou jamais choisi : « Mot de passe oublié ? ».',
        '',
        "Si ce n'était pas vous, ignorez cet e-mail : rien n'a changé.",
        '',
        "L'équipe DJAFAT",
      ].join('\n'),
    };
  }
  return {
    subject: 'Votre mot de passe DJAFAT a été modifié',
    text: [
      'Bonjour,',
      '',
      `Le mot de passe de votre compte DJAFAT a été modifié le ${ndjamenaTime(notice.at)} (heure de N'Djamena).`,
      '',
      "Si c'est vous, il n'y a rien à faire.",
      "Si ce n'est pas vous, utilisez tout de suite « Mot de passe oublié ? » sur la page « Compte », puis contactez DJAFAT.",
      '',
      "L'équipe DJAFAT",
    ].join('\n'),
  };
}

const NDJAMENA = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Ndjamena',
  dateStyle: 'long',
  timeStyle: 'short',
});

function ndjamenaTime(at: Date): string {
  return NDJAMENA.format(at);
}
