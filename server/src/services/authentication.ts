import type { Core } from '@strapi/strapi';
import { AUTHENTICATION_UID, DEFAULT_AUTH_PROVIDER } from '../constants';

const LOG_PREFIX = '[AuthManager]';

export interface AuthenticationRelationField {
  name: string;
  relation: string;
}

export interface AuthenticationEntry {
  id?: number;
  documentId?: string;
  provider: string;
  providerUserId: string;
  active?: boolean;
  memberCollection?: string;
  memberDocumentId?: string;
  metadata?: Record<string, any> | null;
  lastSyncedAt?: string;
}

export interface EnsureAuthenticationParams {
  provider?: string;
  providerUserId: string;
  memberCollectionUid: string;
  memberDocumentId: string;
  memberEntry?: any;
  organizationIdentifier?: string | null;
  organizationDocumentId?: string | null;
  metadata?: Record<string, any> | null;
}

export interface FindAuthenticationParams {
  provider?: string;
  providerUserId: string;
  organizationIdentifier?: string | null;
  organizationDocumentId?: string | null;
  memberCollectionUid?: string | null;
}

function normalizeProvider(provider?: string | null) {
  const value = String(provider || '').trim();
  return value || DEFAULT_AUTH_PROVIDER;
}

function relationValueToArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') return [value.data];
  if (typeof value === 'object') return [value];
  return [];
}

function normalizeAuthentication(entry: any): AuthenticationEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const source =
    entry.attributes && typeof entry.attributes === 'object'
      ? { id: entry.id, documentId: entry.documentId, ...entry.attributes }
      : entry;

  if (!source.providerUserId) return null;

  return {
    id: source.id,
    documentId: source.documentId,
    provider: normalizeProvider(source.provider),
    providerUserId: source.providerUserId,
    active: source.active,
    memberCollection: source.memberCollection,
    memberDocumentId: source.memberDocumentId,
    metadata: source.metadata || null,
    lastSyncedAt: source.lastSyncedAt,
  };
}

function getMetadataOrganization(metadata?: Record<string, any> | null) {
  if (!metadata || typeof metadata !== 'object') return {};
  const organization = metadata.organization;
  if (organization && typeof organization === 'object') {
    return {
      identifier: organization.identifier || metadata.organizationIdentifier || null,
      documentId: organization.documentId || metadata.organizationDocumentId || null,
    };
  }
  return {
    identifier:
      metadata.organizationIdentifier || (typeof organization === 'string' ? organization : null),
    documentId: metadata.organizationDocumentId || null,
  };
}

function metadataMatchesOrganization(
  metadata: Record<string, any> | null | undefined,
  organizationIdentifier?: string | null,
  organizationDocumentId?: string | null
) {
  if (!organizationIdentifier && !organizationDocumentId) return true;

  const organization = getMetadataOrganization(metadata);
  if (organizationIdentifier && organization.identifier === organizationIdentifier) return true;
  if (organizationDocumentId && organization.documentId === organizationDocumentId) return true;

  return !organization.identifier && !organization.documentId;
}

function buildMetadata(
  existing: Record<string, any> | null | undefined,
  params: EnsureAuthenticationParams
) {
  const metadata: Record<string, any> = {
    ...(existing || {}),
    ...(params.metadata || {}),
  };

  if (params.organizationIdentifier || params.organizationDocumentId) {
    metadata.organization = {
      ...(typeof metadata.organization === 'object' && metadata.organization
        ? metadata.organization
        : {}),
      ...(params.organizationIdentifier ? { identifier: params.organizationIdentifier } : {}),
      ...(params.organizationDocumentId ? { documentId: params.organizationDocumentId } : {}),
    };
  }

  return metadata;
}

export function findMemberAuthenticationRelationFields(
  strapi: Core.Strapi,
  memberCollectionUid: string
): AuthenticationRelationField[] {
  const contentType = strapi.contentTypes[memberCollectionUid];
  if (!contentType?.attributes) return [];

  const fields: AuthenticationRelationField[] = [];
  for (const [name, attrDef] of Object.entries(contentType.attributes)) {
    const attr = attrDef as any;
    if (attr.type === 'relation' && attr.target === AUTHENTICATION_UID) {
      fields.push({ name, relation: attr.relation });
    }
  }

  return fields;
}

