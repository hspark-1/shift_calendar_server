const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const destructive_reset_is_explicitly_allowed =
  process.env.GROUP_INTEGRATION_ALLOW_SCHEMA_RESET === "true";
const is_isolated_group_debug_database =
  process.env.DB_HOST === "127.0.0.1" &&
  process.env.DB_PORT === "55432" &&
  process.env.DB_NAME === "shift_calendar_group_debug" &&
  process.env.DB_USER === "group_debug";

if (process.env.RUN_GROUP_INTEGRATION !== "true") {
  test("그룹 PostgreSQL 16 통합 테스트는 명시적으로 활성화한다", { skip: true }, () => {});
} else if (
  !destructive_reset_is_explicitly_allowed ||
  !is_isolated_group_debug_database
) {
  test("그룹 통합 테스트는 고정된 격리 DB에서만 public schema를 초기화한다", () => {
    assert.fail(
      "GROUP_INTEGRATION_ALLOW_SCHEMA_RESET=true와 127.0.0.1:55432/shift_calendar_group_debug/group_debug 연결이 모두 필요합니다.",
    );
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.GROUP_MEMBER_LIMIT = "20";
  process.env.GROUP_INVITATION_TTL_DAYS = "7";
  process.env.GROUP_CALENDAR_MAX_RANGE_DAYS = "100";
  process.env.JWT_SECRET = "group-integration-access-secret";
  process.env.API_DOCS_ENABLED = "true";

  const { QueryTypes } = require("sequelize");
  const jwt = require("jsonwebtoken");
  const {
    sequelize,
    connectDatabase,
    disconnectDatabase,
  } = require("../dist/config/database.js");
  const {
    Event,
    FriendLevelSetting,
    Friendship,
    Group,
    GroupInvitation,
    GroupMember,
    Notification,
    ShiftTemplate,
    ShiftTemplateVersion,
    ShiftType,
    ShiftTypeSchedule,
    User,
    WorkShift,
  } = require("../dist/models/index.js");
  const groupService = require("../dist/services/groupService.js");
  const { app } = require("../dist/index.js");

  const root = path.join(__dirname, "..");
  let api_server;
  let api_base_url;
  let owner;
  let viewer;
  let visible;
  let denied;
  let non_friend;
  let group_id;
  let schedule;

  async function applyMigration() {
    const migration = fs
      .readFileSync(path.join(root, "migrations", "add_group_feature.sql"), "utf8")
      .replace(/^\\set .*$/gm, "");
    await sequelize.query(migration);
  }

  async function rollbackMigration() {
    const rollback = fs.readFileSync(
      path.join(root, "migrations", "rollback_group_feature.sql"),
      "utf8",
    );
    const transaction = rollback.match(/BEGIN;[\s\S]*?COMMIT;/);
    assert.ok(transaction);
    await sequelize.query(transaction[0]);
  }

  async function addFriend(user_a, user_b, can_view = true, friend_level = 0) {
    const pair = Friendship.sortUserIds(user_a.user_id, user_b.user_id);
    await Friendship.findOrCreate({ where: pair, defaults: pair });
    await FriendLevelSetting.upsert({
      owner_user_id: user_a.user_id,
      friend_user_id: user_b.user_id,
      can_view,
      friend_level,
    });
    await FriendLevelSetting.upsert({
      owner_user_id: user_b.user_id,
      friend_user_id: user_a.user_id,
      can_view: true,
      friend_level: 0,
    });
  }

  async function createUser(name) {
    return User.create({
      email: `${name.toLowerCase().replaceAll(" ", "-")}@group.test`,
      name,
      timezone: "Asia/Seoul",
      password: null,
    });
  }

  async function inviteAndAccept(inviter, invitee) {
    const [invitation] = await groupService.inviteGroupMembers(
      inviter.user_id,
      group_id,
      [invitee.user_id],
    );
    return groupService.respondToInvitation(
      invitee.user_id,
      invitation.invitation_id,
      "accept",
    );
  }

  test.before(async () => {
    await connectDatabase();
    const base_schema = fs.readFileSync(
      path.join(__dirname, "fixtures", "groupIntegrationBaseSchema.sql"),
      "utf8",
    );
    await sequelize.query(base_schema);

    await applyMigration();
    const tables_after_apply = await sequelize.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('groups', 'group_members', 'group_invitations')
        ORDER BY table_name
      `,
      { type: QueryTypes.SELECT },
    );
    assert.deepEqual(
      tables_after_apply.map((row) => row.table_name),
      ["group_invitations", "group_members", "groups"],
    );
    await assert.rejects(applyMigration(), /preflight/);
    await rollbackMigration();
    const tables_after_rollback = await sequelize.query(
      `
        SELECT count(*)::integer AS count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('groups', 'group_members', 'group_invitations')
      `,
      { type: QueryTypes.SELECT },
    );
    assert.equal(tables_after_rollback[0].count, 0);
    await applyMigration();

    owner = await createUser("Owner");
    viewer = await createUser("Viewer");
    visible = await createUser("Visible");
    denied = await createUser("Denied");
    non_friend = await createUser("Non Friend");
    await addFriend(owner, viewer);
    await addFriend(owner, visible);
    await addFriend(owner, denied);
    await addFriend(visible, viewer, true, 2);
    await addFriend(viewer, denied, true, 0);
    await sequelize.query(
      `
        UPDATE friend_level_settings
        SET can_view = false,
            updated_at = now()
        WHERE owner_user_id = :owner_user_id
          AND friend_user_id = :friend_user_id
      `,
      {
        replacements: {
          owner_user_id: denied.user_id,
          friend_user_id: viewer.user_id,
        },
      },
    );
    owner.timezone = "Invalid/Timezone";
    await owner.save();

    const template = await ShiftTemplate.create({
      owner_user_id: visible.user_id,
      name: "Group Template",
    });
    const version = await ShiftTemplateVersion.create({
      template_id: template.template_id,
      version_no: 1,
      effective_from: new Date("2026-01-01"),
      created_by_user_id: visible.user_id,
    });
    const shift_type = await ShiftType.create({
      template_id: template.template_id,
      code: "D",
      name: "Day",
      color: "#FF9500",
      base_color: "#FFFF9500",
      color_intensity: 100,
    });
    schedule = await ShiftTypeSchedule.create({
      shift_type_id: shift_type.shift_type_id,
      template_version_id: version.template_version_id,
      start_time: "07:00:00",
      end_time: "15:00:00",
      duration_minutes: 480,
    });
    await new Promise((resolve) => {
      api_server = app.listen(0, "127.0.0.1", resolve);
    });
    api_base_url = `http://127.0.0.1:${api_server.address().port}`;
  });

  test.after(async () => {
    if (api_server) {
      await new Promise((resolve, reject) => {
        api_server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
  });

  function accessToken(user) {
    return jwt.sign(
      { user_id: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
  }

  async function apiFetch(user, route, options = {}) {
    return fetch(`${api_base_url}${route}`, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(user ? { authorization: `Bearer ${accessToken(user)}` } : {}),
        ...options.headers,
      },
    });
  }

  test("그룹 생성은 OWNER와 초기 초대/알림까지 원자적이다", async () => {
    await assert.rejects(
      groupService.createGroup(owner.user_id, {
        name: "Invalid Timezone",
        timezone: "Invalid/Timezone",
      }),
      /INVALID_GROUP_TIMEZONE/,
    );
    await assert.rejects(
      groupService.createGroup(owner.user_id, {
        name: "Atomic Failure",
        invitee_user_ids: [non_friend.user_id],
      }),
      /GROUP_INVITEE_NOT_FRIEND/,
    );
    assert.equal(await Group.count(), 0);
    assert.equal(await GroupMember.count(), 0);

    const created = await groupService.createGroup(owner.user_id, {
      name: "Ward Team",
      invitee_user_ids: [viewer.user_id],
    });
    group_id = created.group.group_id;
    assert.equal(created.group.my_role, "OWNER");
    assert.equal(created.group.timezone, "Asia/Seoul");
    assert.equal(created.group.member_count, 1);
    assert.equal(created.invitations.length, 1);
    assert.equal(
      await Notification.count({
        where: { notification_type: "GROUP_INVITATION" },
      }),
      1,
    );
  });

  test("active 멤버/OWNER/PENDING partial unique 제약을 강제한다", async () => {
    await assert.rejects(
      GroupMember.create({
        group_id,
        user_id: owner.user_id,
        role: "MEMBER",
        added_by_user_id: owner.user_id,
      }),
    );
    await assert.rejects(
      GroupMember.create({
        group_id,
        user_id: non_friend.user_id,
        role: "OWNER",
        added_by_user_id: owner.user_id,
      }),
    );
    const pending = await GroupInvitation.findOne({
      where: { group_id, invitee_user_id: viewer.user_id, status: "PENDING" },
    });
    await assert.rejects(
      GroupInvitation.create({
        group_id,
        inviter_user_id: owner.user_id,
        invitee_user_id: viewer.user_id,
        expires_at: new Date(Date.now() + 86400000),
      }),
    );
    assert.ok(pending);
  });

  test("동일 초대의 동시 수락은 한 요청만 성공한다", async () => {
    const invitation = await GroupInvitation.findOne({
      where: { group_id, invitee_user_id: viewer.user_id, status: "PENDING" },
    });
    const results = await Promise.allSettled([
      groupService.respondToInvitation(
        viewer.user_id,
        invitation.invitation_id,
        "accept",
      ),
      groupService.respondToInvitation(
        viewer.user_id,
        invitation.invitation_id,
        "accept",
      ),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      await GroupMember.count({
        where: { group_id, user_id: viewer.user_id, removed_at: null },
      }),
      1,
    );
  });

  test("공개 HTTP 계약은 인증·wrapper·권한·개인정보 비노출을 지킨다", async () => {
    const openapi_response = await fetch(
      `${api_base_url}/api-docs/openapi.json`,
    );
    assert.equal(openapi_response.status, 200);
    assert.equal((await openapi_response.json()).openapi, "3.0.3");

    const unauthorized = await apiFetch(null, "/api/v1/groups");
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED");

    const list_response = await apiFetch(viewer, "/api/v1/groups?page=1&limit=20");
    assert.equal(list_response.status, 200);
    const list_body = await list_response.json();
    assert.equal(list_body.success, true);
    assert.equal(list_body.data.groups[0].group_id, group_id);
    assert.ok(list_body.data.groups[0].members_preview.length <= 4);
    assert.doesNotMatch(JSON.stringify(list_body), /"email"|"phone"/);

    const detail_response = await apiFetch(
      viewer,
      `/api/v1/groups/${group_id}`,
    );
    assert.equal(detail_response.status, 200);
    const detail_body = await detail_response.json();
    assert.equal(detail_body.data.group.my_role, "MEMBER");
    assert.equal(
      detail_body.data.group.members.every(
        (member) => Object.hasOwn(member, "profile_image_url"),
      ),
      true,
    );

    const forbidden = await apiFetch(viewer, `/api/v1/groups/${group_id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Forbidden Rename" }),
    });
    assert.equal(forbidden.status, 403);
    assert.equal(
      (await forbidden.json()).error.code,
      "GROUP_PERMISSION_DENIED",
    );

    const hidden = await apiFetch(
      non_friend,
      `/api/v1/groups/${group_id}`,
    );
    assert.equal(hidden.status, 404);
    assert.equal((await hidden.json()).error.code, "GROUP_NOT_FOUND");

    const invalid_range = await apiFetch(
      viewer,
      `/api/v1/groups/${group_id}/calendar/range?start_date=2026-02-30&end_date=2026-03-01`,
    );
    assert.equal(invalid_range.status, 400);
    assert.equal(
      (await invalid_range.json()).error.code,
      "INVALID_DATE_RANGE",
    );
  });

  test("멤버 제한과 만료 초대의 재초대를 처리한다", async () => {
    const limited = await groupService.createGroup(owner.user_id, {
      name: "Limited",
      invitee_user_ids: [visible.user_id],
    });
    process.env.GROUP_MEMBER_LIMIT = "1";
    await assert.rejects(
      groupService.respondToInvitation(
        visible.user_id,
        limited.invitations[0].invitation_id,
        "accept",
      ),
      /GROUP_MEMBER_LIMIT_REACHED/,
    );
    process.env.GROUP_MEMBER_LIMIT = "20";
    await sequelize.query(
      `
        UPDATE group_invitations
        SET created_at = now() - interval '8 days',
            expires_at = now() - interval '1 day'
        WHERE invitation_id = :invitation_id
      `,
      {
        replacements: {
          invitation_id: limited.invitations[0].invitation_id,
        },
      },
    );
    const reinvited = await groupService.inviteGroupMembers(
      owner.user_id,
      limited.group.group_id,
      [visible.user_id],
    );
    assert.equal(reinvited.length, 1);
    assert.equal(
      await GroupInvitation.count({
        where: {
          group_id: limited.group.group_id,
          invitee_user_id: visible.user_id,
          status: "EXPIRED",
        },
      }),
      1,
    );
  });

  test("P1 역할 변경·제거·소유권 이전·나가기와 soft-delete 재가입을 처리한다", async () => {
    await inviteAndAccept(owner, visible);
    await inviteAndAccept(owner, denied);
    await groupService.updateGroupMemberRole(
      owner.user_id,
      group_id,
      visible.user_id,
      "ADMIN",
    );
    const transferred = await groupService.transferGroupOwner(
      owner.user_id,
      group_id,
      visible.user_id,
    );
    assert.equal(transferred.my_role, "ADMIN");
    assert.equal(
      transferred.members.find((member) => member.user_id === visible.user_id).role,
      "OWNER",
    );
    await groupService.removeGroupMember(
      visible.user_id,
      group_id,
      denied.user_id,
    );
    await addFriend(visible, denied);
    await inviteAndAccept(visible, denied);
    await groupService.leaveGroup(owner.user_id, group_id);
    assert.equal(
      await GroupMember.count({
        where: { group_id, user_id: owner.user_id, removed_at: null },
      }),
      0,
    );

    await addFriend(visible, owner);
    await inviteAndAccept(visible, owner);
    await addFriend(visible, non_friend);
    await inviteAndAccept(visible, non_friend);
    const non_friend_pair = Friendship.sortUserIds(
      visible.user_id,
      non_friend.user_id,
    );
    await Friendship.destroy({ where: non_friend_pair });
    for (let index = 0; index < 15; index += 1) {
      const extra_member = await createUser(`Extra ${index}`);
      await GroupMember.create({
        group_id,
        user_id: extra_member.user_id,
        role: "MEMBER",
        added_by_user_id: visible.user_id,
      });
    }
    assert.equal(
      await GroupMember.count({ where: { group_id, user_id: owner.user_id } }),
      2,
    );
    assert.equal(
      await GroupMember.count({ where: { group_id, removed_at: null } }),
      20,
    );
  });

  test("20명·100일 공개 회귀 fixture는 SELF/VISIBLE/DENIED와 3 query aggregate를 지킨다", async () => {
    await WorkShift.create({
      owner_user_id: visible.user_id,
      work_date: "2026-07-29",
      schedule_id: schedule.schedule_id,
      created_by_user_id: visible.user_id,
    });
    await WorkShift.create({
      owner_user_id: denied.user_id,
      work_date: "2026-07-29",
      schedule_id: schedule.schedule_id,
      created_by_user_id: denied.user_id,
    });
    await WorkShift.create({
      owner_user_id: visible.user_id,
      work_date: "2026-07-30",
      schedule_id: schedule.schedule_id,
      created_by_user_id: visible.user_id,
      deleted_at: new Date("2026-07-30T12:00:00.000Z"),
      deleted_by_user_id: visible.user_id,
    });
    await Event.create({
      owner_user_id: visible.user_id,
      created_by_user_id: visible.user_id,
      title: "Visible level 2",
      all_day: false,
      start_at: new Date("2026-07-28T15:00:00.000Z"),
      end_at: new Date("2026-07-28T16:00:00.000Z"),
      visibility_level: 2,
    });
    await Event.create({
      owner_user_id: denied.user_id,
      created_by_user_id: denied.user_id,
      title: "Denied",
      all_day: false,
      start_at: new Date("2026-07-28T15:00:00.000Z"),
      end_at: new Date("2026-07-28T16:00:00.000Z"),
      visibility_level: 0,
    });
    await Event.create({
      owner_user_id: visible.user_id,
      created_by_user_id: visible.user_id,
      title: "Ends at range start",
      all_day: false,
      start_at: new Date("2026-05-31T14:00:00.000Z"),
      end_at: new Date("2026-05-31T15:00:00.000Z"),
      visibility_level: 0,
    });
    await Event.create({
      owner_user_id: visible.user_id,
      created_by_user_id: visible.user_id,
      title: "Starts after range end",
      all_day: false,
      start_at: new Date("2026-09-08T15:00:00.000Z"),
      end_at: new Date("2026-09-08T16:00:00.000Z"),
      visibility_level: 0,
    });
    await Event.create({
      owner_user_id: visible.user_id,
      created_by_user_id: visible.user_id,
      title: "Soft deleted",
      all_day: false,
      start_at: new Date("2026-07-28T15:00:00.000Z"),
      end_at: new Date("2026-07-28T16:00:00.000Z"),
      visibility_level: 0,
      deleted_at: new Date("2026-07-28T17:00:00.000Z"),
      deleted_by_user_id: visible.user_id,
    });

    let select_count = 0;
    const previous_logging = sequelize.options.logging;
    sequelize.options.logging = (sql) => {
      if (/^Executing .*SELECT/i.test(sql)) select_count += 1;
    };
    const result = await groupService.getGroupCalendarRange(
      viewer.user_id,
      group_id,
      "2026-06-01",
      "2026-09-08",
    );
    sequelize.options.logging = previous_logging;
    assert.equal(result.query_count, 3);
    assert.ok(select_count <= 3);
    assert.equal(result.range_days, 100);
    assert.equal(result.members.length, 20);
    assert.equal(
      result.members.find((member) => member.user_id === viewer.user_id)
        .calendar_access,
      "SELF",
    );
    assert.equal(
      result.members.find((member) => member.user_id === visible.user_id)
        .calendar_access,
      "VISIBLE",
    );
    assert.equal(
      result.members.find((member) => member.user_id === denied.user_id)
        .calendar_access,
      "DENIED",
    );
    assert.equal(
      result.members.find((member) => member.user_id === non_friend.user_id)
        .calendar_access,
      "DENIED",
    );
    assert.deepEqual(
      result.work_shifts.map((shift) => shift.owner_user_id),
      [visible.user_id],
    );
    assert.deepEqual(
      result.events.map((event) => event.title),
      ["Visible level 2"],
    );
    assert.equal(result.work_shifts[0].work_date, "2026-07-29");
    assert.match(result.work_shifts[0].shift_type_color, /^#[0-9A-F]{8}$/);
  });

  test("그룹 삭제는 멤버·PENDING 초대·알림을 함께 종료한다", async () => {
    await groupService.deleteGroup(visible.user_id, group_id);
    const group = await Group.findByPk(group_id);
    assert.ok(group.deleted_at);
    assert.equal(
      await GroupMember.count({ where: { group_id, removed_at: null } }),
      0,
    );
    assert.equal(
      await GroupInvitation.count({ where: { group_id, status: "PENDING" } }),
      0,
    );
  });
}
