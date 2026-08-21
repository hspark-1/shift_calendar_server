import type { Express, Request, Response, NextFunction } from "express";
import swaggerUi from "swagger-ui-express";
import { getBooleanEnvironmentVariable } from "./config/environment";
import group_openapi from "./openapi/groupOpenApi.json";
import device_openapi from "./openapi/deviceOpenApi.json";
import apple_auth_openapi from "./openapi/appleAuthOpenApi.json";
import google_auth_openapi from "./openapi/googleAuthOpenApi.json";
import account_deletion_openapi from "./openapi/accountDeletionOpenApi.json";
import kakao_auth_openapi from "./openapi/kakaoAuthOpenApi.json";
import profile_auth_openapi from "./openapi/profileAuthOpenApi.json";

const openapi = {
  ...group_openapi,
  info: {
    ...group_openapi.info,
    title: "ShiftMate API",
  },
  tags: [
    ...group_openapi.tags,
    ...apple_auth_openapi.tags,
    ...google_auth_openapi.tags,
    ...account_deletion_openapi.tags,
    ...kakao_auth_openapi.tags,
    ...profile_auth_openapi.tags,
  ],
  paths: {
    ...group_openapi.paths,
    ...device_openapi.paths,
    ...apple_auth_openapi.paths,
    ...google_auth_openapi.paths,
    ...account_deletion_openapi.paths,
    ...kakao_auth_openapi.paths,
    ...profile_auth_openapi.paths,
  },
  components: {
    ...group_openapi.components,
    schemas: {
      ...group_openapi.components.schemas,
      ...device_openapi.components.schemas,
      ...apple_auth_openapi.components.schemas,
      ...google_auth_openapi.components.schemas,
      ...account_deletion_openapi.components.schemas,
      ...kakao_auth_openapi.components.schemas,
      ...profile_auth_openapi.components.schemas,
    },
    responses: {
      ...group_openapi.components.responses,
      ...apple_auth_openapi.components.responses,
      ...google_auth_openapi.components.responses,
      ...account_deletion_openapi.components.responses,
      ...kakao_auth_openapi.components.responses,
      ...profile_auth_openapi.components.responses,
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
