export interface UserConfig {
  uid: string;
  relationField?: string;
}

export interface AuthManagerConfig {
  defaultUserUid?: string;
  users?: UserConfig[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export default {
  default: {
    users: [],
  },
  validator(config: unknown = {}) {
    if (!isPlainObject(config)) {
      throw new Error('auth-manager config must be an object');
    }

    const authConfig = config as AuthManagerConfig;

    if (authConfig.defaultUserUid !== undefined && typeof authConfig.defaultUserUid !== 'string') {
      throw new Error('auth-manager config.defaultUserUid must be a string');
    }

    if (authConfig.users !== undefined && !Array.isArray(authConfig.users)) {
      throw new Error('auth-manager config.users must be an array');
    }

    const users = authConfig.users || [];
    for (const user of users) {
      if (!isPlainObject(user)) {
        throw new Error('auth-manager config.users entries must be objects');
      }
      const userConfig = user as Partial<UserConfig>;
      if (!userConfig.uid || typeof userConfig.uid !== 'string') {
        throw new Error('auth-manager config.users[].uid must be a non-empty string');
      }
      if (userConfig.relationField !== undefined && typeof userConfig.relationField !== 'string') {
        throw new Error('auth-manager config.users[].relationField must be a string');
      }
    }

    if (
      authConfig.defaultUserUid &&
      users.length > 0 &&
      !users.some((user) => user.uid === authConfig.defaultUserUid)
    ) {
      throw new Error('auth-manager config.defaultUserUid must match an entry in config.users');
    }
  },
};
