/** Subject and plain-text body of the login-code email (FEAT-007, SPEC-007-01 R1). Pure. */
export function emailOtpMessage(
  code: string,
  ttlSeconds: number,
): { subject: string; text: string } {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
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
