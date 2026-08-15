import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';

export const setSentryUserContext = (params: {
  userId?: string;
  email?: string;
  orgId?: string;
  paymentId?: string | null;
}) => {
  try {
    Sentry.setUser(
      params.userId
        ? { id: params.userId, ...(params.email ? { email: params.email } : {}) }
        : null
    );
    if (params.orgId) {
      Sentry.setTag('organization.id', params.orgId);
    }
    if (params.paymentId?.startsWith('cus_')) {
      Sentry.setTag('stripe.customer_id', params.paymentId);
    }
  } catch (err) {
    /* never let telemetry break a request */
  }
};

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
      tracesSampler: ({ name, attributes, normalizedRequest, inheritOrSampleWith }) => {
        const path = String(
          normalizedRequest?.url || attributes?.['http.target'] || attributes?.['url.path'] || name || ''
        );
        const method = String(
          normalizedRequest?.method || attributes?.['http.request.method'] || attributes?.['http.method'] || ''
        );
        // MCP stream GETs are declined with 405; never trace them
        if (method === 'GET' && /^(https?:\/\/[^/]+)?\/mcp(\/|-oauth|\?|$)/.test(path)) {
          return 0;
        }
        return inheritOrSampleWith(
          path.includes('/public/v1/analytics/') ? 0.01 : 0.1
        );
      },
      enableLogs: true,

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.2,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
