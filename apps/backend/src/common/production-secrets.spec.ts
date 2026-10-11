import { describe, expect, it } from "vitest";
import { assertProductionSecrets, productionSecretProblems } from "./production-secrets";

const good = {
  NODE_ENV: "production",
  JWT_SECRET: "q7Vb3kP0xLr9sT2mWn8yZc4dHf6jGa1eUo5iRt7Ky",
  DATABASE_URL: "postgres://faktur_app:Zx9pLq2Wv7Nm4Rt8Ks@postgres:5432/faktur",
  BACKUP_CONFIG_ENCRYPTION_KEY: "3f9a1c7e5b2d8f4a6c0e9b7d5f3a1c8e2b6d4f0a9c7e5b3d1f8a6c4e2b0d9f7a",
};

describe("productionSecretProblems", () => {
  it("accepts a real-looking configuration", () => {
    expect(productionSecretProblems(good)).toEqual([]);
  });

  it("rejects the .env.example placeholders", () => {
    const problems = productionSecretProblems({
      ...good,
      JWT_SECRET: "change-me",
      DATABASE_URL: "postgres://faktur_app:change-me@postgres:5432/faktur",
      BACKUP_CONFIG_ENCRYPTION_KEY: "0".repeat(64),
    });
    expect(problems).toHaveLength(3);
  });

  it("rejects a short JWT secret", () => {
    expect(productionSecretProblems({ ...good, JWT_SECRET: "short-but-not-placeholder" })[0]).toMatch(/JWT_SECRET/);
  });

  it("rejects connecting as the superuser", () => {
    const problems = productionSecretProblems({
      ...good,
      DATABASE_URL: "postgres://faktur:Zx9pLq2Wv7Nm4Rt8Ks@postgres:5432/faktur",
    });
    expect(problems.join()).toMatch(/faktur_app/);
  });
});

describe("assertProductionSecrets", () => {
  it("does nothing outside production", () => {
    expect(() => assertProductionSecrets({ NODE_ENV: "development", JWT_SECRET: "change-me" })).not.toThrow();
  });

  it("throws in production with placeholders", () => {
    expect(() => assertProductionSecrets({ ...good, JWT_SECRET: "change-me" })).toThrow(/JWT_SECRET/);
  });
});
