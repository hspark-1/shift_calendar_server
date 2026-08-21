import crypto from "crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  getBooleanEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from "../config/environment";

interface ProfileImage {
  buffer: Buffer;
  content_type: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

export interface StoredProfileImage {
  key: string;
  public_url: string;
}

interface ObjectStorageClient {
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

let storage_client: ObjectStorageClient | null = null;

function getStorageClient(): ObjectStorageClient {
  if (storage_client) return storage_client;
  const endpoint = process.env.PROFILE_IMAGE_STORAGE_ENDPOINT?.trim();
  storage_client = new S3Client({
    region: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_REGION"),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: getBooleanEnvironmentVariable(
      "PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE",
      false,
    ),
  });
  return storage_client;
}

function getPublicBaseUrl(): string {
  return getRequiredEnvironmentVariable("PROFILE_IMAGE_PUBLIC_BASE_URL").replace(
    /\/$/,
    "",
  );
}

function getStoragePrefix(): string {
  return getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_PREFIX");
}

export function setProfileImageStorageClientForTest(
  client: ObjectStorageClient | null,
): void {
  storage_client = client;
}

export async function uploadProfileImage(
  user_id: string,
  image: ProfileImage,
): Promise<StoredProfileImage> {
  const key = `${getStoragePrefix()}/profiles/${user_id}/${crypto.randomUUID()}.${image.extension}`;
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET"),
      Key: key,
      Body: image.buffer,
      ContentType: image.content_type,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return {
    key,
    public_url: `${getPublicBaseUrl()}/${key}`,
  };
}

export async function deleteProfileImage(key: string): Promise<void> {
  await getStorageClient().send(
    new DeleteObjectCommand({
      Bucket: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET"),
      Key: key,
    }),
  );
}
