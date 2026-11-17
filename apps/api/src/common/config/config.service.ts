import { Injectable, Logger } from '@nestjs/common';
import { type ApiEnv, apiEnvSecretIssues, loadApiEnv } from '@djafat/config';

/**
 * The ONE place env is read. Parsed & validated once at construction — the
 * process throws (and the API never binds a port) if the environment is invalid.
 */
@Injectable()
export class AppConfigService {
  private readonly env: ApiEnv;

  constructor() {
    this.env = loadApiEnv();
    // Production has already refused these (audit finding SEC-01). A local or
    // test setup still starts, and says what production would refuse.
    const secretIssues = apiEnvSecretIssues(this.env);
    if (secretIssues.length > 0) {
      new Logger(AppConfigService.name).warn(
        `Secrets production would refuse:\n  - ${secretIssues.join('\n  - ')}`,
      );
    }
  }

  get all(): Readonly<ApiEnv> {
    return this.env;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get<K extends keyof ApiEnv>(key: K): ApiEnv[K] {
    return this.env[key];
  }
}
