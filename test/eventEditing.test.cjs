const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Event, User } = require('../dist/models/index.js');
const { updateEvent } = require('../dist/services/calendarService.js');
const routes = require('../dist/routes/calendarRoutes.js').default;
const spec = require('../src/openapi/calendarOpenApi.json');
const owner_id = '00000000-0000-4000-8000-000000000001';
const event_id = '00000000-0000-4000-8000-000000000002';
const input = { title: '  편집  ', memo: null, place: '  서울  ', all_day: false,
  start_at: '2026-11-12T00:00:00.000Z', end_at: '2026-11-12T01:00:00.000Z', visibility_level: 3, is_private: true };
function row(values) { return { event_id, created_at: new Date('2026-01-01T00:00:00Z'), ...values }; }
test('수정은 소유자·활성 조건의 단일 UPDATE와 RETURNING으로 전체 DTO를 돌려준다', async () => {
  const original = Event.update; let call;
  Event.update = async (values, options) => { call = { values, options }; return [1, [row(values)]]; };
  try {
    const result = await updateEvent(owner_id, event_id, { ...input, owner_user_id: event_id, created_by_user_id: event_id });
    assert.deepEqual(call.options.where, { event_id, owner_user_id: owner_id, deleted_at: null });
    assert.equal(call.options.returning, true);
    assert.equal(call.values.title, '편집'); assert.equal(call.values.memo, null); assert.equal(call.values.place, '서울');
    assert.equal(call.values.is_private, true); assert.equal(result.visibility_level, 3);
    for (const forbidden of ['owner_user_id', 'created_by_user_id', 'created_at', 'deleted_at']) assert.equal(Object.hasOwn(call.values, forbidden), false);
    assert.ok(result.updated_at instanceof Date); assert.equal(result.event_id, event_id);
    assert.equal(result.created_at.toISOString(), '2026-01-01T00:00:00.000Z');
  } finally { Event.update = original; }
});
test('잘못된 타입·누락·시간은 DB 호출 전 거절하고 타인/삭제/없는 행은 404로 수렴한다', async () => {
  const original = Event.update; let calls = 0;
  Event.update = async () => { calls++; return [0, []]; };
  try {
    const invalid = [{ title: '  ' }, { all_day: 'false' }, { is_private: undefined }, { is_private: 'true' },
      { memo: undefined }, { place: 0 }, { visibility_level: '3' }, { visibility_level: 6 },
      { start_at: '2026-02-30T00:00:00.000Z' }, { end_at: input.start_at }, { start_at: '2026-11-12T09:00:00+09:00' }];
    for (const patch of invalid) await assert.rejects(updateEvent(owner_id, event_id, { ...input, ...patch }));
    await assert.rejects(updateEvent(owner_id, 'bad-id', input), /INVALID_EVENT_ID/);
    assert.equal(calls, 0);
    await assert.rejects(updateEvent(owner_id, event_id, input), /EVENT_NOT_FOUND/);
    assert.equal(calls, 1);
  } finally { Event.update = original; }
});
test('실제 HTTP route의 인증·필수 필드·엄격 타입·null 삭제·오류 wrapper와 OpenAPI 계약', async () => {
  process.env.JWT_SECRET = 'local-event-edit-test';
  const original_find = User.findByPk, original_update = Event.update;
  User.findByPk = async () => ({ user_id: owner_id, account_status: 'ACTIVE' });
  let mode = 'ok'; let calls = 0;
  Event.update = async values => { calls++; if(mode === 'missing') return [0, []]; if(mode === 'fail') throw new Error('private memo must not leak'); return [1,[row(values)]]; };
  const app = express(); app.use(express.json()); app.use('/api/v1', routes);
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base_url = `http://127.0.0.1:${server.address().port}/api/v1/events/`;
  const authorization = `Bearer ${jwt.sign({ user_id: owner_id }, process.env.JWT_SECRET)}`;
  async function put(body, id=event_id, auth=authorization) {
    const response = await fetch(base_url+id, {method:'PUT', headers:{'Content-Type':'application/json',Authorization:auth},body:JSON.stringify(body)});
    return { status:response.status, body:await response.json() };
  }
  try {
    assert.equal((await put(input, event_id, '')).status, 401);
    assert.equal((await put(input, 'bad-id')).body.error.code, 'INVALID_EVENT_ID');
    for (const field of Object.keys(input)) { const body = {...input}; delete body[field]; assert.equal((await put(body)).status,400,field); }
    for (const patch of [{all_day:'false'},{is_private:'true'},{visibility_level:'3'},{memo:[]},{place:{}},{end_at:input.start_at}]) assert.equal((await put({...input,...patch})).status,400);
    assert.equal(calls,0);
    const success=await put({...input, memo:'', place:null});
    assert.equal(success.status,200); assert.equal(success.body.data.memo,null); assert.equal(success.body.data.place,null); assert.equal(success.body.data.is_private,true);
    mode='missing'; assert.equal((await put(input)).status,404);
    mode='fail'; const failed=await put(input); assert.equal(failed.status,500); assert.ok(!JSON.stringify(failed).includes('private memo'));
    assert.deepEqual(new Set(spec.components.schemas.UpdateEventInput.required),new Set(Object.keys(input)));
    for (const status of ['200','400','401','404','500']) assert.ok(spec.paths['/events/{event_id}'].put.responses[status]);
  } finally { await new Promise(resolve => server.close(resolve)); User.findByPk=original_find; Event.update=original_update; }
});
