const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;

  module._compile(output, filename);
};

const authenticationFactory = require('../server/src/services/authentication.ts').default;

const authUid = 'plugin::auth-manager.authentication';
const contactUid = 'api::contact.contact';

function matchesFilter(row, filters = {}) {
  for (const [key, expected] of Object.entries(filters)) {
    if (key === '$or') {
      if (!Array.isArray(expected) || !expected.some((branch) => matchesFilter(row, branch))) {
        return false;
      }
      continue;
    }

    if (
      expected &&
      typeof expected === 'object' &&
      !Array.isArray(expected) &&
      Object.prototype.hasOwnProperty.call(expected, '$eq')
    ) {
      if (row[key] !== expected.$eq) return false;
      continue;
    }

    if (row[key] !== expected) return false;
  }

  return true;
}

function createService({ rows = [], users = [{ uid: contactUid, relationField: 'contact' }] } = {}) {
  const authRows = rows.map((row) => ({ ...row }));
  const calls = {
    create: [],
    findMany: [],
    update: [],
    warn: [],
  };

  const strapi = {
    contentTypes: {
      [authUid]: {
        attributes: {
          contact: {
            type: 'relation',
            relation: 'manyToOne',
            target: contactUid,
          },
        },
      },
      [contactUid]: {
        attributes: {},
      },
    },
    config: {
      get(key) {
        if (key === 'plugin::auth-manager') {
          return {
            defaultUserUid: contactUid,
            users,
          };
        }
        return undefined;
      },
    },
    log: {
      debug() {},
      info() {},
      warn(message) {
        calls.warn.push(message);
      },
    },
    documents(uid) {
      assert.equal(uid, authUid);
      return {
        findMany: async (query = {}) => {
          calls.findMany.push(query);
          return authRows.filter((row) => matchesFilter(row, query.filters));
        },
        create: async ({ data }) => {
          calls.create.push(data);
          const row = {
            id: authRows.length + 1,
            documentId: `auth_${authRows.length + 1}`,
            ...data,
          };
          authRows.push(row);
          return row;
        },
        update: async ({ documentId, data }) => {
          calls.update.push({ documentId, data });
          const index = authRows.findIndex((row) => row.documentId === documentId);
          const current = index >= 0 ? authRows[index] : { documentId };
          const updated = { ...current, ...data };
          if (index >= 0) authRows[index] = updated;
          return updated;
        },
      };
    },
  };

  return {
    calls,
    rows: authRows,
    service: authenticationFactory({ strapi }),
  };
}

test('ensureAuthenticationForUser dual-writes canonical and legacy user references', async () => {
  const { calls, rows, service } = createService();

  const authentication = await service.ensureAuthenticationForUser({
    providerUserId: 'st_user_1',
    userCollectionUid: contactUid,
    userDocumentId: 'contact_doc_1',
    organizationIdentifier: 'brooks-brothers',
  });

  assert.equal(calls.create.length, 1);
  assert.equal(rows[0].userCollection, contactUid);
  assert.equal(rows[0].userDocumentId, 'contact_doc_1');
  assert.equal(rows[0].memberCollection, contactUid);
  assert.equal(rows[0].memberDocumentId, 'contact_doc_1');
  assert.equal(authentication.userDocumentId, 'contact_doc_1');
  assert.equal(authentication.memberDocumentId, 'contact_doc_1');
  assert.equal(calls.update.length, 1);
  assert.deepEqual(calls.update[0].data.contact, {
    connect: [{ documentId: 'contact_doc_1' }],
  });
});

test('findUserByAuthentication resolves legacy member fields through user aliases', async () => {
  const { service } = createService({
    rows: [
      {
        documentId: 'auth_legacy',
        provider: 'supertokens',
        providerUserId: 'st_legacy',
        memberCollection: contactUid,
        memberDocumentId: 'legacy_contact_doc',
        metadata: {
          organization: {
            identifier: 'brooks-brothers',
          },
        },
      },
    ],
  });

  const result = await service.findUserByAuthentication({
    providerUserId: 'st_legacy',
    userCollectionUid: contactUid,
    organizationIdentifier: 'brooks-brothers',
  });

  assert.equal(result.userCollectionUid, contactUid);
  assert.equal(result.userDocumentId, 'legacy_contact_doc');
  assert.equal(result.memberCollectionUid, contactUid);
  assert.equal(result.memberDocumentId, 'legacy_contact_doc');
});

test('legacy member wrapper writes the new user fields', async () => {
  const { rows, service } = createService();

  await service.ensureAuthenticationForMember({
    providerUserId: 'st_member_wrapper',
    memberCollectionUid: contactUid,
    memberDocumentId: 'wrapped_contact_doc',
  });

  assert.equal(rows[0].userCollection, contactUid);
  assert.equal(rows[0].userDocumentId, 'wrapped_contact_doc');
  assert.equal(rows[0].memberCollection, contactUid);
  assert.equal(rows[0].memberDocumentId, 'wrapped_contact_doc');
});

test('direct relation sync only runs when relationField is configured', async () => {
  const { calls, service } = createService({
    users: [{ uid: contactUid }],
  });

  await service.ensureAuthenticationForUser({
    providerUserId: 'st_no_relation',
    userCollectionUid: contactUid,
    userDocumentId: 'contact_without_relation',
  });

  assert.equal(calls.update.length, 0);
});
