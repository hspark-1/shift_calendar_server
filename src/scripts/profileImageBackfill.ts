import { QueryTypes } from "sequelize";
import { sequelize } from "../config/database";
import { validateProfileImageApiEnvironment, validateProfileImageStorageEnvironment } from "../config/environment";
import { legacyProfileImageKey, profileImageApiUrl, profileImageJsonReplacer } from "../utils/profileImageLocation";

export async function backfillProfileImages(apply: boolean): Promise<Record<string, number>> {
  validateProfileImageStorageEnvironment();
  validateProfileImageApiEnvironment();
  let cursor = "00000000-0000-0000-0000-000000000000";
  const counts = { eligible: 0, converted: 0, external_unchanged: 0, invalid_managed: 0 };
  while (true) {
    const rows = await sequelize.query<{ user_id: string; profile_image_url: string }>(
      `SELECT user_id, profile_image_url FROM users
       WHERE profile_image_key IS NULL AND profile_image_url IS NOT NULL AND user_id > :cursor
       ORDER BY user_id LIMIT 100`, { replacements: { cursor }, type: QueryTypes.SELECT });
    if (rows.length === 0) break;
    for (const row of rows) {
      const key = legacyProfileImageKey(row.profile_image_url, row.user_id);
      if (!key) {
        const normalized_url = profileImageJsonReplacer("profile_image_url", row.profile_image_url);
        if (normalized_url !== row.profile_image_url) counts.invalid_managed += 1;
        else counts.external_unchanged += 1;
        continue;
      }
      counts.eligible += 1;
      if (apply) {
        const updated = await sequelize.query<{ user_id: string }>(
          `UPDATE users SET profile_image_key = :key, profile_image_url = :api_url
           WHERE user_id = :user_id AND profile_image_key IS NULL AND profile_image_url = :old_url
           RETURNING user_id`, {
            replacements: { key, api_url: profileImageApiUrl(row.user_id), user_id: row.user_id, old_url: row.profile_image_url },
            type: QueryTypes.SELECT,
          });
        counts.converted += updated.length;
      }
    }
    cursor = rows[rows.length - 1].user_id;
  }
  return counts;
}

if (require.main === module) {
  const mode = process.argv[2];
  (async () => {
    if (!["--dry-run", "--apply"].includes(mode)) throw new Error("PROFILE_IMAGE_BACKFILL_USAGE");
    const counts = await backfillProfileImages(mode === "--apply");
    console.log(JSON.stringify({ mode, ...counts }));
    if (counts.invalid_managed > 0) process.exitCode = 2;
  })().catch(() => {
    console.error(JSON.stringify({ code: "PROFILE_IMAGE_BACKFILL_FAILED" }));
    process.exitCode = 1;
  }).finally(() => sequelize.close());
}
