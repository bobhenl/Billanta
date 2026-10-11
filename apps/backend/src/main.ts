import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { AppModule } from "./app.module";

async function bootstrap() {
  // `rawBody: true` makes `req.rawBody` available — required by the billing
  // webhook handlers (blueprint §5) to verify Stripe/GoPay signatures
  // against the exact bytes received, not the parsed-then-reserialized JSON
  // body (signature verification fails against a reserialized body).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Feature controllers declare paths already prefixed with `v1/...`
  // (e.g. `v1/invoices`), so the effective route is `/api/v1/invoices`,
  // matching the exact paths `apps/ai-service` already calls
  // (`/api/v1/invoices/drafts`, `/api/v1/channel-links/verify`).
  app.setGlobalPrefix("api");

  // Zod (not class-validator) is this project's request-validation choice
  // (see package.json deps) — `nestjs-zod`'s createZodDto keeps a single
  // Zod schema as the source of truth for both runtime validation and the
  // Swagger schema, rather than hand-duplicating class-validator decorators
  // alongside a separate Zod schema.
  app.useGlobalPipes(new ZodValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Faktur Backend API")
    .setDescription(
      "CZ/SK invoicing SaaS - REST API. See docs/CZ-SK-Invoicing-SaaS-Blueprint.md " +
        "§2 (tech stack), §4 (multi-tenancy/RLS), §6 (AI microservice contract), " +
        "§9 (legal/liability audit trail).",
    )
    .setVersion("0.0.1")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  // Default 3000 matches what apps/ai-service's BACKEND_API_URL assumes
  // (see apps/ai-service/.env.example / app/config.py) — override via PORT.
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
