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
async function mapEncryptedFields(
  value: unknown,
  transform: (v: unknown) => Promise<unknown>
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => mapEncryptedFields(item, transform)));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;

  for (const field of ENCRYPTED_INTEGRATION_FIELDS) {
    if (field in record) {
      const current = record[field];
      // Prisma update payloads can be `{ set: value }` rather than a bare value.
      if (current && typeof current === 'object' && 'set' in (current as object)) {
        const wrapper = current as Record<string, unknown>;
        wrapper.set = await transform(wrapper.set);
      } else {
        record[field] = await transform(current);
      }
    }
  }

  return record;
}

function buildEncryptedClient(client: PrismaClient) {
  return client.$extends({
    query: {
      integration: {
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
