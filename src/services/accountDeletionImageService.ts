import crypto from "crypto";
import {
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getBooleanEnvironmentVariable, getRequiredEnvironmentVariable } from "../config/environment";
import { assertAccountUuid } from "../utils/accountDataLock";

export interface AccountImageScope {
  bucket: string;
  prefix: string;
  storage_fingerprint: string;
}

export function getAccountImageScope(user_id: string): AccountImageScope {
  assertAccountUuid(user_id);
  const prefix = getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_PREFIX");
  if (!["local", "test", "stage", "center"].includes(prefix)) {
    throw new Error("ACCOUNT_IMAGE_PREFIX_INVALID");
  }
  const bucket = getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET");
  const storage_fingerprint = crypto.createHash("sha256").update(JSON.stringify([
    bucket,
    process.env.PROFILE_IMAGE_STORAGE_ENDPOINT?.trim() || "AWS",
    getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_REGION"),
    getBooleanEnvironmentVariable("PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE", false),
  ])).digest("hex");
  return { bucket, prefix: `${prefix}/profiles/${user_id.toLowerCase()}/`, storage_fingerprint };
}

export async function purgeAccountImages(user_id: string, scope: AccountImageScope): Promise<void> {
  const expected = getAccountImageScope(user_id);
  if (scope.bucket !== expected.bucket || scope.prefix !== expected.prefix ||
      scope.storage_fingerprint !== expected.storage_fingerprint) {
    throw new Error("ACCOUNT_IMAGE_STORAGE_CHANGED");
  }
  const endpoint = process.env.PROFILE_IMAGE_STORAGE_ENDPOINT?.trim();
  const client = new S3Client({
    region: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_REGION"),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: getBooleanEnvironmentVariable("PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE", false),
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
  });
  const input = { Bucket: scope.bucket, Prefix: scope.prefix, MaxKeys: 1000 };
  try {
    const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: scope.bucket }));
    const has_versions = versioning.Status === "Enabled" || versioning.Status === "Suspended";
    // Delete first pages repeatedly: restart safely after partial failure without a cursor.
    // A bounded pass yields to worker retry for unusually large accounts.
    for (let page = 0; page < 20; page += 1) {
      let objects: Array<{ Key?: string; VersionId?: string }>;
      if (has_versions) {
        const result = await client.send(new ListObjectVersionsCommand(input));
        objects = [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]
          .map(({ Key, VersionId }) => ({ Key, VersionId }));
        if (objects.length === 0 && result.IsTruncated) throw new Error("ACCOUNT_IMAGE_LIST_INVALID");
      } else {
        const result = await client.send(new ListObjectsV2Command(input));
        objects = (result.Contents ?? []).map(({ Key }) => ({ Key }));
        if (objects.length === 0 && result.IsTruncated) throw new Error("ACCOUNT_IMAGE_LIST_INVALID");
      }
      if (objects.length === 0) return;
      if (objects.some(({ Key, VersionId }) => !Key?.startsWith(scope.prefix) ||
          (has_versions && !VersionId))) throw new Error("ACCOUNT_IMAGE_KEY_OUT_OF_SCOPE");
      const result = await client.send(new DeleteObjectsCommand({
        Bucket: scope.bucket, Delete: { Objects: objects.map(({ Key, VersionId }) => ({ Key: Key!, VersionId })), Quiet: true },
      }));
      if (result.Errors?.some((error) => !["NoSuchKey", "NoSuchVersion"].includes(error.Code ?? ""))) {
        throw new Error("ACCOUNT_IMAGE_DELETE_FAILED");
      }
    }
    throw new Error("ACCOUNT_IMAGE_MORE_PAGES");
  } finally {
    client.destroy();
  }
}
