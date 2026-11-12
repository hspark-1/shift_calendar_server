const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { getNaverUserInfo, processNaverLogin, NaverAuthError } = require('../dist/services/naverService');

function profile(extra = {}) {
  return { resultcode: '00', response: { id: 'naver-test', email: 'naver@example.test', name: '이름', ...extra } };
}
async function withProfile(t, data, action) {
  t.mock.method(axios, 'get', async (url, options) => {
    assert.equal(url, 'https://openapi.naver.com/v1/nid/me');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.timeout, 5000);
    return { data };
  });
  return action();
}
for (const [input, expected] of [
  ['010-1234-5678', '010-1234-5678'], ['01012345678', '010-1234-5678'],
  ['0111234567', '011-123-4567'], [' 01012345678 ', '010-1234-5678'],
  [undefined, null], [null, null], ['', null], [' ', null], [1234, null],
  [{ number: '01012345678' }, null], ['+821012345678', null], ['010-12-345678', null],
]) {
  test(`mobile 정규화 ${JSON.stringify(input)}`, async (t) => {
    await withProfile(t, profile({ mobile: input, profile_image: 'https://unused.example.test/photo.jpg' }), async () => {
      const result = await getNaverUserInfo('test-token');
      assert.deepEqual(result, { naver_id: 'naver-test', email: 'naver@example.test', name: '이름', phone: expected });
      assert.equal('profile_image_url' in result, false);
    });
  });
}
test('사진 없는 응답과 nickname 우선/기본 이름을 지원한다', async (t) => {
  for (const [extra, expected] of [[{ nickname: '별명' }, '별명'], [{ name: undefined }, '네이버 사용자']]) {
    await withProfile(t, profile(extra), async () => assert.equal((await getNaverUserInfo('test-token')).name, expected));
    t.mock.restoreAll();
  }
});
test('이메일/식별자/실패 응답은 공개 오류로 반환한다', async (t) => {
  for (const [data, code] of [[null, 'NAVER_INVALID_PROFILE'], [profile({ email: undefined }), 'NAVER_EMAIL_UNAVAILABLE'], [profile({ id: '' }), 'NAVER_INVALID_PROFILE'], [{ resultcode: '00' }, 'NAVER_INVALID_PROFILE'], [{ resultcode: '99', message: 'private-upstream' }, 'NAVER_INVALID_PROFILE']]) {
    await withProfile(t, data, async () => assert.rejects(getNaverUserInfo('test-token'), (error) => error instanceof NaverAuthError && error.code === code && !error.message.includes('private-upstream')));
    t.mock.restoreAll();
  }
});
test('네이버 오류 원문과 token을 응답에 노출하지 않는다', async (t) => {
  for (const [status, code] of [[401, 'NAVER_INVALID_TOKEN'], [500, 'NAVER_UPSTREAM_UNAVAILABLE'], [undefined, 'NAVER_UPSTREAM_UNAVAILABLE']]) {
    t.mock.method(axios, 'get', async () => { throw Object.assign(new Error('private-token'), { isAxiosError: true, response: status ? { status, data: { message: 'private-token' } } : undefined }); });
    await assert.rejects(getNaverUserInfo('test-token'), (error) => error.code === code && !error.message.includes('private-token'));
    t.mock.restoreAll();
  }
});
test('code 경로도 같은 phone 매핑과 사진 제외를 사용한다', async (t) => {
  const old_id = process.env.NAVER_CLIENT_ID;
  const old_secret = process.env.NAVER_CLIENT_SECRET;
  process.env.NAVER_CLIENT_ID = 'test-client';
  process.env.NAVER_CLIENT_SECRET = 'test-secret';
  t.after(() => {
    for (const [key, value] of [['NAVER_CLIENT_ID', old_id], ['NAVER_CLIENT_SECRET', old_secret]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(axios, 'post', async (_url, body) => {
    assert.equal(new URLSearchParams(body).get('code'), 'test-code');
    return { data: { access_token: 'test-token' } };
  });
  await withProfile(t, profile({ mobile: '01012345678' }), async () => {
    assert.equal((await processNaverLogin('test-code', 'test-state', 'https://app.example.test/callback')).phone, '010-1234-5678');
  });
});
