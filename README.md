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
this workspace, the customer extension adds `contact` for that direct relation.

Rows use `userCollection` and `userDocumentId` as the canonical private
reference.

## Contact Sync

Host applications should create and repair Authentication rows through the
plugin service or through their own integration endpoint. This workspace uses
`POST /api/contacts/sync-auth` and `POST /api/contacts/sync-provider` to sync
SuperTokens IDs into auth-manager rows linked to Contact.
