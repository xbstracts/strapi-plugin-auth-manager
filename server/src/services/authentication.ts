import type { Core } from '@strapi/strapi';
import { AUTHENTICATION_UID, DEFAULT_AUTH_PROVIDER, PLUGIN_ID } from '../constants';

const LOG_PREFIX = '[AuthManager]';

export interface AuthenticationRelationField {
  name: string;
  relation?: string;
  target?: string;
}

export interface AuthManagerUserConfig {
  uid: string;
  relationField?: string;
}

export interface AuthManagerConfig {
  defaultUserUid?: string;
  users?: AuthManagerUserConfig[];
}

export interface AuthenticationEntry {
  id?: number;
  documentId?: string;
  provider: string;
  providerUserId: string;
  active?: boolean;
  userCollection?: string;
  userDocumentId?: string;
  memberCollection?: string;
  memberDocumentId?: string;
  metadata?: Record<string, any> | null;
  lastSyncedAt?: string;
}

export interface EnsureAuthenticationParams {
  provider?: string;
  providerUserId: string;
  userCollectionUid?: string | null;
  userDocumentId?: string | null;
  memberCollectionUid?: string | null;
  memberDocumentId?: string | null;
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
  userCollectionUid?: string | null;
  memberCollectionUid?: string | null;
}

export interface AuthenticationUserReference {
  authentication: AuthenticationEntry;
  userCollectionUid: string;
  userDocumentId: string;
  memberCollectionUid: string;
  memberDocumentId: string;
}

function cleanString(value?: string | null) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeProvider(provider?: string | null) {
  return cleanString(provider) || DEFAULT_AUTH_PROVIDER;
}

function getRawPluginConfig(strapi: Core.Strapi): any {
  const config = (strapi as any).config;
  if (!config?.get) return {};

  return config.get(`plugin::${PLUGIN_ID}`) || config.get(`plugin.${PLUGIN_ID}`) || {};
}

function getPluginConfig(strapi: Core.Strapi): AuthManagerConfig {
  const raw = getRawPluginConfig(strapi);
  const config = raw?.config && !raw.users ? raw.config : raw;
  return config && typeof config === 'object' ? config : {};
}

function getConfiguredUsers(strapi: Core.Strapi): AuthManagerUserConfig[] {
  const config = getPluginConfig(strapi);
  if (!Array.isArray(config.users)) return [];

  return config.users
    .map((entry) => ({
      uid: cleanString(entry?.uid) || '',
      relationField: cleanString(entry?.relationField) || undefined,
    }))
    .filter((entry) => entry.uid);
}

function getDefaultUserUid(strapi: Core.Strapi) {
  const config = getPluginConfig(strapi);
  return cleanString(config.defaultUserUid) || getConfiguredUsers(strapi)[0]?.uid || null;
}

function getConfiguredUser(strapi: Core.Strapi, userCollectionUid: string) {
  return getConfiguredUsers(strapi).find((entry) => entry.uid === userCollectionUid) || null;
}

function validateUserCollectionUid(strapi: Core.Strapi, userCollectionUid: string) {
  const configuredUsers = getConfiguredUsers(strapi);
  if (
    configuredUsers.length > 0 &&
    !configuredUsers.some((entry) => entry.uid === userCollectionUid)
  ) {
    throw new Error(`User content type "${userCollectionUid}" is not configured in auth-manager config.users`);
  }

  if (!strapi.contentTypes?.[userCollectionUid]) {
    throw new Error(`User content type "${userCollectionUid}" is not registered`);
  }
}

function resolveUserReference(strapi: Core.Strapi, params: EnsureAuthenticationParams) {
  const userCollectionUid =
    cleanString(params.userCollectionUid) ||
    cleanString(params.memberCollectionUid) ||
    getDefaultUserUid(strapi);
  const userDocumentId =
    cleanString(params.userDocumentId) || cleanString(params.memberDocumentId);

  if (!userCollectionUid) {
    throw new Error('userCollectionUid is required');
  }
  if (!userDocumentId) {
    throw new Error('userDocumentId is required');
  }

  validateUserCollectionUid(strapi, userCollectionUid);

  return {
    userCollectionUid,
    userDocumentId,
  };
}

