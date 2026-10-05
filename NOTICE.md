# Notice

This repository contains a modified version of **Postiz** (upstream: https://github.com/gitroomhq/postiz-app), originally licensed under the GNU Affero General Public License v3.0 (AGPL-3.0), copyright (c) its respective authors.

This modified version is maintained by **PrimusPost**. All modifications made by PrimusPost are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

## Base Version
- **Upstream Base Release:** `v2.24.0` (commit `8b84b0dc2767b757c2355158573635600ae027c7`)
- **Previous base:** `v2.23.0` (tag `v2.23.0-pp3`); the commits below were re-applied onto `v2.24.0` on 2026-10-05, original SHAs in brackets

## Modifications by PrimusPost

In compliance with AGPL-3.0 §5(a), the following modifications have been made relative to upstream release `v2.24.0`:

| Date | Commit SHA | Description |
|---|---|---|
| 2026-08-15 | `9ef69d29` (`4dfd69c7`) | fix(linkedin): make personal connect possible on a self-serve app (remove `prompt=none` and reduce scopes to `openid profile w_member_social`) |
| 2026-08-15 | `ed82af2d` (`29c857ec`) | feat(public-api): thread customer and redirectUrl through connect endpoint |
| 2026-08-15 | `89e0ac22` (`138413a5`) | feat(security): encrypt social tokens at rest via Google Cloud KMS envelope encryption, disable Sentry in code |
| 2026-08-15 | `373e9fb8` (`1749395e`) | chore: lock @google-cloud/kms@5.7.0 for token envelope encryption |
| 2026-08-15 | `1a9f6dad` (`2525a8dd`) | ci: publish fork images to our own ghcr namespace (ghcr.io/abhi9699/postiz-app) |
| 2026-08-15 | `1c9781d8` (`b6722ebd`) | fix(security): decrypt tokens on nested relations, not just direct queries |
| 2026-09-19 | `2d4285a8` (`8b89f1ea`) | fix(security): null credentials on delete/disconnect (§A #90) |
| 2026-09-19 | `93ab1236` (`7572e7c6`) | test(security): assert token-encryption passthrough for nulled credentials (§A #90) |

## Modified Files Not Supporting Source Comments

Per AGPL §5(a), source files that do not support inline comment syntax or are machine-generated configuration/lockfiles are recorded here:
- `package.json`: Added `@google-cloud/kms` dependency for token envelope encryption at rest.
- `pnpm-lock.yaml`: Dependency lockfile updated for `@google-cloud/kms@5.7.0`.
- `libraries/nestjs-libraries/src/database/prisma/schema.prisma`: Made `Integration.token` nullable (`String?`) to allow secure nulling on channel erasure / disconnect.

## License
All modifications copyright (c) 2026 PrimusPost authors.
All modifications are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE).
