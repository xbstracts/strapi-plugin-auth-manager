# auth-manager

Display and collect authentication data from multi-providers

## Authentication Content Type

The plugin registers `plugin::auth-manager.authentication` for provider identities.
Current production sync uses provider `supertokens` and stores the SuperTokens user ID
in `providerUserId`.

Organization context is stored in `metadata.organization` instead of a dedicated
relation field so future providers can reuse the same model.

The mapped user content types are configured by the host app:

```ts
'auth-manager': {
  enabled: true,
  resolve: 'src/plugins/strapi-plugin-auth-manager',
  config: {
    defaultUserUid: 'api::contact.contact',
    users: [
      { uid: 'api::contact.contact', relationField: 'contact' },
    ],
  },
}
```

`uid` is the Strapi content type UID for an allowed user record. `relationField`
is optional; when set, it names a relation field on
`plugin::auth-manager.authentication` that targets the configured user UID. In
this workspace, the customer extension adds `contact` for that direct relation
while the legacy `auths` component remains as a compatibility mirror.

New rows use `userCollection` and `userDocumentId` as the canonical private
reference. `member`, `memberCollection`, and `memberDocumentId` remain as
deprecated migration fields and are dual-written until the next cleanup version.

## One-Time Migration

Dry run:

```bash
node scripts/migrate-contact-auths-to-auth-manager.mjs
```

Apply:

```bash
APPLY=true node scripts/migrate-contact-auths-to-auth-manager.mjs
```

Useful filters:

```bash
USER_DOCUMENT_IDS=abc,def APPLY=true node scripts/migrate-contact-auths-to-auth-manager.mjs
ORGANIZATIONS=brooks-brothers APPLY=true node scripts/migrate-contact-auths-to-auth-manager.mjs
```

The migration script still accepts the old `MEMBER_*` environment variables as
aliases. It re-scans legacy `auths` entries idempotently, creates missing
Authentication rows, repairs legacy `member*` rows into canonical `user*` fields,
and attaches compatible orphan Authentication rows by default. Rows already
linked to another user are reported as conflicts unless
`ALLOW_CONFLICT_RELINK=true` is explicitly set.

It does not clear legacy `auths` by default. Use `CLEAR_LEGACY=true` only after
the new content type and relation are verified in production; clearing removes
only component entries that were successfully migrated and leaves failed,
filtered, or conflicted entries in place.

To backfill existing auth-manager rows from deprecated `member*` fields into the
canonical `user*` fields, run:

```bash
node scripts/migrate-auth-manager-user-fields.mjs
APPLY=true node scripts/migrate-auth-manager-user-fields.mjs
```