function extractAuthenticationsFromMemberEntry(
  memberEntry: any,
  relationFields: AuthenticationRelationField[]
): AuthenticationEntry[] {
  const byDocumentId = new Map<string, AuthenticationEntry>();
  const byProviderUserId = new Map<string, AuthenticationEntry>();

  for (const field of relationFields) {
    for (const rawAuthentication of relationValueToArray(memberEntry?.[field.name])) {
      const authentication = normalizeAuthentication(rawAuthentication);
      if (!authentication) continue;

      if (authentication.documentId) {
        byDocumentId.set(authentication.documentId, authentication);
      } else {
        byProviderUserId.set(
          `${authentication.provider}:${authentication.providerUserId}`,
          authentication
        );
      }
    }
  }

  return [...byDocumentId.values(), ...byProviderUserId.values()];
}

async function fetchMemberWithAuthenticationRelations(
  strapi: Core.Strapi,
  memberCollectionUid: string,
  memberDocumentId: string,
  relationFields: AuthenticationRelationField[]
) {
  const populate = relationFields.reduce<Record<string, true>>((acc, field) => {
    acc[field.name] = true;
    return acc;
  }, {});

  return strapi.documents(memberCollectionUid as any).findOne({
    documentId: memberDocumentId,
    populate,
  });
}

async function fetchAuthenticationsByMemberMetadata(
  strapi: Core.Strapi,
  memberCollectionUid: string,
  memberDocumentId: string
) {
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: {
      memberCollection: memberCollectionUid,
      memberDocumentId,
    } as any,
    limit: 1000,
    sort: { createdAt: 'asc' },
  });

  return (rows || []).map(normalizeAuthentication).filter(Boolean) as AuthenticationEntry[];
}

async function connectAuthenticationToMember(
  strapi: Core.Strapi,
  memberCollectionUid: string,
  memberDocumentId: string,
  relationField: AuthenticationRelationField | null,
  authenticationDocumentId?: string
) {
  if (!relationField || !authenticationDocumentId) return;

  await strapi.documents(memberCollectionUid as any).update({
    documentId: memberDocumentId,
    data: {
      [relationField.name]: {
        connect: [{ documentId: authenticationDocumentId }],
      },
    },
  });
}

async function findExistingAuthentication(strapi: Core.Strapi, params: EnsureAuthenticationParams) {
  const provider = normalizeProvider(params.provider);
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: {
      provider,
      providerUserId: params.providerUserId,
      memberCollection: params.memberCollectionUid,
      memberDocumentId: params.memberDocumentId,
    } as any,
    limit: 100,
    sort: { createdAt: 'asc' },
  });

  const authentications = (rows || [])
    .map(normalizeAuthentication)
    .filter(Boolean) as AuthenticationEntry[];

  const organizationMatch = authentications.find((authentication) =>
    metadataMatchesOrganization(
      authentication.metadata,
      params.organizationIdentifier,
      params.organizationDocumentId
    )
  );

  return organizationMatch || null;
}

