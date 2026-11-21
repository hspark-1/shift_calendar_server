const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const enabled=process.env.RUN_PHONE_EMULATOR_INTEGRATION==='true';
const isolated=process.env.DB_HOST==='127.0.0.1' && process.env.DB_PORT==='55434' && process.env.DB_NAME==='shift_calendar_phone_test' && process.env.DB_USER==='phone_test' && process.env.PHONE_INTEGRATION_ALLOW_SCHEMA_RESET==='true' && process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:59099';
if(!enabled)test('Auth Emulator + PostgreSQL 검증은 명시적으로 활성화한다',{skip:true},()=>{});
else if(!isolated)test('외부 Firebase/DB 연결 거절',()=>assert.fail('고정 격리 환경 필요'));
else{
  const project_id='demo-shiftmate-phone';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone-emulator-keys-'));
  const key_file=path.join(dir,'keys.json');fs.writeFileSync(key_file,JSON.stringify({current:'v1',keys:{v1:crypto.randomBytes(32).toString('base64')}}),{mode:0o600});
  Object.assign(process.env,{PHONE_AUTH_FIREBASE_PROJECT_ID:project_id,PHONE_VERIFICATION_HMAC_KEY_FILE:key_file});
  const {initializeApp,deleteApp}=require('firebase-admin/app');
  const {getAuth}=require('firebase-admin/auth');
  const firebase_app=initializeApp({projectId:project_id},'isolated-phone-emulator');
  const admin_auth=getAuth(firebase_app);
  const {FirebasePhoneTokenVerifier}=require('../dist/services/firebasePhoneTokenVerifier');
  // Constructor injection is test-local; production initialize always rejects emulator env.
  const verifier=new FirebasePhoneTokenVerifier(admin_auth);
  const {PhoneVerificationService}=require('../dist/services/phoneVerificationService');
  const service=new PhoneVerificationService(verifier);
  const {sequelize}=require('../dist/config/database');
  const {User}=require('../dist/models');
  const {mutateProfile}=require('../dist/services/profileMutationService');
  async function api(pathname,body){const response=await fetch('http://127.0.0.1:59099'+pathname,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data.error));return data;}
  async function phoneLogin(phone){const sent=await api('/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=fake-api-key',{phoneNumber:phone,recaptchaToken:'test'});const codes=await api(`/emulator/v1/projects/${project_id}/verificationCodes`);const code=codes.verificationCodes.find(item=>item.sessionInfo===sent.sessionInfo).code;return api('/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=fake-api-key',{sessionInfo:sent.sessionInfo,code});}
  test.before(async()=>{await sequelize.authenticate();await sequelize.query(fs.readFileSync('migrations/final_schema.sql','utf8').replace(/^\\set .*$/gm,''));});
  test.after(async()=>{await deleteApp(firebase_app);await sequelize.close();fs.rmSync(dir,{recursive:true,force:true});});
  test('공식 Auth Emulator 발급 토큰 → 실제 Admin 폐기 검증 → DB 증명 → 프로필 commit',async()=>{
    const user=await User.create({email:'emulator@example.test',name:'가입'});const session=await service.createChallenge(user.user_id,{phone:'01012345678',purpose:'SIGNUP'},crypto.randomUUID());
    const login=await phoneLogin('+821012345678');const verified=await service.verify(user.user_id,session.challenge_id,login.idToken,crypto.randomUUID());
    const saved=await mutateProfile(user.user_id,{name:'완료',timezone:'Asia/Seoul',phone:'01012345678',phone_verification_token:verified.phone_verification_token},undefined,true,undefined,crypto.randomUUID());
    assert.equal(saved.phone,'010-1234-5678');assert.ok(saved.phone_verified_at);assert.ok(saved.profile_completed_at);
    const refreshed=await api('/securetoken.googleapis.com/v1/token?key=fake-api-key',{grantType:'refresh_token',refreshToken:login.refreshToken});
    const first=await verifier.verify(login.idToken);const second=await verifier.verify(refreshed.id_token);assert.equal(first.uid,second.uid);assert.equal(first.auth_time,second.auth_time);
    await admin_auth.updateUser(login.localId,{disabled:true});await assert.rejects(verifier.verify(login.idToken),e=>e.status_code===400 && e.code==='PHONE_FIREBASE_TOKEN_INVALID');
  });
  test('다른 프로젝트·Google provider·만료·서명 형식 불일치는 실제 Admin 경계에서 거절한다',async()=>{
    const login=await phoneLogin('+821012345679');
    const parts=login.idToken.split('.');const original=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    // Emulator accepts unsigned JWT by design; claims still require correct project/provider/expiry.
    for(const patch of [{aud:'different-project'},{iss:'https://securetoken.google.com/different-project'},{firebase:{sign_in_provider:'google.com'}},{exp:1}]){
      const changed=[parts[0],Buffer.from(JSON.stringify({...original,...patch})).toString('base64url'),parts[2]].join('.');
      await assert.rejects(verifier.verify(changed),e=>e.status_code===400);
    }
    await assert.rejects(verifier.verify('not-a-jwt'),e=>e.status_code===400);
  });
}
