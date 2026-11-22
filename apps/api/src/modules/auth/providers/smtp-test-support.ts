import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import type { AppConfigService } from '../../../common/config/config.service';

/**
 * Test support for the email adapters (FEAT-007, FEAT-020): a REAL local SMTP
 * server (smtp-server) that records what it receives, and a config fake.
 * Test code only — production never imports a `*-test-support` file.
 */

export interface Received {
  readonly from: string | undefined;
  readonly to: string[];
  readonly raw: string;
}

const servers: SMTPServer[] = [];

/** Close every sink opened by `smtpSink` (call from `afterEach`). */
export async function closeSmtpSinks(): Promise<void> {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
}

export async function smtpSink(): Promise<{ url: string; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true, // local test sink only: accept AUTH without TLS
    onAuth(_auth, _session, callback) {
      callback(null, { user: 'mailer' });
    },
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString()));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        callback();
      });
    },
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.server.address() as AddressInfo).port;
  return { url: `smtp://127.0.0.1:${port}`, port, received };
}

export function configFake(values: Record<string, unknown>): AppConfigService {
  return {
    get: (k: string) => values[k],
    isProduction: values['NODE_ENV'] === 'production',
  } as unknown as AppConfigService;
}

/** The raw message body, quoted-printable soft breaks and `=XX` escapes decoded (UTF-8). */
export function decodedBody(raw: string): string {
  const unfolded = raw.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i += 1) {
    const hex = unfolded.slice(i + 1, i + 3);
    if (unfolded[i] === '=' && /^[0-9A-F]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
