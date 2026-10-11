/**
 * Refuses to start in production with secrets left at their .env.example
 * placeholders or too short to be safe. Called from main.ts before Nest
 * boots, only when NODE_ENV=production (the Docker image sets it), so local
 * development keeps working with `change-me`.
 *
 * Only what the backend itself relies on is checked here: the JWT signing
 * secret, the DB password in DATABASE_URL, and the key that encrypts stored
 * third-party credentials (bank, card, AI, backup). Optional integrations
 * left empty are not an error; they simply stay off.
 */
const PLACEHOLDER = /^(change[-_]?me|changeme|secret|password|test|example|xxx+|todo)$/i;

const weak = (value: string | undefined, minLength: number) =>
  !value || value.trim().length < minLength || PLACEHOLDER.test(value.trim());

export function productionSecretProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];

  if (weak(env.JWT_SECRET, 32)) {
    problems.push("JWT_SECRET must be at least 32 random characters (openssl rand -base64 48)");
  }

  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      const password = decodeURIComponent(url.password);
      if (weak(password, 16)) problems.push("DATABASE_URL has a placeholder or short password");
      if (url.username !== "faktur_app") {
        problems.push("DATABASE_URL must connect as faktur_app (a superuser bypasses row-level security)");
      }
    } catch {
      problems.push("DATABASE_URL is not a valid URL");
    }
  } else {
    problems.push("DATABASE_URL is not set");
  }

  const key = env.AI_KEY_ENCRYPTION_KEY ?? env.BACKUP_CONFIG_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key.trim()) || /^(.)\1+$/.test(key.trim())) {
    problems.push("BACKUP_CONFIG_ENCRYPTION_KEY must be 64 random hex characters (openssl rand -hex 32)");
  }

  return problems;
}

export function assertProductionSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = productionSecretProblems(env);
  if (problems.length) {
    throw new Error(`Refusing to start with unsafe configuration:\n- ${problems.join("\n- ")}`);
  }
}