function resolveOptionalUserCollectionUid(strapi: Core.Strapi, params: FindAuthenticationParams) {
  const userCollectionUid =
    cleanString(params.userCollectionUid) ||
    cleanString(params.memberCollectionUid) ||
    getDefaultUserUid(strapi);

  if (userCollectionUid) {
    validateUserCollectionUid(strapi, userCollectionUid);
  }

  return userCollectionUid;
}

function normalizeAuthentication(entry: any): AuthenticationEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const source =
    entry.attributes && typeof entry.attributes === 'object'
      ? { id: entry.id, documentId: entry.documentId, ...entry.attributes }
      : entry;

  if (!source.providerUserId) return null;

  const userCollection = source.userCollection || source.memberCollection || undefined;
  const userDocumentId = source.userDocumentId || source.memberDocumentId || undefined;
  const memberCollection = source.memberCollection || userCollection || undefined;
  const memberDocumentId = source.memberDocumentId || userDocumentId || undefined;

  return {
    id: source.id,
    documentId: source.documentId,
    provider: normalizeProvider(source.provider),
    providerUserId: source.providerUserId,
    active: source.active,
    userCollection,
    userDocumentId,
    memberCollection,
    memberDocumentId,
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

function buildUserReferenceData(userCollectionUid: string, userDocumentId: string) {
  return {
    userCollection: userCollectionUid,
    userDocumentId,
    memberCollection: userCollectionUid,
    memberDocumentId: userDocumentId,
  };
}

function buildUserReferenceFilter(userCollectionUid: string, userDocumentId?: string | null) {
  const userFilter: Record<string, any> = {
    userCollection: userCollectionUid,
  };
  const memberFilter: Record<string, any> = {
    memberCollection: userCollectionUid,
  };

  if (userDocumentId) {
    userFilter.userDocumentId = userDocumentId;
    memberFilter.memberDocumentId = userDocumentId;
  }

  return {
    $or: [userFilter, memberFilter],
  };
}

export function findUserAuthenticationRelationField(
  strapi: Core.Strapi,
  userCollectionUid: string
): AuthenticationRelationField | null {
  const configuredUser = getConfiguredUser(strapi, userCollectionUid);
  const relationField = cleanString(configuredUser?.relationField);
  if (!relationField) return null;

  const attr = strapi.contentTypes?.[AUTHENTICATION_UID]?.attributes?.[relationField] as any;
  if (attr?.type === 'relation' && attr.target === userCollectionUid) {
    return {
      name: relationField,
      relation: attr.relation,
      target: attr.target,
    };
  }

  strapi.log.warn(
    `${LOG_PREFIX} Configured relationField "${relationField}" for ${userCollectionUid} was not found on ${AUTHENTICATION_UID}; skipping direct relation sync.`
  );

  return null;
}

export function findMemberAuthenticationRelationFields(
  strapi: Core.Strapi,
  memberCollectionUid: string
): AuthenticationRelationField[] {
  const relationField = findUserAuthenticationRelationField(strapi, memberCollectionUid);
  return relationField ? [relationField] : [];
}

async function fetchAuthenticationsByUserMetadata(
  strapi: Core.Strapi,
  userCollectionUid: string,
  userDocumentId: string
) {
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: buildUserReferenceFilter(userCollectionUid, userDocumentId) as any,
    limit: 1000,
    sort: { createdAt: 'asc' },
  });

  return (rows || []).map(normalizeAuthentication).filter(Boolean) as AuthenticationEntry[];
}

async function connectAuthenticationToConfiguredUserRelation(
  strapi: Core.Strapi,
  userCollectionUid: string,
  userDocumentId: string,
  authenticationDocumentId?: string
) {
  if (!authenticationDocumentId) return;

  const relationField = findUserAuthenticationRelationField(strapi, userCollectionUid);
  if (!relationField) return;

  await strapi.documents(AUTHENTICATION_UID as any).update({
    documentId: authenticationDocumentId,
    fields: ['documentId'],
    populate: {},
    data: {
      [relationField.name]: {
        connect: [{ documentId: userDocumentId }],
      },
    } as any,
  });
}

