import type { AccountNotice, Applicant } from '../account-notice.port';

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
  if (notice.kind === 'welcome') return welcomeMessage(notice.applicant);
  if (notice.kind === 'application_approved') return approvedMessage(notice.applicant);
  if (notice.kind === 'application_rejected') {
    return rejectedMessage(notice.applicant, notice.reason);
  }
  if (notice.kind === 'email_changed') {
    return {
      subject: 'L’adresse e-mail de votre compte DJAFAT a été changée',
      text: [
        'Bonjour,',
        '',
        `L'adresse e-mail de votre compte DJAFAT a été remplacée par ${notice.newAddress} le ${ndjamenaTime(notice.at)} (heure de N'Djamena).`,
        'Cette adresse-ci ne sert plus à vous connecter.',
        '',
        "Si c'est vous, il n'y a rien à faire.",
        "Si ce n'est pas vous, contactez DJAFAT tout de suite : quelqu'un utilise peut-être votre compte.",
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

/** FEAT-022 SPEC-022-02 R8, SPEC-022-03 R6: what to complete after signing up, and where. */
function welcomeMessage(applicant: Applicant): { subject: string; text: string } {
  if (applicant.type === 'courier') {
    return {
      subject: 'Bienvenue sur DJAFAT : votre compte livreur est créé',
      text: [
        'Bonjour,',
        '',
        'Votre compte livreur DJAFAT est créé.',
        "Pour recevoir des courses, ouvrez l'application DJAFAT Livreur, connectez-vous avec cette adresse e-mail (mot de passe ou code reçu par e-mail), puis complétez :",
        '- une photo de votre visage ;',
        "- votre pièce d'identité (CNI ou passeport) ;",
        '- pour la moto et la voiture : votre permis et les papiers du véhicule (carte grise, assurance, plaque) ;',
        '- votre numéro Mobile Money (Airtel Money ou Moov Money) pour vos gains ;',
        "- un contact en cas d'urgence.",
        '',
        'Touchez ensuite « Envoyer pour validation » : DJAFAT vérifie votre dossier et vous répond par e-mail.',
        '',
        "L'équipe DJAFAT",
      ].join('\n'),
    };
  }
  return {
    subject: `Bienvenue sur DJAFAT : « ${applicant.restaurantName} » est inscrit`,
    text: [
      'Bonjour,',
      '',
      `Votre restaurant « ${applicant.restaurantName} » est inscrit sur DJAFAT. Il n'est pas encore visible des clients.`,
      'Ouvrez la console restaurant, connectez-vous avec cette adresse e-mail (mot de passe ou code reçu par e-mail), puis complétez les quatre étapes :',
      '1. Emplacement : le point sur la carte, l’adresse et un repère ;',
      '2. Horaires et menu, avec au moins un plat et son prix ;',
      '3. Logo et photo de couverture ;',
      "4. Papiers (numéro RCCM ou NIF, pièce d'identité du responsable) et numéro Mobile Money pour les paiements.",
      '',
      'Touchez ensuite « Envoyer pour validation » : DJAFAT vérifie le dossier et vous répond par e-mail.',
      '',
      "L'équipe DJAFAT",
    ].join('\n'),
  };
}

/** FEAT-022 SPEC-022-07 R5: « Votre restaurant est validé ». */
function approvedMessage(applicant: Applicant): { subject: string; text: string } {
  if (applicant.type === 'courier') {
    return {
      subject: 'Votre compte livreur DJAFAT est validé',
      text: [
        'Bonjour,',
        '',
        'DJAFAT a vérifié votre dossier de livreur : il est validé.',
        "Ouvrez l'application DJAFAT Livreur et passez « En ligne » pour recevoir vos premières courses.",
        '',
        "L'équipe DJAFAT",
      ].join('\n'),
    };
  }
  return {
    subject: `Votre restaurant « ${applicant.restaurantName} » est validé`,
    text: [
      'Bonjour,',
      '',
      `DJAFAT a vérifié le dossier de « ${applicant.restaurantName} » : il est validé.`,
      'Votre restaurant est maintenant visible des clients de DJAFAT.',
      'Suivez vos commandes dans la console restaurant.',
      '',
      "L'équipe DJAFAT",
    ].join('\n'),
  };
}

/** FEAT-022 SPEC-022-07 R4, R5: « Votre demande de livreur est refusée : <motif> ». */
function rejectedMessage(applicant: Applicant, reason: string): { subject: string; text: string } {
  const courier = applicant.type === 'courier';
  return {
    subject: courier
      ? 'Votre demande de livreur DJAFAT est refusée'
      : `Le dossier de « ${applicant.restaurantName} » est refusé`,
    text: [
      'Bonjour,',
      '',
      courier
        ? 'DJAFAT a vérifié votre dossier de livreur et ne peut pas le valider pour le moment.'
        : `DJAFAT a vérifié le dossier de « ${applicant.restaurantName} » et ne peut pas le valider pour le moment.`,
      `Motif : ${reason}`,
      '',
      courier
        ? "Ouvrez l'application DJAFAT Livreur, corrigez ce qui est demandé, puis touchez « Envoyer pour validation »."
        : 'Ouvrez la console restaurant, corrigez ce qui est demandé, puis touchez « Envoyer pour validation ».',
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
