type EnvMap = Record<string, string | undefined>;

function getEnv(): EnvMap {
  const globalWithProcess = globalThis as { process?: { env?: EnvMap } };
  return globalWithProcess.process?.env ?? {};
}

export function getDefaultAccountId(): number | undefined {
  const value = getEnv().DEADLOCK_ACCOUNT_ID;
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