async function findExistingAuthentication(
  strapi: Core.Strapi,
  params: EnsureAuthenticationParams,
  userCollectionUid: string,
  userDocumentId: string
) {
  const provider = normalizeProvider(params.provider);
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: {
      provider,
      providerUserId: params.providerUserId,
      ...buildUserReferenceFilter(userCollectionUid, userDocumentId),
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

async function ensureAuthenticationForUser(
  strapi: Core.Strapi,
  params: EnsureAuthenticationParams
) {
  const provider = normalizeProvider(params.provider);
  const { userCollectionUid, userDocumentId } = resolveUserReference(strapi, params);
  const existing = await findExistingAuthentication(strapi, params, userCollectionUid, userDocumentId);
  const metadata = buildMetadata(existing?.metadata, params);
  const lastSyncedAt = new Date().toISOString();
  const userReferenceData = buildUserReferenceData(userCollectionUid, userDocumentId);

  if (existing?.documentId) {
    const updated = await strapi.documents(AUTHENTICATION_UID as any).update({
      documentId: existing.documentId,
      data: {
        active: true,
        metadata,
        ...userReferenceData,
        lastSyncedAt,
      } as any,
    });

    await connectAuthenticationToConfiguredUserRelation(
      strapi,
      userCollectionUid,
      userDocumentId,
      (updated as any).documentId
    );

    return normalizeAuthentication(updated);
  }

  const created = await strapi.documents(AUTHENTICATION_UID as any).create({
    data: {
      provider,
      providerUserId: params.providerUserId,
      active: true,
      ...userReferenceData,
      metadata,
      lastSyncedAt,
    } as any,
  });

  await connectAuthenticationToConfiguredUserRelation(
    strapi,
    userCollectionUid,
    userDocumentId,
    (created as any).documentId
  );

  strapi.log.info(
    `${LOG_PREFIX} Linked ${provider}:${params.providerUserId} to ${userCollectionUid}:${userDocumentId}`
  );

  return normalizeAuthentication(created);
}

async function getAuthenticationsForUser(
  strapi: Core.Strapi,
  userCollectionUid: string,
  userDocumentId: string,
  _userEntry?: any
) {
  if (!strapi.contentTypes[AUTHENTICATION_UID]) return [];

  validateUserCollectionUid(strapi, userCollectionUid);
  return fetchAuthenticationsByUserMetadata(strapi, userCollectionUid, userDocumentId);
}

async function findUserByAuthentication(strapi: Core.Strapi, params: FindAuthenticationParams) {
  const provider = normalizeProvider(params.provider);
  const userCollectionUid = resolveOptionalUserCollectionUid(strapi, params);
  const rows = await strapi.documents(AUTHENTICATION_UID as any).findMany({
    filters: {
      provider,
      providerUserId: params.providerUserId,
      ...(userCollectionUid ? buildUserReferenceFilter(userCollectionUid) : {}),
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

  const resolvedUserCollection = authentication?.userCollection || authentication?.memberCollection;
  const resolvedUserDocumentId = authentication?.userDocumentId || authentication?.memberDocumentId;
  if (!authentication || !resolvedUserCollection || !resolvedUserDocumentId) return null;

  return {
    authentication,
    userCollectionUid: resolvedUserCollection,
    userDocumentId: resolvedUserDocumentId,
    memberCollectionUid: resolvedUserCollection,
    memberDocumentId: resolvedUserDocumentId,
  } satisfies AuthenticationUserReference;
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
  findUserAuthenticationRelationField: (userCollectionUid: string) =>
    findUserAuthenticationRelationField(strapi, userCollectionUid),
  findMemberAuthenticationRelationFields: (memberCollectionUid: string) =>
    findMemberAuthenticationRelationFields(strapi, memberCollectionUid),
  ensureAuthenticationForUser: (params: EnsureAuthenticationParams) =>
    ensureAuthenticationForUser(strapi, params),
  ensureAuthenticationForMember: (params: EnsureAuthenticationParams) =>
    ensureAuthenticationForUser(strapi, params),
  getAuthenticationsForUser: (
    userCollectionUid: string,
    userDocumentId: string,
    userEntry?: any
  ) => getAuthenticationsForUser(strapi, userCollectionUid, userDocumentId, userEntry),
  getAuthenticationsForMember: (
    memberCollectionUid: string,
    memberDocumentId: string,
    memberEntry?: any
  ) => getAuthenticationsForUser(strapi, memberCollectionUid, memberDocumentId, memberEntry),
  findUserByAuthentication: (params: FindAuthenticationParams) =>
    findUserByAuthentication(strapi, params),
  findMemberByAuthentication: (params: FindAuthenticationParams) =>
    findUserByAuthentication(strapi, params),
  toLegacyAuthEntry,
});
