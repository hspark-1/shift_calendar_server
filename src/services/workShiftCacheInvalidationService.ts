import { QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../config/database";
import { WorkShiftCacheOutbox } from "../models";
import { invalidateWorkShiftMonth, toMonthStart } from "./workShiftMonthCacheService";

export interface ChangedWorkShiftMonth {
  year_month: string;
  revision: string;
}

export async function recordWorkShiftMonthChanges(
  owner_user_id: string,
  year_months: Iterable<string>,
  transaction: Transaction,
): Promise<ChangedWorkShiftMonth[]> {
  const unique_months = [...new Set(year_months)].sort();
  const changed_months: ChangedWorkShiftMonth[] = [];

  for (const year_month of unique_months) {
    const rows = await sequelize.query<{ revision: string }>(
      `
      INSERT INTO work_shift_month_states (
        owner_user_id, year_month, revision, last_modified_at
      ) VALUES (
        :owner_user_id, CAST(:month_start AS date), 1, now()
      )
      ON CONFLICT (owner_user_id, year_month)
      DO UPDATE SET
        revision = work_shift_month_states.revision + 1,
        last_modified_at = now()
      RETURNING revision
      `,
      {
        replacements: {
          owner_user_id,
          month_start: toMonthStart(year_month),
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const revision = String(rows[0].revision);
    await WorkShiftCacheOutbox.create(
      {
        owner_user_id,
        year_month: toMonthStart(year_month),
        revision,
      },
      { transaction },
    );
    changed_months.push({ year_month, revision });
  }

  return changed_months;
}

export async function invalidateChangedWorkShiftMonths(
  owner_user_id: string,
  changed_months: ChangedWorkShiftMonth[],
): Promise<void> {
  await Promise.all(
    changed_months.map(({ year_month, revision }) =>
      invalidateWorkShiftMonth(owner_user_id, year_month, revision),
    ),
  );
}
