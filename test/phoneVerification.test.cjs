const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const secret_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-unit-'));
const key_path = path.join(secret_dir, 'keys.json');
fs.writeFileSync(key_path, JSON.stringify({ current: 'v1', keys: { v1: crypto.randomBytes(32).toString('base64') } }), { mode: 0o600 });
process.env.PHONE_VERIFICATION_HMAC_KEY_FILE = key_path;
process.env.PHONE_AUTH_FIREBASE_PROJECT_ID = 'phone-test-project';
const { FirebasePhoneTokenVerifier } = require('../dist/services/firebasePhoneTokenVerifier');
const { normalizeKoreanMobile, normalizeFirebasePhone } = require('../dist/utils/phone');
const { phoneDigest, validatePhoneVerificationEnvironment } = require('../dist/config/phoneVerification');
const { parseIdempotencyKey } = require('../dist/services/phoneVerificationService');
test.after(() => fs.rmSync(secret_dir, { recursive: true, force: true }));
function claims(patch = {}) { const now = Math.floor(Date.now()/1000); return { aud: 'phone-test-project', iss: 'https://securetoken.google.com/phone-test-project', sub: 'phone-uid', uid: 'phone-uid', auth_time: now, iat: now, exp: now+3600, phone_number: '+821012345678', firebase: { sign_in_provider: 'phone' }, ...patch }; }
test('국내 번호 변환은 +8210과 기존 하이픈을 대조하고 +82010/해외/prefix를 거절한다', () => {
  assert.deepEqual(normalizeKoreanMobile('01012345678'), { phone:'010-1234-5678', digits:'01012345678', e164:'+821012345678' });
  assert.equal(normalizeFirebasePhone('+821012345678').phone, '010-1234-5678');
  for (const value of ['+8201012345678','+12025550123','010-123-45678',null,'0212345678','01212345678','010 1234 5678','']) assert.equal(normalizeFirebasePhone(value), null);
  for (const value of ['0212345678','01212345678',null,'+821012345678']) assert.equal(normalizeKoreanMobile(value), null);
});
test('Admin 검증은 checkRevoked=true를 전달하며 phone provider/project/claims를 검증한다', async () => {
  let calls = 0;
  const verifier = new FirebasePhoneTokenVerifier({ async verifyIdToken(token, revoked) { calls++; assert.equal(token,'fake-token'); assert.equal(revoked,true); return claims(); } });
  const identity = await verifier.verify('fake-token');
  assert.equal(calls,1); assert.equal(identity.phone_e164,'+821012345678');
  for (const patch of [{aud:'other-project'},{iss:'https://securetoken.google.com/other-project'},{firebase:{sign_in_provider:'google.com'}},{firebase:{sign_in_provider:'anonymous'}},{firebase:{sign_in_provider:'phone',tenant:'other'}},{uid:''},{sub:'wrong'},{phone_number:'+8201012345678'},{auth_time:Math.floor(Date.now()/1000)+60},{auth_time:1.5},{exp:1},{iat:Math.floor(Date.now()/1000)+60}]) {
    const invalid = new FirebasePhoneTokenVerifier({ async verifyIdToken() { return claims(patch); } });
    await assert.rejects(invalid.verify('fake-token'), e=>e.status_code===400 && e.code==='PHONE_FIREBASE_TOKEN_INVALID');
  }
});
test('Firebase 토큰 실패는 앱 JWT401로 변환하지 않으며 인증 의존성 장애는503이다', async () => {
  for (const code of ['auth/argument-error','auth/id-token-expired','auth/id-token-revoked','auth/user-disabled','auth/user-not-found','auth/invalid-id-token','auth/internal-error','auth/insufficient-permission','app/network-error']) {
    const verifier = new FirebasePhoneTokenVerifier({ async verifyIdToken() { throw Object.assign(new Error(code==='auth/argument-error'?'Firebase ID token has invalid signature.':'private credentials must not leak'),{code}); } });
    await assert.rejects(verifier.verify('bad-token'), e=>e.status_code===(['auth/internal-error','auth/insufficient-permission','app/network-error'].includes(code)?503:400) && !e.message.includes('private'));
  }
});
test('실제 Admin SDK의 RSA 서명·프로젝트·만료 검증과 cert fetch 장애503을 확인한다', async () => {
  const { initializeApp, deleteApp }=require('firebase-admin/app');
  const { getAuth }=require('firebase-admin/auth');
  const jwt=require('jsonwebtoken');
  const app=initializeApp({projectId:'phone-test-project'},'phone-rsa-unit');
  const auth=getAuth(app);
  const { publicKey, privateKey }=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const other_key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  // Substitute only external certificate/Auth lookup I/O. Actual SDK JWT crypto runs.
  auth.idTokenVerifier.signatureVerifier.keyFetcher.fetchPublicKeys=async()=>({local:publicKey.export({type:'spki',format:'pem'})});
  auth.getUser=async()=>({disabled:false,tokensValidAfterTime:new Date(0).toUTCString()});
  const verifier=new FirebasePhoneTokenVerifier(auth);
  function signed(patch={},key=privateKey){const {uid,...payload}=claims(patch);return jwt.sign(payload,key,{algorithm:'RS256',keyid:'local'});}
  try {
    assert.equal((await verifier.verify(signed())).uid,'phone-uid');
    for(const token of [signed({},other_key),signed({aud:'other-project'}),signed({iss:'wrong-issuer'}),signed({exp:1})]) await assert.rejects(verifier.verify(token),e=>e.status_code===400);
    auth.idTokenVerifier.signatureVerifier.keyFetcher.fetchPublicKeys=async()=>{throw new Error('CERT_NETWORK_UNAVAILABLE');};
    await assert.rejects(verifier.verify(signed()),e=>e.status_code===503 && e.code==='PHONE_VERIFICATION_UNAVAILABLE');
  } finally {await deleteApp(app);}
});
test('서버 secret은 용도별 HMAC을 분리하고 API emulator/잘못된 설정을 거절한다', () => {
  assert.notEqual(phoneDigest('proof','same'),phoneDigest('firebase-event','same'));
  assert.doesNotThrow(()=>validatePhoneVerificationEnvironment());
  process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
  assert.throws(()=>validatePhoneVerificationEnvironment(), /Emulator/);
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  process.env.PHONE_FIREBASE_AUTH_CLOCK_SKEW_SECONDS='6';
  assert.throws(()=>validatePhoneVerificationEnvironment(), /TIME_LIMIT/);
  delete process.env.PHONE_FIREBASE_AUTH_CLOCK_SKEW_SECONDS;
  assert.equal(parseIdempotencyKey(crypto.randomUUID()).length,36);
  for (const value of [null,'','bad',[]]) assert.throws(()=>parseIdempotencyKey(value));
});

