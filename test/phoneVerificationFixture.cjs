// Existing profile/storage integration suites use a fake external verifier, while
// challenge, proof signing, DB locks and profile transactions remain real.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-phone-fixture-'));
const key_file = path.join(dir, 'keys.json');
fs.writeFileSync(key_file, JSON.stringify({ current:'test', keys:{ test:crypto.randomBytes(32).toString('base64') } }), { mode:0o600 });
process.env.PHONE_VERIFICATION_HMAC_KEY_FILE = key_file;
process.env.PHONE_AUTH_FIREBASE_PROJECT_ID = 'profile-phone-test';
const { PhoneVerificationService } = require('../dist/services/phoneVerificationService');
const { User } = require('../dist/models');
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
async function issuePhoneProof(user_id, phone) {
  const user=await User.findByPk(user_id);
  const { normalizeKoreanMobile }=require('../dist/utils/phone');
  const mobile=normalizeKoreanMobile(phone);
  const service=new PhoneVerificationService({ async verify(){return {project_id:'profile-phone-test',uid:crypto.randomUUID(),auth_time:Math.floor(Date.now()/1000),phone_e164:mobile.e164};} });
  const session=await service.createChallenge(user_id,{phone,purpose:user.profile_completed_at?'PHONE_CHANGE':'SIGNUP'},crypto.randomUUID());
  return (await service.verify(user_id,session.challenge_id,'fake-token',crypto.randomUUID())).phone_verification_token;
}
module.exports={ issuePhoneProof };
