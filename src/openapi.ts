import type { Express, Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { getBooleanEnvironmentVariable } from "./config/environment";
import group_openapi from "./openapi/groupOpenApi.json";

function removeDocsContentSecurityPolicy(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.removeHeader("Content-Security-Policy");
  next();
}

export function registerApiDocs(app: Express): void {
  if (!getBooleanEnvironmentVariable("API_DOCS_ENABLED", false)) {
    return;
  }

  app.get("/api-docs/openapi.json", (_req, res) => {
    res.json(group_openapi);
  });
  app.use(
    "/api-docs",
    removeDocsContentSecurityPolicy,
    swaggerUi.serve,
    swaggerUi.setup(group_openapi, {
      customSiteTitle: "ShiftMate Group API",
      swaggerOptions: { persistAuthorization: true },
    }),
  );
}