async function ensureAuthenticationForMember(
  strapi: Core.Strapi,
  params: EnsureAuthenticationParams
) {
  const provider = normalizeProvider(params.provider);
  const relationFields = findMemberAuthenticationRelationFields(strapi, params.memberCollectionUid);
  const relationField = relationFields[0] || null;
  const existing = await findExistingAuthentication(strapi, {
    ...params,
    provider,
  });
  const metadata = buildMetadata(existing?.metadata, params);
  const lastSyncedAt = new Date().toISOString();

  if (existing?.documentId) {
    const updated = await strapi.documents(AUTHENTICATION_UID as any).update({
      documentId: existing.documentId,
      data: {
        active: true,
        metadata,
        memberCollection: params.memberCollectionUid,
        memberDocumentId: params.memberDocumentId,
        lastSyncedAt,
      } as any,
    });

    await connectAuthenticationToMember(
      strapi,
      params.memberCollectionUid,
      params.memberDocumentId,
      relationField,
      (updated as any).documentId
    );

    return normalizeAuthentication(updated);
  }

  const created = await strapi.documents(AUTHENTICATION_UID as any).create({
    data: {
      provider,
      providerUserId: params.providerUserId,
      active: true,
      memberCollection: params.memberCollectionUid,
      memberDocumentId: params.memberDocumentId,
      metadata,
      lastSyncedAt,
    } as any,
  });

  await connectAuthenticationToMember(
    strapi,
    params.memberCollectionUid,
    params.memberDocumentId,
    relationField,
    (created as any).documentId
  );

  strapi.log.info(
    `${LOG_PREFIX} Linked ${provider}:${params.providerUserId} to ${params.memberCollectionUid}:${params.memberDocumentId}`
  );

  return normalizeAuthentication(created);
}

async function getAuthenticationsForMember(
  strapi: Core.Strapi,
  memberCollectionUid: string,
  memberDocumentId: string,
  memberEntry?: any
) {
  if (!strapi.contentTypes[AUTHENTICATION_UID]) return [];

  const relationFields = findMemberAuthenticationRelationFields(strapi, memberCollectionUid);
  let entry = memberEntry;

  if (relationFields.length > 0) {
    const hasPopulatedRelation = relationFields.some((field) => field.name in (entry || {}));
    if (!entry || !hasPopulatedRelation) {
      try {
        entry = await fetchMemberWithAuthenticationRelations(
          strapi,
          memberCollectionUid,
          memberDocumentId,
          relationFields
        );
      } catch (err: any) {
        strapi.log.debug(
          `${LOG_PREFIX} Failed to fetch member authentication relations: ${err.message}`
        );
      }
    }

    const relationAuthentications = extractAuthenticationsFromMemberEntry(entry, relationFields);
    if (relationAuthentications.length > 0) return relationAuthentications;
  }

  return fetchAuthenticationsByMemberMetadata(strapi, memberCollectionUid, memberDocumentId);
}

async function findMemberByAuthentication(strapi: Core.Strapi, params: FindAuthenticationParams) {
  const provider = normalizeProvider(params.provider);
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: {
      provider,
      providerUserId: params.providerUserId,
      ...(params.memberCollectionUid ? { memberCollection: params.memberCollectionUid } : {}),
    } as any,
    limit: 100,
    sort: { createdAt: 'asc' },
  });

  const authentications = (rows || [])
    .map(normalizeAuthentication)
    .filter(Boolean) as AuthenticationEntry[];

  const authentication = authentications.find((entry) =>
    metadataMatchesOrganization(
      entry.metadata,
      params.organizationIdentifier,
      params.organizationDocumentId
    )
  );

  if (!authentication?.memberCollection || !authentication.memberDocumentId) return null;

  return {
    authentication,
    memberCollectionUid: authentication.memberCollection,
    memberDocumentId: authentication.memberDocumentId,
  };
}

function toLegacyAuthEntry(authentication: AuthenticationEntry) {
  const organization = getMetadataOrganization(authentication.metadata);

  return {
    provider: authentication.provider,
    providerUserId: authentication.providerUserId,
    ssoId: authentication.providerUserId,
    organization: organization.identifier || organization.documentId || null,
  };
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  findMemberAuthenticationRelationFields: (memberCollectionUid: string) =>
    findMemberAuthenticationRelationFields(strapi, memberCollectionUid),
  ensureAuthenticationForMember: (params: EnsureAuthenticationParams) =>
    ensureAuthenticationForMember(strapi, params),
  getAuthenticationsForMember: (
    memberCollectionUid: string,
    memberDocumentId: string,
    memberEntry?: any
  ) => getAuthenticationsForMember(strapi, memberCollectionUid, memberDocumentId, memberEntry),
  findMemberByAuthentication: (params: FindAuthenticationParams) =>
    findMemberByAuthentication(strapi, params),
  toLegacyAuthEntry,
});
