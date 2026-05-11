import type { Core } from '@strapi/strapi';
import { DEFAULT_AUTH_PROVIDER } from '../constants';

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
    const memberCollectionUid =
      body.memberCollectionUid || body.memberCollection || 'api::contact.contact';
    const memberDocumentId = body.memberDocumentId || body.documentId;

    if (!providerUserId) {
      return ctx.badRequest('providerUserId is required');
    }
    if (!memberDocumentId) {
      return ctx.badRequest('memberDocumentId or documentId is required');
    }

    const authentication = await strapi
      .plugin('auth-manager')
      .service('authentication')
      .ensureAuthenticationForMember({
        provider: body.provider || DEFAULT_AUTH_PROVIDER,
        providerUserId,
        memberCollectionUid,
        memberDocumentId,
        organizationIdentifier: body.organization || body.organizationIdentifier || null,
        organizationDocumentId: body.organizationDocumentId || null,
        metadata: body.metadata || null,
      });

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

    const result = await strapi
      .plugin('auth-manager')
      .service('authentication')
      .findMemberByAuthentication({
        provider:
          typeof ctx.query.provider === 'string' ? ctx.query.provider : DEFAULT_AUTH_PROVIDER,
        providerUserId,
        organizationIdentifier:
          typeof ctx.query.organization === 'string' ? ctx.query.organization : null,
        organizationDocumentId:
          typeof ctx.query.organizationDocumentId === 'string'
            ? ctx.query.organizationDocumentId
            : null,
        memberCollectionUid:
          typeof ctx.query.memberCollectionUid === 'string' ? ctx.query.memberCollectionUid : null,
      });

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
