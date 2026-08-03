import type { Express, Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { getBooleanEnvironmentVariable } from "./config/environment";
import group_openapi from "./openapi/groupOpenApi.json";
import device_openapi from "./openapi/deviceOpenApi.json";

const openapi = {
  ...group_openapi,
  info: {
    ...group_openapi.info,
    title: "ShiftMate API",
  },
  paths: {
    ...group_openapi.paths,
    ...device_openapi.paths,
  },
  components: {
    ...group_openapi.components,
    schemas: {
      ...group_openapi.components.schemas,
      ...device_openapi.components.schemas,
    },
  },
};

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
    res.json(openapi);
  });
  app.use(
    "/api-docs",
    removeDocsContentSecurityPolicy,
    swaggerUi.serve,
    swaggerUi.setup(openapi, {
      customSiteTitle: "ShiftMate API",
      swaggerOptions: { persistAuthorization: true },
    }),
  );
}
