import type { CodeChannelId } from '@djafat/sdk';

/*
 * The login method icons of kcerha's commit 628dce4 (branch
 * fix/login-method-icons, 0.23.6), moved here when FEAT-020 replaced the old
 * `/connexion` page: the account screens keep them instead of emoji.
 */

/** Line icons for the login method tabs — no emoji, no external icon library. */
export function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a9 9 0 0 0-7.75 13.5L3 21l4.62-1.2A9 9 0 1 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.3 8.6c.2-.5.5-.5.7-.5h.5c.2 0 .4 0 .6.4.2.4.6 1.4.6 1.5.1.1.1.3 0 .4-.1.2-.1.3-.3.5l-.3.4c-.1.1-.2.3-.1.5.2.3.7 1.1 1.4 1.7.9.8 1.6 1 1.9 1.1.2.1.4.1.5-.1l.5-.6c.2-.2.3-.2.5-.1l1.3.6c.2.1.3.1.4.2.1.1.1.6-.1 1.1-.2.5-1.1 1-1.6 1-.4 0-1.6-.1-3.1-1.3-1.9-1.5-3-3.3-3.2-3.7-.2-.4-.9-1.5-.9-2.3 0-.8.4-1.2.6-1.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SmsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m4.5 6.5 6.47 5.06a1.6 1.6 0 0 0 1.97 0L19.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The icon of a code channel (FEAT-020: « ou recevoir un code », profile phone section). */
export function ChannelIcon({ id }: { readonly id: CodeChannelId }) {
  if (id === 'whatsapp') return <WhatsAppIcon />;
  if (id === 'sms') return <SmsIcon />;
  return <EmailIcon />;
}
