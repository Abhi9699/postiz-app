# Notice

This repository contains a modified version of **Postiz** (upstream: https://github.com/gitroomhq/postiz-app), originally licensed under the GNU Affero General Public License v3.0 (AGPL-3.0), copyright (c) its respective authors.

This modified version is maintained by **PrimusPost**. All modifications made by PrimusPost are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

## Base Version
- **Upstream Base Release:** `v2.23.0` (commit `1e4c8dd5c4f70c4d0abd01e23cc42d5b533d1ab9`)

## Modifications by PrimusPost

In compliance with AGPL-3.0 §5(a), the following modifications have been made relative to upstream release `v2.23.0`:

| Date | Commit SHA | Description |
|---|---|---|
| 2026-08-15 | `4dfd69c7` | fix(linkedin): make personal connect possible on a self-serve app (remove `prompt=none` and reduce scopes to `openid profile w_member_social`) |
| 2026-08-15 | `29c857ec` | feat(public-api): thread customer and redirectUrl through connect endpoint |
| 2026-08-15 | `138413a5` | feat(security): encrypt social tokens at rest via Google Cloud KMS envelope encryption, disable Sentry in code |
| 2026-08-15 | `1749395e` | chore: lock @google-cloud/kms@5.7.0 for token envelope encryption |
| 2026-08-15 | `2525a8dd` | ci: publish fork images to our own ghcr namespace (ghcr.io/abhi9699/postiz-app) |
| 2026-08-15 | `b6722ebd` | fix(security): decrypt tokens on nested relations, not just direct queries |
| 2026-09-19 | `8b89f1ea` | fix(security): null credentials on delete/disconnect (§A #90) |
| 2026-09-19 | `7572e7c6` | test(security): assert token-encryption passthrough for nulled credentials (§A #90) |

## Modified Files Not Supporting Source Comments

Per AGPL §5(a), source files that do not support inline comment syntax or are machine-generated configuration/lockfiles are recorded here:
- `package.json`: Added `@google-cloud/kms` dependency for token envelope encryption at rest.
- `pnpm-lock.yaml`: Dependency lockfile updated for `@google-cloud/kms@5.7.0`.
- `libraries/nestjs-libraries/src/database/prisma/schema.prisma`: Made `Integration.token` nullable (`String?`) to allow secure nulling on channel erasure / disconnect.

## License
All modifications copyright (c) 2026 PrimusPost authors.
All modifications are licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE).
