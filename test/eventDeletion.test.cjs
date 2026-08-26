const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
const { Event } = require("../dist/models/index.js");
const { deleteEvent } = require("../dist/services/calendarService.js");

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

test("개인 일정 삭제는 소유자와 활성 상태를 포함한 단일 update를 사용한다", async () => {
  const original_update = Event.update;
  const calls = [];
  Event.update = async (values, options) => {
    calls.push({ values, options });
    return [1];
  };

  try {
    await deleteEvent(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    );
  } finally {
    Event.update = original_update;
  }

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].options.where.event_id,
    "00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    calls[0].options.where.owner_user_id,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(calls[0].options.where.deleted_at, null);
  assert.equal(
    calls[0].values.deleted_by_user_id,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.ok(calls[0].values.deleted_at instanceof Date);
  assert.ok(calls[0].values.updated_at instanceof Date);
});

test("개인 일정 삭제 영향 row가 없으면 EVENT_NOT_FOUND를 반환한다", async () => {
  const original_update = Event.update;
  Event.update = async () => [0];

  try {
    await assert.rejects(
      deleteEvent(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
      /EVENT_NOT_FOUND/,
    );
  } finally {
    Event.update = original_update;
  }
});

test("일정 삭제 route·controller·OpenAPI 오류 계약이 일치한다", () => {
  const routes = readRepositoryFile("src/routes/calendarRoutes.ts");
  const controller = readRepositoryFile("src/controllers/calendarController.ts");
  const openapi = JSON.parse(
    readRepositoryFile("src/openapi/calendarOpenApi.json"),
  );
  const openapi_root = readRepositoryFile("src/openapi.ts");

  assert.match(
    routes,
    /"\/events\/:event_id"[\s\S]*param\("event_id"\)[\s\S]*[.]isUUID\(\)/,
  );
  assert.match(controller, /code: "INVALID_EVENT_ID"/);
  assert.match(controller, /code: "EVENT_NOT_FOUND"/);
  assert.match(controller, /message: "일정이 삭제되었습니다[.]"/);
  assert.ok(openapi.paths["/events/{event_id}"].delete);
  assert.equal(
    openapi.paths["/events/{event_id}"].delete.parameters[0].schema.format,
    "uuid",
  );
  assert.ok(openapi.paths["/events/{event_id}"].delete.responses["200"]);
  assert.ok(openapi.paths["/events/{event_id}"].delete.responses["400"]);
  assert.ok(openapi.paths["/events/{event_id}"].delete.responses["401"]);
  assert.ok(openapi.paths["/events/{event_id}"].delete.responses["404"]);
  assert.ok(openapi.paths["/events/{event_id}"].delete.responses["500"]);
  assert.match(openapi_root, /calendarOpenApi[.]json/);
  assert.match(openapi_root, /[.][.][.]calendar_openapi[.]paths/);
});
