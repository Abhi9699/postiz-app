// Modified by PrimusPost, 2026-08-15: disable backend Sentry initialisation unconditionally. See NOTICE.md.
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';

export const initializeSentry = (appName: string, allowLogs = false) => {
  // PrimusPost fork: Sentry is disabled unconditionally.
  //
  // Upstream already skips initialisation when NEXT_PUBLIC_SENTRY_DSN is unset,
  // so this is belt and braces — but deliberately so. Disabled-by-configuration
  // is one stray environment variable away from being enabled, in an image whose
  // env we do not fully control across upgrades. Disabled-by-code cannot be
  // switched on by accident.
  //
  // This matters more than a typical telemetry opt-out because of WHAT the
  // upstream configuration below would send if a DSN ever appeared:
  //   - consoleLoggingIntegration captures every console line at every level
  //   - openAIIntegration sets recordInputs/recordOutputs, i.e. AI prompts and
  //     completions
  //   - tracesSampleRate 1.0, so every request
  // On a multi-tenant deployment that is customer content leaving our
  // infrastructure to a third party.
  //
  // To re-enable deliberately, delete this return and audit the integrations
  // above first.
  return null;

  // eslint-disable-next-line no-unreachable
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Postiz ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        Sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error', 'debug', 'assert', 'trace'] }),
        Sentry.openAIIntegration({
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
      tracesSampleRate: 1.0,
      enableLogs: true,

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.45,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
