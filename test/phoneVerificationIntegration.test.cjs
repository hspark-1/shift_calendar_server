const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const enabled = process.env.RUN_PHONE_INTEGRATION === 'true';
const isolated = process.env.DB_HOST==='127.0.0.1' && process.env.DB_PORT==='55434' && process.env.DB_NAME==='shift_calendar_phone_test' && process.env.DB_USER==='phone_test' && process.env.PHONE_INTEGRATION_ALLOW_SCHEMA_RESET==='true';
if (!enabled) test('번호 인증 통합은 전용 PostgreSQL에서 명시적으로 활성화한다', { skip:true },()=>{});
else if (!isolated) test('공유/운영 DB 초기화 거절',()=>assert.fail('고정 전용 PostgreSQL 연결과 reset 허용 필요'));
else {
  const secret_dir = fs.mkdtempSync(path.join(os.tmpdir(),'phone-integration-'));
  const key1 = crypto.randomBytes(32).toString('base64'), key2 = crypto.randomBytes(32).toString('base64');
  function configureKeys(current, keys) { const file=path.join(secret_dir,crypto.randomUUID()+'.json'); fs.writeFileSync(file,JSON.stringify({current,keys}),{mode:0o600}); process.env.PHONE_VERIFICATION_HMAC_KEY_FILE=file; }
  configureKeys('v1',{v1:key1});
  Object.assign(process.env,{NODE_ENV:'test', JWT_SECRET:'phone-test-access',JWT_REFRESH_SECRET:'phone-test-refresh',PHONE_AUTH_FIREBASE_PROJECT_ID:'phone-test-project',AUTH_RATE_LIMIT_MAX:'10000',PROFILE_IMAGE_STORAGE_BUCKET:'phone-test',PROFILE_IMAGE_STORAGE_REGION:'ap-northeast-2',PROFILE_IMAGE_STORAGE_PREFIX:'test',PROFILE_IMAGE_API_BASE_URL:'https://api.example.test', API_DOCS_ENABLED:'true',WORK_SHIFT_CACHE_ENABLED:'false',PUSH_JOB_ENQUEUE_ENABLED:'false'});
  const jwt = require('jsonwebtoken');
  const { sequelize }=require('../dist/config/database');
  const { User,PhoneVerification,ProfileMutationReceipt }=require('../dist/models');
  const phone_module=require('../dist/services/phoneVerificationService');
  const { PhoneVerificationService,cleanupPhoneVerificationData,enforcePhoneRateLimit }=phone_module;
  const { firebasePhoneTokenVerifier }=require('../dist/services/firebasePhoneTokenVerifier');
  const { mutateProfile }=require('../dist/services/profileMutationService');
  const { setProfileImageStorageClientForTest }=require('../dist/services/profileImageStorageService');
  const { detectProfileImage }=require('../dist/middlewares/profileImageUpload');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const image=detectProfileImage(png);
  const tokens=new Map();
  const verifier={async verify(token) { if(!tokens.has(token)) throw new Error('upstream private token'); return tokens.get(token); }};
  const service=new PhoneVerificationService(verifier);
  const original_verify=firebasePhoneTokenVerifier.verify;
  firebasePhoneTokenVerifier.verify=verifier.verify;
  let server,base_url,phone_index=10000000, uploads=0,deletes=0,fail_upload=false;
  const key=()=>crypto.randomUUID();
  const newPhone=()=>`010${phone_index++}`;
  const sql=file=>fs.readFileSync(file,'utf8').replace(/^\\set .*$/gm,'');
  async function user(extra={}) { return User.create({email:`${key()}@example.test`,name:'원래 이름',timezone:'Asia/Seoul',...extra}); }
  function identity(phone, extra={}) { return {project_id:'phone-test-project',uid:key(),auth_time:Math.floor(Date.now()/1000),phone_e164:`+82${phone.replace(/-/g,'').slice(1)}`,...extra}; }
  function addToken(value) { const token=key();tokens.set(token,value);return token; }
  async function challenge(current,phone=newPhone(),purpose=current.profile_completed_at?'PHONE_CHANGE':'SIGNUP',request_key=key()) { return service.createChallenge(current.user_id,{phone,purpose},request_key); }
  async function proof(current,phone=newPhone(),extra={}) { const session=await challenge(current,phone);const value=identity(phone,extra); const token=addToken(value);return {session,value,token,...await service.verify(current.user_id,session.challenge_id,token,key())}; }
  const fields=(phone,token)=>({name:' 새 이름 ',timezone:'Asia/Seoul',phone,phone_verification_token:token});
  async function save(current,verified,request_key=key(),extra={},with_image=false) { return mutateProfile(current.user_id,{...fields(verified.phone,verified.phone_verification_token),...extra},with_image?image:undefined,!current.profile_completed_at,undefined,request_key); }
  async function request(current,route,body,request_key=key(),method='POST') {
    const headers={};if(current)headers.Authorization=`Bearer ${jwt.sign({user_id:current.user_id},process.env.JWT_SECRET,{expiresIn:'5m'})}`;
    if(request_key)headers['Idempotency-Key']=request_key;
    const multipart=body instanceof FormData;if(body&&!multipart)headers['Content-Type']='application/json';
    const response=await fetch(base_url+'/api/v1'+route,{method,headers,body:body?(multipart?body:JSON.stringify(body)):undefined});
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  test.before(async()=>{
    await sequelize.authenticate();
    await sequelize.query(sql('migrations/final_schema.sql'));
    await sequelize.query(sql('migrations/add_phone_verification.sql'));
    setProfileImageStorageClientForTest({async send(command) {if(command.constructor.name==='PutObjectCommand'){uploads++;if(fail_upload)throw new Error('storage');}else if(command.constructor.name==='DeleteObjectCommand')deletes++;return {};}});
    const {app}=require('../dist/index'); server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});base_url=`http://127.0.0.1:${server.address().port}`;
  });
  test.after(async()=>{firebasePhoneTokenVerifier.verify=original_verify;setProfileImageStorageClientForTest(null);if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await sequelize.close();fs.rmSync(secret_dir,{recursive:true,force:true});});

  test('additive migration은 기존 번호/완료 회원의 인증 시각을 backfill하지 않는다',async()=>{
    const current=await user({phone:'010-9999-0000',profile_completed_at:new Date()});
    await sequelize.query(sql('migrations/add_phone_verification.sql'));await current.reload();assert.equal(current.phone_verified_at,null);assert.equal(current.phone,'010-9999-0000');
  });
  test('challenge는 멱등 재시도 기한 보존·다른 본문409·최신 세션 교체를 보장한다',async()=>{
    const current=await user(),phone=newPhone(),request_key=key();const first=await challenge(current,phone,'SIGNUP',request_key);
    const retry=await challenge(current,phone,'SIGNUP',request_key);assert.equal(first.challenge_id,retry.challenge_id);assert.equal(first.expires_at,retry.expires_at);
    await assert.rejects(challenge(current,newPhone(),'SIGNUP',request_key),e=>e.code==='IDEMPOTENCY_KEY_REUSED');
    await assert.rejects(challenge(current,phone,'PHONE_CHANGE'),e=>e.code==='PHONE_VERIFICATION_PURPOSE_INVALID');
    const next=await challenge(current);assert.notEqual(next.challenge_id,first.challenge_id);
    await assert.rejects(service.verify(current.user_id,first.challenge_id,addToken(identity(phone)),key()),e=>e.code==='PHONE_VERIFICATION_INVALID');
  });
  test('verify는 User를 변경하지 않고 refresh 문자열에도 동일 proof/기한을 복구한다',async()=>{
    const current=await user(),phone=newPhone(),session=await challenge(current,phone),value=identity(phone),request_key=key();
    const first=await service.verify(current.user_id,session.challenge_id,addToken(value),request_key);
    const retry=await service.verify(current.user_id,session.challenge_id,addToken(value),request_key);
    assert.equal(first.phone_verification_token,retry.phone_verification_token);assert.equal(first.expires_at,retry.expires_at);
    await current.reload();assert.equal(current.phone,null);assert.equal(current.phone_verified_at,null);assert.equal(current.profile_completed_at,null);
    await assert.rejects(service.verify(current.user_id,session.challenge_id,addToken({...value,uid:key()}),request_key),e=>e.code==='IDEMPOTENCY_KEY_REUSED');
  });
  test('같은 Firebase 이벤트의 다른 계정/challenge 교환과 동시 경쟁은 단 한 건만 승인한다',async()=>{
    const a=await user(),b=await user(),phone=newPhone(),ca=await challenge(a,phone),cb=await challenge(b,phone),value=identity(phone);
    const result=await Promise.allSettled([service.verify(a.user_id,ca.challenge_id,addToken(value),key()),service.verify(b.user_id,cb.challenge_id,addToken(value),key())]);
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'PHONE_FIREBASE_AUTH_REUSED');
    const winner=result[0].status==='fulfilled'?a:b;const next=await challenge(winner,phone);
    await assert.rejects(service.verify(winner.user_id,next.challenge_id,addToken(value),key()),e=>e.code==='PHONE_FIREBASE_AUTH_REUSED');
  });
  test('번호/project/소유자 불일치·오래된 인증·challenge 이전 인증·만료를 거절한다',async()=>{
    const current=await user(),other=await user(),phone=newPhone(),session=await challenge(current,phone);
    for(const extra of [{phone_e164:'+821099999999'},{project_id:'other-project'}])await assert.rejects(service.verify(current.user_id,session.challenge_id,addToken(identity(phone,extra)),key()),e=>e.code==='PHONE_FIREBASE_TOKEN_INVALID');
    await assert.rejects(service.verify(other.user_id,session.challenge_id,addToken(identity(phone)),key()),e=>e.code==='PHONE_VERIFICATION_INVALID');
    for(const age of [10,301])await assert.rejects(service.verify(current.user_id,session.challenge_id,addToken(identity(phone,{auth_time:Math.floor(Date.now()/1000)-age})),key()),e=>e.code==='PHONE_FIREBASE_AUTH_TOO_OLD');
    await PhoneVerification.update({created_at:new Date(Date.now()-700000),expires_at:new Date(Date.now()-1000)},{where:{challenge_id:session.challenge_id}});
    await assert.rejects(service.verify(current.user_id,session.challenge_id,addToken(identity(phone)),key()),e=>e.code==='PHONE_CHALLENGE_EXPIRED');
  });
  test('Firebase 호출 중 새 challenge/탈퇴가 발생하면 잠금 재검사에서 승인하지 않는다',async()=>{
    for(const deletion of [false,true]) {
      const current=await user(),phone=newPhone(),session=await challenge(current,phone);
      const racing=new PhoneVerificationService({async verify(){if(deletion)await current.update({account_status:'DELETION_PENDING',deletion_requested_at:new Date()});else await challenge(current);return identity(phone);}});
      await assert.rejects(racing.verify(current.user_id,session.challenge_id,'race',key()),e=>e.code===(deletion?'ACCOUNT_DELETION_IN_PROGRESS':'PHONE_VERIFICATION_INVALID'));
    }
  });
  test('가입 OAuth 번호도 증명 필수이며 성공 저장은 phone/인증/완료/소비/영수증을 함께 commit한다',async()=>{
    const current=await user({phone:'010-1234-5678'});
    await assert.rejects(mutateProfile(current.user_id,fields('01012345678',undefined),undefined,true),e=>e.code==='PHONE_VERIFICATION_REQUIRED');
    const verified=await proof(current,'01012345678'),request_key=key();
    const saved=await save(current,verified,request_key);assert.equal(saved.phone,'010-1234-5678');assert.ok(saved.phone_verified_at);assert.ok(saved.profile_completed_at);
    const row=await PhoneVerification.findByPk(verified.session.challenge_id);assert.ok(row.consumed_at);assert.equal(await ProfileMutationReceipt.count({where:{user_id:current.user_id}}),1);
    const before=saved.profile_completed_at.toISOString();const retried=await save(current,verified,request_key);assert.equal(retried.profile_completed_at.toISOString(),before);
    await assert.rejects(save(current,verified,key()),e=>e.code==='PROFILE_ALREADY_COMPLETED');
    await assert.rejects(save(current,verified,request_key,{name:'다른 값'}),e=>e.code==='IDEMPOTENCY_KEY_REUSED');
  });
  test('기존 완료 회원은 타 필드/동일 번호 무증명 수정과 nullable 인증 시각을 유지한다',async()=>{
    const current=await user({phone:'010-8888-0000',profile_completed_at:new Date()});
    const saved=await mutateProfile(current.user_id,{phone:'01088880000',name:'편집'},undefined,false);assert.equal(saved.phone_verified_at,null);
    for(const phone of [null,'',' '])await assert.rejects(mutateProfile(current.user_id,{phone},undefined,false),e=>e.code==='INVALID_PHONE');
    await assert.rejects(mutateProfile(current.user_id,{phone:newPhone()},undefined,false),e=>e.code==='PHONE_VERIFICATION_REQUIRED');
    const verified=await proof(current);const changed=await save(current,verified);assert.ok(changed.phone_verified_at);
    await assert.rejects(save(changed,verified,key()),e=>e.code==='PHONE_VERIFICATION_USED');
    const preserved=await mutateProfile(current.user_id,{name:'다른 필드'},undefined,false);assert.equal(preserved.phone_verified_at.toISOString(),changed.phone_verified_at.toISOString());
  });
  test('proof 소유자/번호/목적·취소/만료/위조·key 누락은 저장 전체를 거절한다',async()=>{
    const current=await user(),verified=await proof(current),other=await user();
    await assert.rejects(save(other,verified),e=>e.code==='PHONE_VERIFICATION_INVALID');
    await assert.rejects(save(current,verified,key(),{phone:newPhone()}),e=>e.code==='PHONE_VERIFICATION_INVALID');
    await assert.rejects(save(current,verified,key(),{phone_verification_token:verified.phone_verification_token.slice(0,-1)+'x'}),e=>e.code==='PHONE_VERIFICATION_INVALID');
    await assert.rejects(mutateProfile(current.user_id,fields(verified.phone,verified.phone_verification_token),undefined,true),e=>e.code==='VALIDATION_ERROR');
    await PhoneVerification.update({verified_at:new Date(Date.now()-400000),proof_expires_at:new Date(Date.now()-1000)},{where:{challenge_id:verified.session.challenge_id}});
    await assert.rejects(save(current,verified),e=>e.code==='PHONE_VERIFICATION_EXPIRED');await current.reload();assert.equal(current.name,'원래 이름');assert.equal(current.phone,null);
    const newer=await proof(current);await challenge(current);await assert.rejects(save(current,newer),e=>e.code==='PHONE_VERIFICATION_INVALID');
  });
  test('DB 실패는 소비/영수증/사용자/사진을 rollback하고 같은 proof/key로 재시도한다',async()=>{
    const current=await user(),verified=await proof(current),request_key=key();const original=ProfileMutationReceipt.create;
    ProfileMutationReceipt.create=async()=>{throw new Error('receipt failure');};const before_delete=deletes;
    try {await assert.rejects(save(current,verified,request_key,{},true),/receipt failure/);}finally{ProfileMutationReceipt.create=original;}
    await current.reload();assert.equal(current.phone,null);assert.equal(current.profile_image_key,null);assert.equal((await PhoneVerification.findByPk(verified.session.challenge_id)).consumed_at,null);assert.ok(deletes>before_delete);
    const saved=await save(current,verified,request_key,{},true);assert.ok(saved.phone_verified_at);assert.ok(saved.profile_image_key);
    const before_upload=uploads;const retry=await save(current,verified,request_key,{},true);assert.equal(retry.profile_image_key,saved.profile_image_key);assert.equal(uploads,before_upload);
  });
  test('동시에 다른 계정이 같은 번호를 저장하면 unique409 패자는 살아 있는 proof를 보존한다',async()=>{
    const a=await user(),b=await user(),phone=newPhone(),pa=await proof(a,phone),pb=await proof(b,phone);
    const results=await Promise.allSettled([save(a,pa),save(b,pb)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PHONE_ALREADY_EXISTS');
    const loser=results[0].status==='rejected'?pa:pb;assert.equal((await PhoneVerification.findByPk(loser.session.challenge_id)).consumed_at,null);
  });
  test('HMAC 키 교체 뒤 이전 proof/영수증 복구와 인증 이벤트 재사용 차단을 유지한다',async()=>{
    configureKeys('v1',{v1:key1});const current=await user(),verified=await proof(current),request_key=key();
    configureKeys('v2',{v1:key1,v2:key2});
    const other=await user(),session=await challenge(other,verified.phone);await assert.rejects(service.verify(other.user_id,session.challenge_id,addToken(verified.value),key()),e=>e.code==='PHONE_FIREBASE_AUTH_REUSED');
    await save(current,verified,request_key);await save(current,verified,request_key);
    configureKeys('v1',{v1:key1});
  });
  test('분산 제한은 실제 DB 카운터로 병렬 요청을 제한하고 Redis flag와 독립이다',async()=>{
    const current=await user();process.env.PHONE_CHALLENGE_PER_USER_HOUR='2';
    try{const result=await Promise.allSettled(Array.from({length:5},()=>enforcePhoneRateLimit(current.user_id,'192.0.2.123','challenge')));assert.equal(result.filter(r=>r.status==='fulfilled').length,2);for(const rejected of result.filter(r=>r.status==='rejected'))assert.equal(rejected.reason.code,'PHONE_VERIFICATION_RATE_LIMITED');}finally{delete process.env.PHONE_CHALLENGE_PER_USER_HOUR;}
  });
  test('HTTP JSON/multipart 계약·Firebase 장애503·미완료 업무 차단·푸시 허용을 검증한다',async()=>{
    const current=await user();assert.equal((await request(null,'/auth/phone/challenges',{phone:newPhone(),purpose:'SIGNUP'})).status,401);
    assert.equal((await request(current,'/auth/phone/challenges',{phone:newPhone(),purpose:'SIGNUP'},null)).status,400);
    const created=await request(current,'/auth/phone/challenges',{phone:newPhone(),purpose:'SIGNUP'});assert.equal(created.status,200);assert.match(created.headers.get('cache-control'),/no-store/);
    const unavailable=await request(current,'/auth/phone/verify',{challenge_id:created.body.data.challenge_id,firebase_id_token:'private-invalid'});assert.equal(unavailable.status,503);assert.equal(unavailable.body.error.code,'PHONE_VERIFICATION_UNAVAILABLE');assert.ok(!JSON.stringify(unavailable.body).includes('private-invalid'));
    const blocked=await request(current,'/events',null,null,'GET');assert.equal(blocked.body.error.code,'PROFILE_SETUP_REQUIRED');
    const device=await request(current,'/devices/current',{installation_id:key(),platform:'IOS',push_permission_enabled:false,app_version:'1.0.0'},null,'PUT');assert.equal(device.status,200);
    const verified=await proof(current);const form=new FormData();for(const [name,value]of Object.entries(fields(verified.phone,verified.phone_verification_token)))form.set(name,value);form.set('profile_image',new Blob([png],{type:'image/png'}),'a.png');
    const request_key=key();const saved=await request(current,'/auth/profile/complete',form,request_key);assert.equal(saved.status,200);assert.ok(saved.body.data.phone_verified_at);assert.equal(saved.body.data.phone_verification_token,undefined);
    const before=uploads;assert.equal((await request(current,'/auth/profile/complete',form,request_key)).status,200);assert.equal(uploads,before);
  });
  test('만료 정리는24시간 이전 이벤트를 보존하고 탈퇴 cascade는 replay tombstone을 유지한다',async()=>{
    const current=await user(),verified=await proof(current);await save(current,verified);const before=(await sequelize.query('SELECT count(*)::int AS count FROM phone_verification_events'))[0][0].count;
    await current.destroy();assert.equal(await PhoneVerification.count({where:{user_id:current.user_id}}),0);assert.equal(await ProfileMutationReceipt.count({where:{user_id:current.user_id}}),0);await cleanupPhoneVerificationData();
    assert.equal((await sequelize.query('SELECT count(*)::int AS count FROM phone_verification_events'))[0][0].count,before);
    await sequelize.query("INSERT INTO phone_verification_events(event_hash,retained_until) VALUES (repeat('f',64),now()-interval '1 second') ON CONFLICT DO NOTHING");await cleanupPhoneVerificationData();assert.equal((await sequelize.query("SELECT count(*)::int AS count FROM phone_verification_events WHERE event_hash=repeat('f',64)"))[0][0].count,0);
  });
  test('세션 정리 후에도 사용자 generation은 증가하며 활성 proof 만료는 연장하지 않는다',async()=>{
    const current=await user(),first=await challenge(current);const first_row=await PhoneVerification.findByPk(first.challenge_id);
    await PhoneVerification.update({created_at:new Date(Date.now()-48*3600000),expires_at:new Date(Date.now()-47*3600000),retained_until:new Date(Date.now()-23*3600000)},{where:{challenge_id:first.challenge_id}});await cleanupPhoneVerificationData();assert.equal(await PhoneVerification.findByPk(first.challenge_id),null);
    const next=await challenge(current);assert.equal(BigInt((await PhoneVerification.findByPk(next.challenge_id)).generation),BigInt(first_row.generation)+1n);
    const verified=await proof(current);const row=await PhoneVerification.findByPk(verified.session.challenge_id);await row.update({verified_at:new Date(Date.now()-400000),proof_expires_at:new Date(Date.now()-1000)});
    await assert.rejects(service.verify(current.user_id,row.challenge_id,verified.token,row.verify_key),e=>e.code==='PHONE_VERIFICATION_EXPIRED');
  });
  test('HTTP 저장 시 증명 실패와 DB 제한 장애는 사진/필드를 변경하지 않고 우회 없이 거절한다',async()=>{
    const current=await user(),verified=await proof(current);const before=uploads;
    const form=new FormData();for(const [field,value]of Object.entries(fields(verified.phone,verified.phone_verification_token.slice(0,-1)+'x')))form.set(field,value);form.set('profile_image',new Blob([png],{type:'image/png'}),'a.png');
    const rejected=await request(current,'/auth/profile/complete',form);assert.equal(rejected.body.error.code,'PHONE_VERIFICATION_INVALID');await current.reload();assert.equal(current.name,'원래 이름');assert.equal(current.profile_image_key,null);assert.equal(current.phone_verified_at,null);assert.equal(uploads,before+1);
    const original=sequelize.query;sequelize.query=async function(sql,options){if(sql.includes('INSERT INTO phone_verification_rate_limits'))throw new Error('private db failure');return original.call(this,sql,options);};
    try{const failed=await request(current,'/auth/phone/challenges',{phone:newPhone(),purpose:'SIGNUP'});assert.equal(failed.status,503);assert.equal(failed.body.error.code,'PHONE_VERIFICATION_UNAVAILABLE');}finally{sequelize.query=original;}
  });
  test('HTTP verify 성공·JSON 저장·친구 검색의 인증 필드 비노출과 OpenAPI를 검증한다',async()=>{
    const current=await user(),phone=newPhone();const created=await request(current,'/auth/phone/challenges',{phone,purpose:'SIGNUP'});
    const verified=await request(current,'/auth/phone/verify',{challenge_id:created.body.data.challenge_id,firebase_id_token:addToken(identity(phone))});assert.equal(verified.status,200);
    const saved=await request(current,'/auth/profile/complete',fields(phone,verified.body.data.phone_verification_token));assert.equal(saved.status,200);assert.ok(saved.body.data.phone_verified_at);
    const viewer=await user({profile_completed_at:new Date()});const {searchUser}=require('../dist/services/friendService');const found=await searchUser(viewer.user_id,phone);assert.equal(found.user_id,current.user_id);for(const field of ['phone','phone_verified_at','phone_verification_token'])assert.equal(Object.hasOwn(found,field),false);
    const response=await fetch(base_url+'/api-docs/openapi.json');const spec=await response.json();assert.ok(spec.paths['/auth/phone/verify']);assert.ok(spec.components.schemas.OwnProfile.properties.phone_verified_at);
    const references=JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/([^/]+)\/([^"/]+)"/g);for(const [,group,name]of references)assert.ok(spec.components[group]?.[name],`${group}/${name}`);
  });
  test('rollback은 인증 데이터가 있으면 거절하고 비어 있는 사전 인수 DB의 신규 객체만 철회한다',async()=>{
    const rollback=sql('migrations/rollback_phone_verification.sql');
    // A script-managed transaction that fails must be rolled back on that same connection.
    const connection=await sequelize.connectionManager.getConnection({type:'write'});
    try{
      await assert.rejects(connection.query(rollback),/EXPLICIT_CONFIRMATION/);await connection.query('ROLLBACK');
      const confirmed=rollback.replace('BEGIN;',"BEGIN; SET LOCAL shiftmate.phone_rollback_confirmed = 'true';");
      await assert.rejects(connection.query(confirmed),/FORWARD_RECOVERY/);await connection.query('ROLLBACK');
      await connection.query('DELETE FROM users; DELETE FROM phone_verification_events;');
      await connection.query(confirmed);
      const columns=await connection.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('phone','profile_completed_at','phone_verified_at','phone_verification_generation')");assert.deepEqual(columns.rows.map(row=>row.column_name).sort(),['phone','profile_completed_at']);
      await connection.query(sql('migrations/add_phone_verification.sql'));
    }finally{await sequelize.connectionManager.releaseConnection(connection);}
  });
}
