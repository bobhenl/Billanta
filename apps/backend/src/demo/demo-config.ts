/** Demo playground settings (docs/demo-playground-plan.md); read per call so tests can set them. */
export function demoConfig() {
  const num = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    enabled: process.env.DEMO_ENABLED === "true",
    provisionSecret: process.env.DEMO_PROVISION_SECRET ?? "",
    ipSalt: process.env.DEMO_IP_SALT ?? "",
    ttlHours: num("DEMO_TTL_HOURS", 24),
    // Trying every company type costs a demo each, and an office shares one IP; maxActive caps the total.
    perIpDaily: num("DEMO_PER_IP_DAILY", 10),
    maxActive: num("DEMO_MAX_ACTIVE", 500),
    aiPerSession: num("DEMO_AI_PER_SESSION", 5),
    aiPerIpDaily: num("DEMO_AI_PER_IP_DAILY", 15),
  };
}
