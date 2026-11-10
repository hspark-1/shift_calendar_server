const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Event, User } = require("../dist/models/index.js");
const calendar_service = require("../dist/services/calendarService.js");
const routes = require("../dist/routes/calendarRoutes.js").default;
const { registerApiDocs } = require("../dist/openapi.js");

const owner_id = "00000000-0000-4000-8000-000000000001";
const other_id = "00000000-0000-4000-8000-000000000002";
const valid_input = {
  title: "  개인 일정  ", all_day: false,
  start_at: "2026-11-11T00:00:00.000Z", end_at: "2026-11-11T01:00:00.000Z",
  visibility_level: 0, memo: "  메모  ", place: "  ",
};
const invalid_privacies = [null, "true", "false", "", 0, 1, [], [true], {}, { value: true }];

async function withServer(app, run) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function eventResult(values) {
  return { ...values, event_id: other_id, created_at: new Date(), updated_at: new Date() };
}

test("서비스는 생략=false와 boolean을 보존하고 소유자 위조·텍스트 정규화를 처리한다", async () => {
  const original_create = Event.create;
  const stored = [];
  Event.create = async values => { stored.push(values); return eventResult(values); };
  try {
    for (const privacy of [undefined, false, true]) {
      const input = { ...valid_input, owner_user_id: other_id, created_by_user_id: other_id };
      if (privacy !== undefined) input.is_private = privacy;
      const result = await calendar_service.createEvent(owner_id, input);
      assert.equal(result.is_private, privacy ?? false);
      assert.equal(result.title, "개인 일정");
      assert.equal(result.memo, "메모");
      assert.equal(result.place, null);
      assert.equal(result.visibility_level, 0);
    }
    assert.ok(stored.every(row => row.owner_user_id === owner_id && row.created_by_user_id === owner_id));
    assert.equal(Event.getAttributes().is_private.allowNull, false);
    assert.equal(Event.getAttributes().is_private.defaultValue, false);
  } finally { Event.create = original_create; }
});

test("서비스 직접 호출은 잘못된 private 타입과 기존 시간·레벨 계약을 DB 쓰기 전에 거절한다", async () => {
  const original_create = Event.create;
  Event.create = async () => assert.fail("검증 실패 시 DB 쓰기 금지");
  try {
    for (const is_private of invalid_privacies) {
      await assert.rejects(calendar_service.createEvent(owner_id, { ...valid_input, is_private }), /INVALID_EVENT_PRIVACY/);
    }
    for (const visibility_level of [-1, 6, 1.5, undefined]) {
      await assert.rejects(calendar_service.createEvent(owner_id, { ...valid_input, is_private: true, visibility_level }), /INVALID_VISIBILITY_LEVEL/);
    }
    for (const fields of [{ end_at: valid_input.start_at }, { start_at: "2026-11-11T09:00:00+09:00" }, { start_at: "2026-02-30T00:00:00Z" }]) {
      await assert.rejects(calendar_service.createEvent(owner_id, { ...valid_input, is_private: true, ...fields }), /INVALID_EVENT_TIME/);
    }
  } finally { Event.create = original_create; }
});

test("실제 인증 route는 잘못된 JSON 타입을 400으로 거절하고 생략·true·false를 반환한다", async () => {
  process.env.JWT_SECRET = "event-privacy-unit-secret";
  const original_find = User.findByPk;
  const original_create = Event.create;
  const stored = [];
  User.findByPk = async () => ({ user_id: owner_id, account_status: "ACTIVE" });
  Event.create = async values => { stored.push(values); return eventResult(values); };
  const app = express(); app.use(express.json()); app.use("/api/v1", routes);
  const authorization = `Bearer ${jwt.sign({ user_id: owner_id }, process.env.JWT_SECRET)}`;
  try {
    await withServer(app, async base_url => {
      async function post(body, auth = authorization) {
        const response = await fetch(`${base_url}/api/v1/events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }
      for (const is_private of invalid_privacies) {
        const result = await post({ ...valid_input, is_private });
        assert.equal(result.status, 400);
        assert.deepEqual(result.body, { success: false, error: { code: "INVALID_EVENT_PRIVACY", message: "공개 범위가 올바르지 않습니다." } });
      }
      assert.equal(stored.length, 0);
      for (const is_private of [undefined, true, false]) {
        const result = await post({ ...valid_input, is_private, owner_user_id: other_id });
        assert.equal(result.status, 201);
        assert.equal(result.body.data.is_private, is_private ?? false);
        assert.equal(result.body.message, "일정이 생성되었습니다.");
      }
      assert.ok(stored.every(row => row.owner_user_id === owner_id && row.created_by_user_id === owner_id));
      for (const visibility_level of [undefined, -1, 6]) {
        const result = await post({ ...valid_input, is_private: true, visibility_level });
        assert.equal(result.status, 400); assert.equal(result.body.error.code, "INVALID_VISIBILITY_LEVEL");
      }
      assert.equal((await post(valid_input, "")).status, 401);
      const original_service_create = calendar_service.createEvent;
      calendar_service.createEvent = async () => { throw new Error("INVALID_EVENT_PRIVACY"); };
      try {
        const result = await post(valid_input);
        assert.equal(result.status, 400); assert.equal(result.body.error.code, "INVALID_EVENT_PRIVACY");
      } finally { calendar_service.createEvent = original_service_create; }
    });
  } finally { User.findByPk = original_find; Event.create = original_create; }
});

test("병합 OpenAPI HTTP는 개인/친구/그룹 공개 계약과 유효한 내부 참조를 제공한다", async () => {
  const previous_docs = process.env.API_DOCS_ENABLED;
  process.env.API_DOCS_ENABLED = "true";
  const app = express(); registerApiDocs(app);
  try {
    await withServer(app, async base_url => {
      const response = await fetch(`${base_url}/api-docs/openapi.json`);
      assert.equal(response.status, 200);
      const spec = await response.json();
      const input = spec.components.schemas.CreateEventInput;
      assert.equal(input.properties.is_private.default, false);
      assert.equal(input.properties.is_private.type, "boolean");
      assert.ok(!input.required.includes("is_private"));
      assert.ok(input.required.includes("visibility_level"));
      assert.ok(spec.components.schemas.EventApiModel.required.includes("is_private"));
      assert.deepEqual(spec.components.schemas.FriendCalendarEvent.properties.is_private.enum, [false]);
      assert.ok(spec.components.schemas.GroupCalendarRange.properties.events.items.required.includes("is_private"));
      for (const endpoint of ["/events", "/calendar/day", "/calendar/range", "/friends/{friend_user_id}/calendar/range", "/groups/{group_id}/calendar/range"]) assert.ok(spec.paths[endpoint].get);
      function checkRefs(value) {
        if (!value || typeof value !== "object") return;
        if (value.$ref?.startsWith("#/")) {
          let target = spec;
          for (const part of value.$ref.slice(2).split("/")) target = target?.[part.replaceAll("~1", "/").replaceAll("~0", "~")];
          assert.ok(target, value.$ref);
        }
        for (const child of Object.values(value)) checkRefs(child);
      }
      checkRefs(spec);
      const docs = await fetch(`${base_url}/api-docs/`);
      assert.equal(docs.status, 200); assert.match(await docs.text(), /swagger-ui/);
    });
  } finally { if (previous_docs === undefined) delete process.env.API_DOCS_ENABLED; else process.env.API_DOCS_ENABLED = previous_docs; }
});
