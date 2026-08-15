import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ENCRYPTED_INTEGRATION_FIELDS,
  decryptToken,
  encryptToken,
} from './token-encryption';

/**
 * PrimusPost fork: transparently encrypt Integration credentials at rest.
 *
 * Applied as a Prisma client extension rather than at the repository call sites
 * because `token` is read in ~28 places across 11 files. Patching each one is
 * how you eventually miss a read path and either break publishing or, worse,
 * hand raw ciphertext to a social API. Intercepting at the client means every
 * query is covered no matter who calls it or when someone adds a new call site.
 *
 * See token-encryption.ts for the envelope-encryption design.
 */
// Depth cap. Prisma results nest through includes, and a bounded walk is enough
// for every real shape while guaranteeing termination on anything unexpected.
const MAX_DEPTH = 8;

async function mapEncryptedFields(
  value: unknown,
  transform: (v: unknown) => Promise<unknown>,
  depth = 0
): Promise<unknown> {
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item) => mapEncryptedFields(item, transform, depth + 1))
    );
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Leave non-plain objects alone: Date, Buffer and Decimal have no credential
  // fields and walking them wastes time or mangles them.
  if (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    typeof (value as { toISOString?: unknown }).toISOString === 'function'
  ) {
    return value;
  }

  const record = value as Record<string, unknown>;

  for (const [key, current] of Object.entries(record)) {
    if ((ENCRYPTED_INTEGRATION_FIELDS as readonly string[]).includes(key)) {
      // Prisma write payloads can be `{ set: value }` rather than a bare value.
      if (current && typeof current === 'object' && 'set' in (current as object)) {
        const wrapper = current as Record<string, unknown>;
        wrapper.set = await transform(wrapper.set);
      } else {
        record[key] = await transform(current);
      }
      continue;
    }

    // RECURSE. This is the part that was missing.
    //
    // The publish path loads the integration as a NESTED RELATION on a post
    // (`post.integration`, via include), so the Prisma operation is on the POST
    // model, not the integration model. A model-scoped extension never fires,
    // and the token reaches the social provider as raw ciphertext — which
    // presents as LinkedIn returning INVALID_ACCESS_TOKEN and looks for all the
    // world like a dead credential. Found on the 2026-08-15 spike, only because
    // the decrypted token was probed against LinkedIn directly and came back
    // valid.
    if (current && typeof current === 'object') {
      record[key] = await mapEncryptedFields(current, transform, depth + 1);
    }
  }

  return record;
}

function buildEncryptedClient(client: PrismaClient) {
  return client.$extends({
    query: {
      // $allModels, not just `integration`.
      //
      // Scoping this to the integration model was a real bug: the publish path
      // reads the token through `post.integration` (a nested include), which is
      // a POST operation, so the extension never fired and ciphertext was handed
      // to the social provider. Any model can return an integration through a
      // relation, so every model has to be covered.
      $allModels: {
        async $allOperations({ operation, args, query }: any) {
          // Encrypt on the way in.
          if (args?.data) {
            args.data = await mapEncryptedFields(args.data, encryptToken);
          }
          if (args?.create) {
            args.create = await mapEncryptedFields(args.create, encryptToken);
          }
          if (args?.update) {
            args.update = await mapEncryptedFields(args.update, encryptToken);
          }

          const result = await query(args);

          // Decrypt on the way out. Aggregate and count operations return no
          // rows, so there is nothing to transform.
          if (operation.startsWith('count') || operation.startsWith('aggregate')) {
            return result;
          }

          return mapEncryptedFields(result, decryptToken);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * The extended client. Repositories talk to this, so credential encryption is
   * not something an individual call site can forget.
   */
  public readonly encrypted: ReturnType<typeof buildEncryptedClient>;

  constructor() {
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    });

    this.encrypted = buildEncryptedClient(this);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaRepository<T extends keyof PrismaService> {
  public model: Pick<PrismaService, T>;
  constructor(private _prismaService: PrismaService) {
    // Routed through the extended client so Integration credentials are
    // encrypted on write and decrypted on read for every consumer. The cast
    // keeps the existing `Pick<PrismaService, T>` shape that repositories are
    // typed against; the extension changes runtime behaviour, not the model
    // surface these repositories use.
    this.model = this._prismaService
      .encrypted as unknown as Pick<PrismaService, T>;
  }
}

@Injectable()
export class PrismaTransaction {
  public model: Pick<PrismaService, '$transaction'>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}
