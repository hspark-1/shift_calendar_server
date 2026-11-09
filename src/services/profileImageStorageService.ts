import crypto from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  getBooleanEnvironmentVariable,
  getRequiredEnvironmentVariable,
} from "../config/environment";
import { isOwnedProfileImageKey, profileImageApiUrl } from "../utils/profileImageLocation";

export interface ProfileImage {
  buffer: Buffer;
  content_type: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

export interface StoredProfileImage {
  key: string;
  public_url: string;
}

interface ObjectStorageClient {
  send(command: PutObjectCommand | DeleteObjectCommand | GetObjectCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
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
  prepared_key?: string,
): Promise<StoredProfileImage> {
  const key = prepared_key ?? createProfileImageKey(user_id, image.extension);
  if (!isOwnedProfileImageKey(key, user_id)) throw new Error("INVALID_PROFILE_IMAGE_KEY");
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET"),
      Key: key,
      Body: image.buffer,
      ContentType: image.content_type,
      CacheControl: "private, no-store",
    }),
  );
  return {
    key,
    public_url: profileImageApiUrl(user_id),
  };
}

export function createProfileImageKey(user_id: string, extension: ProfileImage["extension"]): string {
  const key = `${getStoragePrefix()}/profiles/${user_id}/${crypto.randomUUID()}.${extension}`;
  if (!isOwnedProfileImageKey(key, user_id)) throw new Error("INVALID_PROFILE_IMAGE_KEY");
  return key;
}

export async function readProfileImage(
  user_id: string,
  key: string,
  signal: AbortSignal,
): Promise<GetObjectCommandOutput> {
  if (!isOwnedProfileImageKey(key, user_id)) throw new Error("INVALID_PROFILE_IMAGE_KEY");
  return await getStorageClient().send(new GetObjectCommand({
    Bucket: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET"),
    Key: key,
  }), { abortSignal: signal }) as GetObjectCommandOutput;
}

export async function deleteProfileImage(key: string): Promise<void> {
  await getStorageClient().send(
    new DeleteObjectCommand({
      Bucket: getRequiredEnvironmentVariable("PROFILE_IMAGE_STORAGE_BUCKET"),
      Key: key,
    }),
  );
}