test('기존 challenge key 복구는 취소·만료·소비·현재 목적·번호 중복을 재검사한다', async () => {
  const { sequelize }=require('../dist/config/database');
  const { User, PhoneVerification }=require('../dist/models');
  const { PhoneVerificationService }=require('../dist/services/phoneVerificationService');
  const original={transaction:sequelize.transaction,user:User.findByPk,owner:User.findOne,challenge:PhoneVerification.findOne};
  const user_id=crypto.randomUUID(),request_key=crypto.randomUUID(),now=Date.now();
  const session={challenge_id:crypto.randomUUID(),user_id,purpose:'SIGNUP',phone:'010-1234-5678',phone_e164:'+821012345678',generation:'1',created_at:new Date(now-1000),expires_at:new Date(now+600000),cancelled_at:null,verified_at:null,consumed_at:null,fingerprint_key_version:'v1',challenge_fingerprint:phoneDigest('challenge-request',['+821012345678','SIGNUP'],'v1')};
  let current_user={user_id,account_status:'ACTIVE',profile_completed_at:null},existing=session,owner=null;
  const transaction={LOCK:{UPDATE:'UPDATE'}};
  sequelize.transaction=async callback=>callback(transaction);User.findByPk=async()=>current_user;User.findOne=async()=>owner;PhoneVerification.findOne=async()=>existing;
  const service=new PhoneVerificationService({async verify(){throw new Error('Firebase must not be called');}});
  const retry=()=>service.createChallenge(user_id,{phone:'01012345678',purpose:'SIGNUP'},request_key);
  try {
    const restored=await retry();assert.equal(restored.challenge_id,session.challenge_id);assert.equal(restored.expires_at,session.expires_at.toISOString());
    for(const [patch,code,status]of [[{cancelled_at:new Date()},'PHONE_VERIFICATION_INVALID',400],[{expires_at:new Date(now-1)},'PHONE_CHALLENGE_EXPIRED',410],[{consumed_at:new Date()},'PHONE_VERIFICATION_USED',409],[{verified_at:new Date(now-1000),proof_expires_at:new Date(now-1)},'PHONE_VERIFICATION_EXPIRED',410]]) {
      existing={...session,...patch};await assert.rejects(retry(),error=>error.code===code&&error.status_code===status);
    }
    existing=session;current_user={...current_user,profile_completed_at:new Date()};await assert.rejects(retry(),error=>error.code==='PHONE_VERIFICATION_PURPOSE_INVALID');
    current_user={...current_user,profile_completed_at:null};owner={user_id:crypto.randomUUID()};await assert.rejects(retry(),error=>error.code==='PHONE_ALREADY_EXISTS');
  } finally {sequelize.transaction=original.transaction;User.findByPk=original.user;User.findOne=original.owner;PhoneVerification.findOne=original.challenge;}
});
