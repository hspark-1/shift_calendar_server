const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const axios = require('axios');
const enabled = process.env.RUN_NAVER_AUTH_INTEGRATION === 'true';
const isolated = process.env.NAVER_INTEGRATION_ALLOW_SCHEMA_RESET === 'true' && process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '55433' && process.env.DB_NAME === 'shift_calendar_naver_test' && process.env.DB_USER === 'naver_test';
if (!enabled) {
  test('네이버 DB 통합은 명시적으로 활성화한다', { skip: true }, () => {});
} else if (!isolated) {
  test('네이버 DB 통합의 공유 DB 초기화 거절', () => assert.fail('전용 127.0.0.1:55433/shift_calendar_naver_test/naver_test와 schema reset 동의 필요'));
} else {
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'naver-test-access', JWT_REFRESH_SECRET: 'naver-test-refresh', AUTH_RATE_LIMIT_MAX: '200', NAVER_CLIENT_ID: 'naver-test-client', NAVER_CLIENT_SECRET: 'naver-test-secret', API_DOCS_ENABLED: 'true' });
  const { sequelize } = require('../dist/config/database');
  const { User, RefreshToken, ShiftTemplate } = require('../dist/models');
  const { completeNaverLogin } = require('../dist/services/naverService');
  const { updateProfileFields } = require('../dist/services/profileService');
  const { app } = require('../dist/index');
  let server;
  let base_url;
  let upstream_profile;
  const original_get = axios.get;
  const original_post = axios.post;
  function identity(id, extra = {}) { return { naver_id: id, email: `${id}@example.test`, name: '네이버 사용자', phone: null, ...extra }; }
  async function login(path, response_fields, extra = {}) {
    upstream_profile = { resultcode: '00', response: response_fields };
    const response = await fetch(`${base_url}/api/v1/auth${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path === '/naver' ? { code: 'naver-code', state: 'state', redirect_uri: 'https://app.example.test/callback', ...extra } : { access_token: 'naver-token', ...extra }) });
    return { status: response.status, body: await response.json() };
  }
  test.before(async () => {
    await sequelize.authenticate();
    const sql = fs.readFileSync('migrations/final_schema.sql', 'utf8').split('\n').filter((line) => !line.startsWith('\\')).join('\n');
    await sequelize.query(sql);
    axios.get = async () => ({ data: upstream_profile });
    axios.post = async () => ({ data: { access_token: 'naver-token' } });
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base_url = `http://127.0.0.1:${server.address().port}`;
  });
  test.after(async () => {
    axios.get = original_get; axios.post = original_post;
    if (server) await new Promise((resolve) => server.close(resolve));
    await sequelize.close();
  });
  for (const [path, id, phone] of [['/naver', 'http-code', '010-1000-0001'], ['/naver/token', 'http-token', '010-1000-0002']]) {
    test(`${path} 신규 phone 저장·사진 무시·JWT·완료 상태`, async () => {
      const result = await login(path, { id, email: `${id}@example.test`, name: '사용자', mobile: phone.replaceAll('-', ''), profile_image: 'https://ignored.example.test/photo' }, { phone: '01099999999' });
      assert.equal(result.status, 200);
      const { user, access_token, requires_profile_setup } = result.body.data;
      assert.equal(user.phone, phone); assert.equal(user.profile_image_url, null);
      assert.equal(requires_profile_setup, true); assert.equal(typeof access_token, 'string');
      assert.equal(await ShiftTemplate.count({ where: { owner_user_id: user.user_id } }), 1);
      assert.equal(await RefreshToken.count({ where: { user_id: user.user_id } }), 1);
      assert.equal((await User.findByPk(user.user_id)).profile_completed_at, null);
      assert.equal(typeof result.body.request_id, 'string');
    });
  }
  test('번호 미제공/지원하지 않는 형식은 null로 가입 가능하다', async () => {
    for (const [id, mobile] of [['no-mobile', undefined], ['bad-mobile', '+821012345678']]) {
      const result = await login('/naver/token', { id, email: `${id}@example.test`, mobile });
      assert.equal(result.status, 200); assert.equal(result.body.data.user.phone, null);
      assert.equal(result.body.data.requires_profile_setup, true);
    }
  });
  test('기존 사용자의 빈 번호만 보완하고 완료 시각·업로드 사진·이름을 보존한다', async () => {
    const user = await User.create({ ...identity('existing-empty'), profile_completed_at: new Date('2026-01-01T00:00:00Z'), profile_image_url: 'https://api.example.test/profile', name: '저장 이름' });
    const key = `test/profiles/${user.user_id}/00000000-0000-4000-8000-000000000001.png`;
    await user.update({ profile_image_key: key });
    const result = await completeNaverLogin(identity('existing-empty', { phone: '010-1000-0003', name: '변경 이름' }));
    assert.equal(result.user.phone, '010-1000-0003'); assert.equal(result.user.profile_image_key, key);
    assert.equal(result.user.profile_image_url, 'https://api.example.test/profile'); assert.equal(result.user.name, '저장 이름');
    assert.equal(result.user.profile_completed_at.toISOString(), '2026-01-01T00:00:00.000Z');
    const again = await completeNaverLogin(identity('existing-empty', { phone: '010-1000-9999' }));
    assert.equal(again.user.phone, '010-1000-0003'); assert.equal(again.is_new_user, false);
  });
  test('기존 이메일 연결은 빈 번호를 보완하며 기존 사진을 보존한다', async () => {
    const user = await User.create({ email: 'link@example.test', name: '기존', profile_image_url: 'https://old.example.test/photo' });
    const result = await completeNaverLogin(identity('link', { phone: '010-1000-0004' }));
    assert.equal(result.user.user_id, user.user_id); assert.equal(result.user.naver_id, 'link');
    assert.equal(result.user.phone, '010-1000-0004'); assert.equal(result.user.profile_image_url, 'https://old.example.test/photo');
    await assert.rejects(completeNaverLogin(identity('other-link', { email: 'link@example.test' })), (e) => e.code === 'NAVER_ACCOUNT_CONFLICT');
  });
  test('전화번호 중복은 두 HTTP 경로409·안전한 오류이고 계정/세션을 남기지 않는다', async () => {
    await User.create({ email: 'phone-owner@example.test', name: '번호 소유자', phone: '010-1000-0005' });
    const tokens_before = await RefreshToken.count();
    for (const [path, id] of [['/naver', 'duplicate-code'], ['/naver/token', 'duplicate-token']]) {
      const result = await login(path, { id, email: `${id}@example.test`, mobile: '01010000005' });
      assert.equal(result.status, 409); assert.equal(result.body.error.code, 'PHONE_ALREADY_EXISTS');
      assert.equal(result.body.message, result.body.error.message);
      assert.equal(JSON.stringify(result.body).includes('010-1000-0005'), false);
      assert.equal(await User.count({ where: { naver_id: id } }), 0);
    }
    assert.equal(await RefreshToken.count(), tokens_before);
  });
  test('동시 동일 회원 로그인은 사용자/템플릿 하나와 세션 둘을 만든다', async () => {
    const results = await Promise.all([completeNaverLogin(identity('concurrent', { phone: '010-1000-0006' })), completeNaverLogin(identity('concurrent', { phone: '010-1000-0006' }))]);
    assert.deepEqual(results.map((r) => r.is_new_user).sort(), [false, true]);
    assert.equal(await User.count({ where: { naver_id: 'concurrent' } }), 1);
    assert.equal(await ShiftTemplate.count({ where: { owner_user_id: results[0].user.user_id } }), 1);
    assert.equal(await RefreshToken.count({ where: { user_id: results[0].user.user_id } }), 2);
  });
  test('다른 회원의 동시 동일 번호 저장은 하나만 성공하고 다른 요청은409다', async () => {
    const results = await Promise.allSettled(['race-a', 'race-b'].map((id) => completeNaverLogin(identity(id, { phone: '010-1000-0007' }))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PHONE_ALREADY_EXISTS');
    assert.equal(await User.count({ where: { phone: '010-1000-0007' } }), 1);
  });
  test('프로필 편집과 동시 로그인에서도 사용자 편집 번호가 보존된다', async () => {
    const user = await User.create(identity('profile-race'));
    await Promise.all([completeNaverLogin(identity('profile-race', { phone: '010-1000-0008' })), updateProfileFields(user.user_id, { phone: '01010000009' })]);
    await user.reload(); assert.equal(user.phone, '010-1000-0009');
  });
  test('탈퇴 진행 사용자는 번호 보완·네이버 연결·세션 발급을 하지 않는다', async () => {
    const user = await User.create({ email: 'deleting@example.test', name: '탈퇴', account_status: 'DELETION_PENDING', deletion_requested_at: new Date() });
    await assert.rejects(completeNaverLogin(identity('deleting', { phone: '010-1000-0010' })), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS');
    await user.reload(); assert.equal(user.phone, null); assert.equal(user.naver_id, null);
    assert.equal(await RefreshToken.count({ where: { user_id: user.user_id } }), 0);
  });
  test('세션/템플릿 실패는 신규 계정·기존 연결/번호 보완까지 rollback한다', async () => {
    await sequelize.query("ALTER TABLE refresh_tokens ADD CONSTRAINT ck_naver_refresh_failure CHECK(device_info IS DISTINCT FROM 'force-failure')");
    const existing = await User.create({ email: 'rollback-existing@example.test', name: '기존' });
    try {
      for (const id of ['rollback-new', 'rollback-existing']) {
        await assert.rejects(completeNaverLogin(identity(id, { phone: '010-1000-0011' }), 'force-failure'));
        assert.equal(await User.count({ where: { naver_id: id } }), 0);
      }
      await existing.reload(); assert.equal(existing.phone, null);
      assert.equal(await ShiftTemplate.count({ where: { owner_user_id: existing.user_id } }), 0);
    } finally { await sequelize.query('ALTER TABLE refresh_tokens DROP CONSTRAINT ck_naver_refresh_failure'); }
    await sequelize.query("ALTER TABLE shift_templates ADD CONSTRAINT ck_naver_template_failure CHECK(name <> '기본 3교대') NOT VALID");
    try {
      await assert.rejects(completeNaverLogin(identity('template-failure', { phone: '010-1000-0012' })));
      assert.equal(await User.count({ where: { naver_id: 'template-failure' } }), 0);
    } finally { await sequelize.query('ALTER TABLE shift_templates DROP CONSTRAINT ck_naver_template_failure'); }
  });
  test('예상하지 못한 DB 오류는 HTTP500으로 원문을 숨긴다', async () => {
    // ORM 오류 응답은 서비스 오류 주입으로 확인하고 실제 DB rollback은 위 테스트에서 검증한다.
    const original = User.findOne;
    User.findOne = async () => { throw new Error('private database details'); };
    try {
      const result = await login('/naver/token', { id: 'db-error', email: 'db-error@example.test' });
      assert.equal(result.status, 500); assert.equal(result.body.error.code, 'INTERNAL_SERVER_ERROR');
      assert.equal(JSON.stringify(result.body).includes('private database details'), false);
    } finally { User.findOne = original; }
  });
  test('실제 OpenAPI에 두 네이버 계약이 등록되고 잘못된 요청은400이다', async () => {
    const response = await fetch(`${base_url}/api-docs/openapi.json`);
    assert.equal(response.status, 200);
    const spec = await response.json();
    for (const path of ['/auth/naver', '/auth/naver/token']) {
      assert.ok(spec.paths[path].post.responses['409']);
    }
    assert.equal(spec.components.schemas.OwnProfile.properties.phone.nullable, true);
    assert.equal(spec.components.schemas.OwnProfile.properties.profile_image_url.nullable, true);
    const invalid = await fetch(`${base_url}/api/v1/auth/naver/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
  });
}
