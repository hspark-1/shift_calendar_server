const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWorkShiftEtag,
  getMonthEnd,
  getMonthsInRange,
  getWorkShiftCacheKeys,
  toMonthStart,
  toYearMonth,
} = require("../dist/services/workShiftMonthCacheService.js");

test("날짜 범위를 월 목록으로 변환한다", () => {
  assert.deepEqual(getMonthsInRange("2026-11-30", "2027-02-01"), [
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  assert.deepEqual(getMonthsInRange("2026-07-01", "2026-07-31"), [
    "2026-07",
  ]);
});

test("월 시작일과 윤년 말일을 계산한다", () => {
  assert.equal(toYearMonth("2028-02-29"), "2028-02");
  assert.equal(toMonthStart("2028-02"), "2028-02-01");
  assert.equal(getMonthEnd("2028-02"), "2028-02-29");
  assert.equal(getMonthEnd("2027-02"), "2027-02-28");
});

test("사용자와 월이 분리된 snapshot/revision/lock 키를 만든다", () => {
  process.env.CACHE_KEY_PREFIX = "shiftmate:test";
  assert.deepEqual(getWorkShiftCacheKeys("user-1", "2026-07"), {
    snapshot_key: "shiftmate:test:work-shifts:v1:user-1:202607",
    revision_key: "shiftmate:test:work-shifts:v1:user-1:202607:revision",
    lock_key: "shiftmate:test:work-shifts:v1:user-1:202607:lock",
    deletion_tombstone_key: "shiftmate:test:account-deleted:v1:user-1",
  });
});

test("ETag는 같은 범위/revision에서 안정적이고 revision 변경을 반영한다", () => {
  const first = createWorkShiftEtag("user-1", "2026-07-01", "2026-07-31", [
    { year_month: "2026-07", revision: "4" },
  ]);
  const same = createWorkShiftEtag("user-1", "2026-07-01", "2026-07-31", [
    { year_month: "2026-07", revision: "4" },
  ]);
  const changed = createWorkShiftEtag(
    "user-1",
    "2026-07-01",
    "2026-07-31",
    [{ year_month: "2026-07", revision: "5" }],
  );
  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.match(first, /^"work-shifts-[A-Za-z0-9_-]+"$/);
});
