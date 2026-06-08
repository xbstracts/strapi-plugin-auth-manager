import type { Core } from '@strapi/strapi';
import { DEFAULT_AUTH_PROVIDER } from '../constants';

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}

function isBadRequestError(error: any) {
  const message = String(error?.message || '');
  return (
    message.includes(' is required') ||
    message.includes(' is not configured') ||
    message.includes(' is not registered')
  );
}

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  index(ctx) {
    ctx.body = strapi
      .plugin('auth-manager')
      // the name of the service file & the method.
      .service('service')
      .getWelcomeMessage();
  },

  async sync(ctx) {
    const body = ctx.request.body || {};
    const providerUserId = body.providerUserId || body.ssoUserId;
    const userCollectionUid = firstString(
      body.userCollectionUid,
      body.userCollection,
      body.memberCollectionUid,
      body.memberCollection
    );
    const userDocumentId = firstString(
      body.userDocumentId,
      body.memberDocumentId,
      body.documentId
    );

    if (!providerUserId) {
      return ctx.badRequest('providerUserId is required');
    }
    if (!userDocumentId) {
      return ctx.badRequest('userDocumentId, memberDocumentId, or documentId is required');
    }

    let authentication;
    try {
      authentication = await strapi
        .plugin('auth-manager')
        .service('authentication')
        .ensureAuthenticationForUser({
          provider: body.provider || DEFAULT_AUTH_PROVIDER,
          providerUserId,
          userCollectionUid,
          userDocumentId,
          organizationIdentifier: body.organization || body.organizationIdentifier || null,
          organizationDocumentId: body.organizationDocumentId || null,
          metadata: body.metadata || null,
        });
    } catch (error: any) {
      if (isBadRequestError(error)) return ctx.badRequest(error.message);
      throw error;
    }

    ctx.body = {
      success: true,
      authentication,
    };
  },

  async resolve(ctx) {
    const providerUserId = ctx.query.providerUserId || ctx.query.ssoUserId;
    if (!providerUserId || typeof providerUserId !== 'string') {
      return ctx.badRequest('providerUserId is required');
    }

    let result;
    try {
      result = await strapi
        .plugin('auth-manager')
        .service('authentication')
        .findUserByAuthentication({
          provider:
            typeof ctx.query.provider === 'string' ? ctx.query.provider : DEFAULT_AUTH_PROVIDER,
          providerUserId,
          organizationIdentifier:
            typeof ctx.query.organization === 'string' ? ctx.query.organization : null,
          organizationDocumentId:
            typeof ctx.query.organizationDocumentId === 'string'
              ? ctx.query.organizationDocumentId
              : null,
          userCollectionUid: firstString(
            ctx.query.userCollectionUid,
            ctx.query.userCollection,
            ctx.query.memberCollectionUid,
            ctx.query.memberCollection
          ),
        });
    } catch (error: any) {
      if (isBadRequestError(error)) return ctx.badRequest(error.message);
      throw error;
    }

    if (!result) {
      return ctx.notFound('Authentication not found');
    }

    ctx.body = {
      success: true,
      ...result,
    };
  },
});

export default controller;
