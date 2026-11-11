const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const isolated_database = process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" && process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";
if (process.env.RUN_EVENT_PRIVACY_INTEGRATION !== "true") {
  test("개인 일정 PostgreSQL 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (process.env.EVENT_PRIVACY_INTEGRATION_ALLOW_SCHEMA_RESET !== "true" || !isolated_database) {
  test("개인 일정 통합 테스트는 고정 격리 DB에서만 schema reset을 허용한다", () => {
    assert.fail("EVENT_PRIVACY_INTEGRATION_ALLOW_SCHEMA_RESET=true 및 고정 127.0.0.1:55432 격리 DB 연결 필요");
  });
} else {
  process.env.TZ = "UTC";
  process.env.JWT_SECRET = "event-privacy-integration-secret";
  process.env.WORK_SHIFT_CACHE_ENABLED = "false";
  const { Client } = require("pg");
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const { sequelize } = require("../dist/config/database.js");
  const { Event, User, Group, GroupMember, Friendship, FriendLevelSetting, ShiftTemplate, ShiftTemplateVersion, ShiftType, ShiftTypeSchedule, WorkShift } = require("../dist/models/index.js");
  const calendar_routes = require("../dist/routes/calendarRoutes.js").default;
  const friend_routes = require("../dist/routes/friendRoutes.js").default;
  const group_routes = require("../dist/routes/groupRoutes.js").default;
  const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: false });
  const root = path.join(__dirname, "..");
  const migration_sql = fs.readFileSync(path.join(root, "migrations/add_event_privacy.sql"), "utf8");
  const final_schema = fs.readFileSync(path.join(root, "migrations/final_schema.sql"), "utf8").replace(/^\\set .*$/gm, "");
  const legacy_schema = fs.readFileSync(path.join(__dirname, "fixtures/groupIntegrationBaseSchema.sql"), "utf8");
  let server;
  let base_url;
  let owner;
  let high_friend;
  let low_friend;
  let denied_friend;
  let non_friend;
  let group;
  let migrated_view_definition;
  const events = [];
  const range_query = "start_date=2026-11-11&end_date=2026-11-11";

  async function createUser(name) {
    return User.create({ email: `${name}@event-privacy.test`, name, timezone: "UTC" });
  }
  async function addFriend(viewer, can_view, friend_level) {
    await Friendship.create(Friendship.sortUserIds(owner.user_id, viewer.user_id));
    await FriendLevelSetting.create({ owner_user_id: owner.user_id, friend_user_id: viewer.user_id, can_view, friend_level });
  }
  async function request(user, route, options = {}) {
    const response = await fetch(`${base_url}/api/v1${route}`, {
      ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ user_id: user.user_id }, process.env.JWT_SECRET)}` },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  function eventIds(rows) { return rows.map(row => row.event_id).sort(); }
  async function metadata() {
    return (await client.query("SELECT attname, atttypid::text, atttypmod, attnum FROM pg_attribute WHERE attrelid='public.v_visible_events_for_friend'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum")).rows;
  }
  async function applyMigration() {
    try { await client.query(migration_sql); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  test.before(async () => { await client.connect(); });
  test.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await sequelize.close();
    await client.end();
  });

  test("기존 데이터 migration은 false 보존·view 컬럼 순서/타입·권한/종속성을 유지한다", async () => {
    await client.query(legacy_schema);
    const owner_id = (await client.query("INSERT INTO users(email,name) VALUES ('legacy-owner@test.test','legacy') RETURNING user_id")).rows[0].user_id;
    const viewer_id = (await client.query("INSERT INTO users(email,name) VALUES ('legacy-viewer@test.test','viewer') RETURNING user_id")).rows[0].user_id;
    await client.query("INSERT INTO friendships(user_id_a,user_id_b) VALUES (LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid))", [owner_id,viewer_id]);
    await client.query("INSERT INTO friend_level_settings(owner_user_id,friend_user_id,friend_level) VALUES ($1,$2,5)",[owner_id,viewer_id]);
    await client.query("INSERT INTO events(owner_user_id,created_by_user_id,title,start_at,end_at) VALUES ($1,$1,'legacy','2026-11-11T00:00:00Z','2026-11-11T01:00:00Z')",[owner_id]);
    await client.query("CREATE VIEW event_privacy_dependency AS SELECT event_id, viewer_user_id FROM v_visible_events_for_friend; GRANT SELECT ON v_visible_events_for_friend TO PUBLIC");
    const before = await metadata();
    const before_acl = (await client.query("SELECT oid, relacl::text FROM pg_class WHERE oid='v_visible_events_for_friend'::regclass")).rows[0];
    await applyMigration();
    migrated_view_definition = (await client.query("SELECT pg_get_viewdef('public.v_visible_events_for_friend'::regclass, true) AS definition")).rows[0].definition;
    const after = await metadata();
    assert.deepEqual(after.slice(0,-1), before);
    assert.equal(after.at(-1).attname, "is_private");
    assert.equal(after.at(-2).attname, "viewer_user_id");
    assert.equal(after.at(-2).atttypid, "2950");
    assert.equal(after.at(-1).atttypid, "16");
    assert.deepEqual((await client.query("SELECT oid, relacl::text FROM pg_class WHERE oid='v_visible_events_for_friend'::regclass")).rows[0], before_acl);
    assert.equal((await client.query("SELECT is_private FROM events")).rows[0].is_private, false);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM event_privacy_dependency")).rows[0].count, 1);
    const column = (await client.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='is_private'")).rows[0];
    assert.equal(column.is_nullable,"NO"); assert.equal(column.column_default,"false");
    await client.query("UPDATE events SET is_private=true");
    assert.equal((await client.query("SELECT count(*)::int AS count FROM event_privacy_dependency")).rows[0].count,0);
    await assert.rejects(applyMigration(), /preflight/);
    assert.equal((await client.query("SELECT is_private FROM events")).rows[0].is_private, true);
    await client.query("UPDATE events SET is_private=false");
    // Old INSERT and SELECT lists remain valid after the additive migration.
    await client.query("INSERT INTO events(owner_user_id,created_by_user_id,title,start_at,end_at) VALUES ($1,$1,'old-client','2026-11-11T02:00:00Z','2026-11-11T03:00:00Z')",[owner_id]);
    assert.equal((await client.query("SELECT event_id,title FROM v_visible_events_for_friend")).rowCount,2);
    await assert.rejects(client.query("UPDATE events SET is_private=NULL"), /not-null/);
  });

  test("예상과 다른 기존 view는 migration을 원자적으로 거절한다", async () => {
    await client.query(legacy_schema);
    await client.query("ALTER VIEW v_visible_events_for_friend RENAME COLUMN viewer_user_id TO unexpected_viewer");
    await assert.rejects(applyMigration(), /preflight/);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='is_private'")).rows[0].count,0);
    await client.query("ALTER VIEW v_visible_events_for_friend RENAME COLUMN unexpected_viewer TO viewer_user_id");
    // Even a same-name pre-existing column must fail, rather than be silently accepted.
    await client.query("ALTER TABLE events ADD COLUMN is_private text");
    await assert.rejects(applyMigration(), /already exists/);
    assert.equal((await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='is_private'")).rows[0].data_type,"text");
  });

  test("신규 설치 DDL에 migration과 같은 view 컬럼·boolean 기본값을 제공한다", async () => {
    await client.query(final_schema);
    assert.equal((await client.query("SELECT pg_get_viewdef('public.v_visible_events_for_friend'::regclass, true) AS definition")).rows[0].definition, migrated_view_definition);
    const privacy_column = (await client.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='is_private'")).rows[0];
    assert.deepEqual(privacy_column, { is_nullable: "NO", column_default: "false" });
    const columns = await metadata();
    assert.equal(columns.at(-2).attname,"viewer_user_id");
    assert.equal(columns.at(-1).attname,"is_private");
    owner = await createUser("owner");
    high_friend = await createUser("high-friend");
    low_friend = await createUser("low-friend");
    denied_friend = await createUser("denied-friend");
    non_friend = await createUser("non-friend");
    await addFriend(high_friend,true,5);
    await addFriend(low_friend,true,2);
    await addFriend(denied_friend,false,5);
    // A stale permission without a friendship cannot bypass the EXISTS condition.
    await FriendLevelSetting.create({ owner_user_id: owner.user_id, friend_user_id: non_friend.user_id, can_view: true, friend_level: 5 });
    group = await Group.create({ name: "private-test", timezone: "UTC", created_by_user_id: owner.user_id });
    for (const user of [owner,high_friend,low_friend,denied_friend,non_friend]) {
      await GroupMember.create({ group_id: group.group_id, user_id: user.user_id, role: user === owner ? "OWNER" : "ADMIN", added_by_user_id: owner.user_id });
    }
    const template = await ShiftTemplate.create({ owner_user_id: owner.user_id, name: "private-test" });
    const version = await ShiftTemplateVersion.create({ template_id: template.template_id, version_no: 1, effective_from: "2026-11-01", created_by_user_id: owner.user_id });
    const shift_type = await ShiftType.create({ template_id: template.template_id, code:"OFF", name:"휴무" });
    const schedule = await ShiftTypeSchedule.create({ shift_type_id:shift_type.shift_type_id, template_version_id:version.template_version_id });
    await WorkShift.create({ owner_user_id:owner.user_id, created_by_user_id:owner.user_id, work_date:"2026-11-11", schedule_id:schedule.schedule_id });
    const app=express(); app.use(express.json()); app.use("/api/v1",calendar_routes); app.use("/api/v1",friend_routes); app.use("/api/v1",group_routes);
    server = await new Promise((resolve,reject) => { const listener=app.listen(0,"127.0.0.1",()=>resolve(listener)); listener.once("error",reject); });
    base_url=`http://127.0.0.1:${server.address().port}`;
    const legacy = await request(owner,"/events",{method:"POST",body:{title:"legacy-api",all_day:false,start_at:"2026-11-11T02:00:00.000Z",end_at:"2026-11-11T03:00:00.000Z",visibility_level:0,owner_user_id:high_friend.user_id,created_by_user_id:high_friend.user_id}});
    assert.equal(legacy.status,201); assert.equal(legacy.body.data.is_private,false);
    const saved=await Event.findByPk(legacy.body.data.event_id);
    assert.equal(saved.owner_user_id,owner.user_id); assert.equal(saved.created_by_user_id,owner.user_id);
    events.push(saved);
    for (const is_private of [false,true]) for (const visibility_level of [0,2,3,5]) for (const kind of ["timed","all-day","multi-day"]) {
      const result=await request(owner,"/events",{method:"POST",body:{title:`${is_private ? "private-secret" : "public"}-${visibility_level}-${kind}`,memo:is_private ? "private-memo-secret" : null,place:is_private ? "private-place-secret" : null,all_day:kind === "all-day",start_at:kind === "multi-day" ? "2026-11-10T23:00:00.000Z" : "2026-11-11T00:00:00.000Z",end_at:kind === "timed" ? "2026-11-11T01:00:00.000Z" : "2026-11-12T00:00:00.000Z",visibility_level,is_private}});
      assert.equal(result.status,201); assert.equal(result.body.data.is_private,is_private); assert.equal(result.body.data.visibility_level,visibility_level);
      events.push(await Event.findByPk(result.body.data.event_id));
    }
    for (const is_private of [false,true]) {
      await Event.create({ owner_user_id:owner.user_id,created_by_user_id:owner.user_id,title:"deleted-secret",all_day:false,start_at:new Date("2026-11-11T00:00:00Z"),end_at:new Date("2026-11-11T01:00:00Z"),is_private,deleted_at:new Date(),deleted_by_user_id:owner.user_id });
    }
    for (const [start_at,end_at] of [["2026-11-10T23:00:00Z","2026-11-11T00:00:00Z"],["2026-11-12T00:00:00Z","2026-11-12T01:00:00Z"]]) {
      await Event.create({ owner_user_id:owner.user_id,created_by_user_id:owner.user_id,title:"boundary-secret",all_day:false,start_at:new Date(start_at),end_at:new Date(end_at),is_private:false });
    }
  });

  test("본인 목록·기간·날짜·그룹은 private를 포함하고 soft delete·배타적 경계를 유지한다",async()=>{
    for (const route of [`/events?${range_query}`,`/calendar/range?${range_query}`,`/groups/${group.group_id}/calendar/range?${range_query}`]) {
      const result=await request(owner,route); assert.equal(result.status,200);
      assert.deepEqual(eventIds(result.body.data.events),eventIds(events));
      assert.ok(result.body.data.events.some(event=>event.is_private===true));
      assert.doesNotMatch(JSON.stringify(result.body),/deleted-secret|boundary-secret/);
    }
    const day=await request(owner,"/calendar/day?date=2026-11-11");assert.equal(day.status,200);
    assert.deepEqual(eventIds(day.body.data.events),eventIds(events.filter(event=>event.start_at.toISOString().startsWith("2026-11-11"))));
    assert.ok(day.body.data.events.some(event=>event.is_private===true));
    assert.equal(day.body.data.work_shifts.length,1);
  });

  test("친구 레벨 5/2에서도 private 전체 행을 친구·그룹 응답에서 제외한다",async()=>{
    for (const [viewer,level] of [[high_friend,5],[low_friend,2]]) {
      const expected=events.filter(event=>!event.is_private && event.visibility_level<=level);
      for (const route of [`/friends/${owner.user_id}/calendar/range?${range_query}`,`/groups/${group.group_id}/calendar/range?${range_query}`]) {
        const result=await request(viewer,route); assert.equal(result.status,200);
        assert.deepEqual(eventIds(result.body.data.events),eventIds(expected));
        assert.ok(result.body.data.events.every(event=>event.is_private===false));
        assert.equal(result.body.data.work_shifts.length,1);
        const serialized=JSON.stringify(result.body);
        assert.doesNotMatch(serialized,/private-secret|private-memo-secret|private-place-secret|deleted-secret|boundary-secret/);
        for (const event of events.filter(event=>event.is_private)) assert.ok(!serialized.includes(event.event_id));
      }
    }
  });

  test("can_view=false·친구 아님·그룹 관리자 모두 공개 범위를 우회하지 못한다",async()=>{
    for (const [viewer,status] of [[denied_friend,403],[non_friend,404]]) {
      const friend=await request(viewer,`/friends/${owner.user_id}/calendar/range?${range_query}`); assert.equal(friend.status,status);
      const grouped=await request(viewer,`/groups/${group.group_id}/calendar/range?${range_query}`); assert.equal(grouped.status,200);
      assert.deepEqual(grouped.body.data.events,[]); assert.deepEqual(grouped.body.data.work_shifts,[]);
      assert.equal(grouped.body.data.members.find(member=>member.user_id===owner.user_id).calendar_access,"DENIED");
    }
    // Revoking access takes effect on the next request; no private/event cache exists.
    const setting = await FriendLevelSetting.findOne({where:{owner_user_id:owner.user_id,friend_user_id:high_friend.user_id}});
    await setting.update({can_view:false});
    assert.equal((await request(high_friend,`/friends/${owner.user_id}/calendar/range?${range_query}`)).status,403);
    assert.deepEqual((await request(high_friend,`/groups/${group.group_id}/calendar/range?${range_query}`)).body.data.events,[]);
  });

  test("private 일정 삭제는 소유자만 가능하며 삭제 후 모든 본인 조회에서 제외한다",async()=>{
    const target=events.find(event=>event.is_private);
    const denied=await request(high_friend,`/events/${target.event_id}`,{method:"DELETE"}); assert.equal(denied.status,404); assert.equal(denied.body.error.code,"EVENT_NOT_FOUND");
    assert.equal((await request(owner,`/events/${target.event_id}`,{method:"DELETE"})).status,200);
    assert.equal((await request(owner,`/events/${target.event_id}`,{method:"DELETE"})).status,404);
    for (const route of [`/events?${range_query}`,`/calendar/range?${range_query}`,"/calendar/day?date=2026-11-11",`/groups/${group.group_id}/calendar/range?${range_query}`]) {
      const result=await request(owner,route); assert.equal(result.status,200);
      assert.ok(!JSON.stringify(result.body).includes(target.event_id));
    }
    const deleted=await Event.findByPk(target.event_id);assert.equal(deleted.deleted_by_user_id,owner.user_id);assert.equal(deleted.is_private,true);
  });

  test("PUT 실제 DB/HTTP: 소유권·null 삭제·기간 이동·private 공개 전환·삭제 경합을 보존한다",async()=>{
    const setting=await FriendLevelSetting.findOne({where:{owner_user_id:owner.user_id,friend_user_id:high_friend.user_id}});
    await setting.update({can_view:true});
    const body={title:"편집 대상",memo:"메모",place:"장소",all_day:false,start_at:"2026-11-11T00:00:00.000Z",end_at:"2026-11-11T01:00:00.000Z",visibility_level:2,is_private:false};
    const created=await request(owner,"/events",{method:"POST",body});assert.equal(created.status,201);
    const id=created.body.data.event_id;
    for(const user of [high_friend,non_friend]) {
      const denied=await request(user,`/events/${id}`,{method:"PUT",body});
      assert.equal(denied.status,404);assert.equal(denied.body.error.code,"EVENT_NOT_FOUND");
    }
    const moved={...body,title:"편집 완료",memo:null,place:null,all_day:true,start_at:"2026-11-12T00:00:00.000Z",end_at:"2026-11-14T00:00:00.000Z",is_private:true};
    const updated=await request(owner,`/events/${id}`,{method:"PUT",body:{...moved,owner_user_id:high_friend.user_id,created_by_user_id:high_friend.user_id}});
    assert.equal(updated.status,200);assert.equal(updated.body.data.event_id,id);
    assert.equal(updated.body.data.created_at,created.body.data.created_at);
    assert.ok(Date.parse(updated.body.data.updated_at)>=Date.parse(created.body.data.updated_at));
    const saved=await Event.findByPk(id);assert.equal(saved.owner_user_id,owner.user_id);assert.equal(saved.created_by_user_id,owner.user_id);
    assert.equal(saved.memo,null);assert.equal(saved.place,null);assert.equal(saved.is_private,true);
    const own_old=await request(owner,"/events?start_date=2026-11-11&end_date=2026-11-11");
    assert.ok(!own_old.body.data.events.some(event=>event.event_id===id));
    const own_new=await request(owner,"/calendar/range?start_date=2026-11-12&end_date=2026-11-13");
    assert.ok(own_new.body.data.events.some(event=>event.event_id===id));
    for(const route of [`/friends/${owner.user_id}/calendar/range?start_date=2026-11-12&end_date=2026-11-13`,`/groups/${group.group_id}/calendar/range?start_date=2026-11-12&end_date=2026-11-13`]) {
      const result=await request(high_friend,route);assert.equal(result.status,200);assert.ok(!JSON.stringify(result.body).includes(id));
    }
    assert.equal((await request(owner,`/events/${id}`,{method:"PUT",body:{...moved,is_private:false}})).status,200);
    const visible=await request(high_friend,`/friends/${owner.user_id}/calendar/range?start_date=2026-11-12&end_date=2026-11-13`);
    assert.ok(visible.body.data.events.some(event=>event.event_id===id));
    assert.equal((await request(owner,`/events/${id}`,{method:"DELETE"})).status,200);
    const missing=await request(owner,`/events/${id}`,{method:"PUT",body:moved});assert.equal(missing.status,404);
    assert.ok((await Event.findByPk(id)).deleted_at);
    // 삭제/수정 실행 순서와 무관하게 삭제된 행을 되살리지 않는다.
    const racing=await request(owner,"/events",{method:"POST",body});const racing_id=racing.body.data.event_id;
    const results=await Promise.all([request(owner,`/events/${racing_id}`,{method:"DELETE"}),request(owner,`/events/${racing_id}`,{method:"PUT",body:moved})]);
    assert.equal(results[0].status,200);assert.ok([200,404].includes(results[1].status));assert.ok((await Event.findByPk(racing_id)).deleted_at);
  });
}
