const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const crypto = require('node:crypto');

const enabled = process.env.RUN_PRIVACY_INTEGRATION === 'true';
const isolated = process.env.PRIVACY_INTEGRATION_ALLOW_SCHEMA_RESET === 'true' &&
  process.env.DB_HOST === '127.0.0.1' && process.env.DB_PORT === '55432' &&
  process.env.DB_NAME === 'shift_calendar_group_debug' && process.env.DB_USER === 'group_debug';
if (!enabled) {
  test('privacy integration requires explicit isolated DB/MinIO opt-in', { skip: true }, () => {});
} else if (!isolated) {
  test('refuse non-isolated database', () => assert.fail('Isolated DB and schema reset opt-in required'));
} else {
  Object.assign(process.env, {
    NODE_ENV: 'test', ACCOUNT_DELETION_ENABLED: 'true', REDIS_URL: '',
    PROFILE_IMAGE_STORAGE_BUCKET: 'privacy-integration', PROFILE_IMAGE_STORAGE_REGION: 'us-east-1',
    PROFILE_IMAGE_STORAGE_PREFIX: 'test', PROFILE_IMAGE_STORAGE_ENDPOINT: 'http://127.0.0.1:55900',
    PROFILE_IMAGE_STORAGE_FORCE_PATH_STYLE: 'true', PROFILE_IMAGE_PUBLIC_BASE_URL: 'https://images.example.test',
    AWS_ACCESS_KEY_ID: 'privacy_test', AWS_SECRET_ACCESS_KEY: 'privacy_test_local_only',
    ACCOUNT_DELETION_MAX_ATTEMPTS: '12', ACCOUNT_DELETION_LEASE_SECONDS: '120',
  });
  const sdk = require('@aws-sdk/client-s3');
  const storage = new sdk.S3Client({ region: 'us-east-1', endpoint: 'http://127.0.0.1:55900', forcePathStyle: true });
  const bucket = 'privacy-integration';
  const { sequelize } = require('../dist/config/database');
  const { QueryTypes } = require('sequelize');
  const { User, AccountDeletionRequest, AccountDeletionProviderTask, UserDevice } = require('../dist/models');
  const { requestAccountDeletion, cleanupCompletedAccountDeletionRequests } = require('../dist/services/accountDeletionService');
  const { processAccountDeletionRequest, claimRequests } = require('../dist/workers/accountDeletionWorker');
  const { getAccountImageScope, purgeAccountImages } = require('../dist/services/accountDeletionImageService');
  const { getDeletionMonitor, retryDeletionRequest } = require('../dist/services/accountDeletionOperationsService');
  const { accountDeletionProviderService, AccountDeletionProviderError } = require('../dist/services/accountDeletionProviderService');
  const { cleanupUnboundDevices, upsertCurrentDevice } = require('../dist/services/deviceService');
  const { cleanupTerminalPushRecords } = require('../dist/workers/pushWorker');
  const { withAccountDataLock } = require('../dist/utils/accountDataLock');
  const { disconnectRedis } = require('../dist/config/redis');
  function readSql(file) { return fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.startsWith('\\')).join('\n'); }
  async function createUser(extra = {}) { return User.create({ email: `${crypto.randomUUID()}@example.test`, name: 'integration', ...extra }); }
  async function requestDeletion(user) { return requestAccountDeletion(user.user_id, Math.floor(Date.now() / 1000)); }
  async function put(key, text = 'image') { await storage.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: text })); }
  async function readRequest(receipt) { return AccountDeletionRequest.findByPk(receipt.deletion_request_id); }
  async function retry(request, reason = 'STORAGE_FIXED', overrides = {}) {
    return retryDeletionRequest({ deletion_request_id: request.deletion_request_id, expected_user_id: request.user_id,
      expected_status: request.status, expected_attempt_count: request.attempt_count, reason, actor: 'test_operator', ...overrides });
  }
  test.before(async () => {
    await sequelize.authenticate();
    const base = readSql('migrations/final_schema.sql').split('-- 개인정보 삭제 상태·운영 제어 (2026-10-18)')[0];
    await sequelize.query(base);
    await sequelize.query(readSql('migrations/privacy_deletion_preflight.sql'));
    await sequelize.query(readSql('migrations/add_privacy_deletion_controls.sql'));
    await sequelize.query(readSql('migrations/privacy_deletion_postflight.sql'));
    await sequelize.query(readSql('migrations/rollback_privacy_deletion_controls.sql'));
    await sequelize.query(readSql('migrations/privacy_deletion_preflight.sql'));
    await sequelize.query(readSql('migrations/add_privacy_deletion_controls.sql'));
    await sequelize.query(readSql('migrations/privacy_deletion_postflight.sql'));
    try { await storage.send(new sdk.CreateBucketCommand({ Bucket: bucket })); }
    catch (error) { if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error; }
    await storage.send(new sdk.PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify({ Version: '2012-10-17', Statement: [
      { Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] },
    ] }) }));
  });
  test.after(async () => { await disconnectRedis(); storage.destroy(); await sequelize.close(); });

  test('managed current/previous objects disappear; old URL 404; other owner survives; repeat safe', async () => {
    const user = await createUser();
    const other = await createUser();
    const scope = getAccountImageScope(user.user_id);
    const old_key = `${scope.prefix}old.png`;
    const new_key = `${scope.prefix}new.png`;
    const other_key = `${getAccountImageScope(other.user_id).prefix}keep.png`;
    await put(old_key); await put(new_key); await put(other_key);
    const old_url = `http://127.0.0.1:55900/${bucket}/${old_key}`;
    assert.equal((await fetch(old_url)).status, 200);
    await user.update({ profile_image_url: `https://images.example.test/${new_key}` });
    const receipt = await requestDeletion(user);
    assert.equal((await readRequest(receipt)).image_scope.prefix, scope.prefix);
    await processAccountDeletionRequest(receipt.deletion_request_id);
    assert.equal((await fetch(old_url)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:55900/${bucket}/${new_key}`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:55900/${bucket}/${other_key}`)).status, 200);
    const request = await readRequest(receipt);
    assert.equal(request.status, 'COMPLETED'); assert.equal(request.image_scope, null);
    assert.ok(request.images_purged_at); assert.equal(request.user_id, null);
    assert.equal(await User.findByPk(user.user_id), null);
    await processAccountDeletionRequest(receipt.deletion_request_id);
    await purgeAccountImages(user.user_id, scope);
  });

  test('no image/external URL and legacy queued request use only trusted namespace', async () => {
    for (const url of [null, 'http://169.254.169.254/never-fetch']) {
      const user = await createUser({ profile_image_url: url });
      const receipt = await requestDeletion(user);
      await AccountDeletionRequest.update({ image_scope: null }, { where: { deletion_request_id: receipt.deletion_request_id } });
      await processAccountDeletionRequest(receipt.deletion_request_id);
      assert.equal((await readRequest(receipt)).status, 'COMPLETED');
    }
    const user = await createUser(); const scope = getAccountImageScope(user.user_id);
    await assert.rejects(purgeAccountImages(user.user_id, { ...scope, prefix: 'test/profiles/' }), /STORAGE_CHANGED/);
    await assert.rejects(purgeAccountImages(user.user_id, { ...scope, bucket: 'other' }), /STORAGE_CHANGED/);
  });

  test('legacy DB-purged request still deletes captured namespace before completion', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    const key = `${getAccountImageScope(user.user_id).prefix}legacy.png`;
    await put(key);
    await user.destroy();
    await AccountDeletionRequest.update({ image_scope: null, db_purged_at: new Date(), status: 'CACHE_PURGE_PENDING' }, { where: { deletion_request_id: receipt.deletion_request_id } });
    await processAccountDeletionRequest(receipt.deletion_request_id);
    assert.equal((await readRequest(receipt)).status, 'COMPLETED');
    assert.equal((await fetch(`http://127.0.0.1:55900/${bucket}/${key}`)).status, 404);
  });

  test('storage unavailable keeps DB; restart retries after recovery', async () => {
    const http = require('node:http');
    let fail = true;
    const proxy = http.createServer((req, res) => {
      if (fail) { res.writeHead(503); res.end('<Error><Code>ServiceUnavailable</Code></Error>'); return; }
      const upstream = http.request(`http://127.0.0.1:55900${req.url}`, { method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(503); res.end(); });
      req.pipe(upstream);
    });
    await new Promise((resolve) => proxy.listen(55901, '127.0.0.1', resolve));
    process.env.PROFILE_IMAGE_STORAGE_ENDPOINT = 'http://127.0.0.1:55901';
    try {
      const user = await createUser(); const receipt = await requestDeletion(user);
      await processAccountDeletionRequest(receipt.deletion_request_id);
      const failed = await readRequest(receipt);
      assert.equal(failed.status, 'RETRY'); assert.equal(failed.images_purged_at, null);
      assert.equal(failed.db_purged_at, null); assert.ok(await User.findByPk(user.user_id));
      fail = false;
      await processAccountDeletionRequest(receipt.deletion_request_id);
      assert.equal((await readRequest(receipt)).status, 'COMPLETED');
    } finally {
      process.env.PROFILE_IMAGE_STORAGE_ENDPOINT = 'http://127.0.0.1:55900';
      await new Promise((resolve) => proxy.close(resolve));
    }
  });

  test('DB failure after image purge resumes from persisted checkpoint', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    await put(`${getAccountImageScope(user.user_id).prefix}image.png`);
    await sequelize.query(`CREATE FUNCTION privacy_test_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test block'; END $$;
      CREATE TRIGGER privacy_test_block BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION privacy_test_block_delete()`);
    try { await assert.rejects(processAccountDeletionRequest(receipt.deletion_request_id)); }
    finally { await sequelize.query('DROP TRIGGER privacy_test_block ON users; DROP FUNCTION privacy_test_block_delete()'); }
    const request = await readRequest(receipt);
    assert.ok(request.images_purged_at); assert.equal(request.db_purged_at, null); assert.equal(request.status, 'RETRY');
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', `
      const {sequelize}=require('./dist/config/database');
      require('./dist/workers/accountDeletionWorker').processAccountDeletionRequest('${receipt.deletion_request_id}')
        .catch(()=>{process.exitCode=1}).finally(()=>sequelize.close());
    `], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal((await readRequest(receipt)).status, 'COMPLETED');
  });

  test('Redis failure after DB commit preserves owner and resumes', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    process.env.REDIS_URL = 'redis://127.0.0.1:55999';
    try { await processAccountDeletionRequest(receipt.deletion_request_id); }
    finally { await disconnectRedis(); process.env.REDIS_URL = ''; }
    const request = await readRequest(receipt);
    assert.equal(request.status, 'CACHE_PURGE_PENDING'); assert.ok(request.db_purged_at);
    assert.equal(request.user_id, user.user_id); assert.equal(await User.findByPk(user.user_id), null);
    await processAccountDeletionRequest(receipt.deletion_request_id);
    assert.equal((await readRequest(receipt)).status, 'COMPLETED');
  });

  test('permanent/transient provider failure retains credentials; manual retry validates owner/state and audits', async () => {
    const original = accountDeletionProviderService.unlinkKakao;
    try {
      for (const retryable of [false, true]) {
        const user = await createUser({ kakao_id: crypto.randomUUID() }); const receipt = await requestDeletion(user);
        accountDeletionProviderService.unlinkKakao = async () => { throw new AccountDeletionProviderError('KAKAO_UNLINK_REJECTED', retryable); };
        await processAccountDeletionRequest(receipt.deletion_request_id);
        const request = await readRequest(receipt);
        assert.equal(request.status, retryable ? 'RETRY' : 'FAILED');
        assert.equal((await User.findByPk(user.user_id)).kakao_id, user.kakao_id);
        await assert.rejects(retry(request, 'PROVIDER_FIXED', { expected_user_id: crypto.randomUUID() }), /STATE_CONFLICT/);
        await retry(request, 'PROVIDER_FIXED');
        await assert.rejects(retry(request, 'PROVIDER_FIXED'), /STATE_CONFLICT/);
        assert.equal((await readRequest(receipt)).requested_at.getTime(), request.requested_at.getTime());
        accountDeletionProviderService.unlinkKakao = async () => {};
        await processAccountDeletionRequest(receipt.deletion_request_id);
        assert.equal((await readRequest(receipt)).status, 'COMPLETED');
        const [audit] = await sequelize.query('SELECT count(*)::int AS count FROM account_deletion_operator_actions WHERE deletion_request_id = :id', { replacements: { id: receipt.deletion_request_id }, type: QueryTypes.SELECT });
        assert.equal(audit.count, 1);
      }
    } finally { accountDeletionProviderService.unlinkKakao = original; }
  });

  test('attempt limit, overdue detection, missing/stale worker heartbeat', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    await AccountDeletionRequest.update({ attempt_count: 12, requested_at: new Date(Date.now() - 8 * 86400000) }, { where: { deletion_request_id: receipt.deletion_request_id } });
    await claimRequests();
    assert.equal((await readRequest(receipt)).status, 'FAILED');
    let monitor = await getDeletionMonitor();
    assert.ok(monitor.failed_count >= 1); assert.ok(monitor.overdue_count >= 1); assert.equal(monitor.worker_stale, true);
    await sequelize.query("INSERT INTO privacy_worker_heartbeats VALUES ('account-deletion', now()) ON CONFLICT(worker_name) DO UPDATE SET last_seen_at=now()");
    monitor = await getDeletionMonitor(); assert.equal(monitor.worker_stale, false);
    await sequelize.query("UPDATE privacy_worker_heartbeats SET last_seen_at=now()-interval '6 minutes'");
    assert.equal((await getDeletionMonitor()).worker_stale, true);
    await retry(await readRequest(receipt), 'WORKER_RECOVERED');
    await processAccountDeletionRequest(receipt.deletion_request_id);
    assert.equal((await readRequest(receipt)).status, 'COMPLETED');
  });

  test('account lock prevents worker overlap and late upload after deletion request', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    await withAccountDataLock(user.user_id, async () => {
      await assert.rejects(processAccountDeletionRequest(receipt.deletion_request_id), /ACCOUNT_DATA_BUSY/);
      const claimed = await claimRequests(); assert.ok(!claimed.some((row) => row.deletion_request_id === receipt.deletion_request_id));
    });
    const { completeProfile } = require('../dist/controllers/authController');
    let response;
    const res = { status() { return this; }, json(body) { response = body; return this; } };
    await completeProfile({ user, body: {}, validated_profile_image: { buffer: Buffer.from('image'), content_type: 'image/png', extension: 'png' } }, res);
    assert.equal(response.error.code, 'UNAUTHORIZED');
    await processAccountDeletionRequest(receipt.deletion_request_id);
    assert.equal((await readRequest(receipt)).status, 'COMPLETED');
  });

  test('versioned bucket purges old versions and delete markers', async () => {
    await storage.send(new sdk.PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    const user = await createUser(); const scope = getAccountImageScope(user.user_id); const key = `${scope.prefix}version.png`;
    await put(key, 'old'); await put(key, 'new'); await storage.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    const before = await storage.send(new sdk.ListObjectVersionsCommand({ Bucket: bucket, Prefix: scope.prefix }));
    assert.equal(before.Versions.length, 2); assert.equal(before.DeleteMarkers.length, 1);
    const receipt = await requestDeletion(user); await processAccountDeletionRequest(receipt.deletion_request_id);
    const after = await storage.send(new sdk.ListObjectVersionsCommand({ Bucket: bucket, Prefix: scope.prefix }));
    assert.equal(after.Versions?.length ?? 0, 0); assert.equal(after.DeleteMarkers?.length ?? 0, 0);
    await storage.send(new sdk.PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Suspended' } }));
  });

  test('30-day detached device cleanup protects recent/active and concurrent reconnect', async () => {
    const old = new Date(Date.now() - 31 * 86400000); const recent = new Date();
    const make = (extra = {}) => UserDevice.create({ installation_id: crypto.randomUUID(), platform: 'IOS', app_environment: 'PROD', user_id: null, provider_target: null, is_active: false, push_permission_enabled: false, disabled_at: old, updated_at: old, ...extra });
    const idle = await make(); const recent_device = await make({ disabled_at: recent, updated_at: recent });
    const user = await createUser(); const active = await make({ user_id: user.user_id, is_active: true, push_permission_enabled: true, provider_target: 'test-active' });
    const reconnecting = await make();
    const transaction = await sequelize.transaction();
    await reconnecting.update({ user_id: user.user_id, is_active: true, push_permission_enabled: true, provider_target: 'reconnected-test', updated_at: recent }, { transaction });
    const cleanup = cleanupUnboundDevices();
    await transaction.commit(); await cleanup;
    assert.equal(await UserDevice.findByPk(idle.device_id), null);
    for (const device of [recent_device, active, reconnecting]) assert.ok(await UserDevice.findByPk(device.device_id));
    await cleanupUnboundDevices();
  });

  test('device threshold, real upsert, and pending push reference protection', async () => {
    process.env.PUSH_APP_ENVIRONMENT = 'PROD';
    const user = await createUser();
    const old = new Date(Date.now() - 31 * 86400000);
    const make = () => UserDevice.create({ installation_id: crypto.randomUUID(), platform: 'IOS', app_environment: 'PROD', user_id: null, provider_target: null, is_active: false, disabled_at: old, updated_at: old });
    const boundary = await make(); const before_boundary = await make(); const rebound = await make(); const referenced = await make();
    await sequelize.query("UPDATE user_devices SET disabled_at=now()-interval '30 days', updated_at=now()-interval '30 days' WHERE device_id=:id", { replacements: { id: boundary.device_id } });
    await sequelize.query("UPDATE user_devices SET disabled_at=now()-interval '29 days' WHERE device_id=:id", { replacements: { id: before_boundary.device_id } });
    await upsertCurrentDevice(user.user_id, { installation_id: rebound.installation_id, platform: 'IOS', provider_target: 'rebound-token', push_permission_enabled: true, app_version: 'test' });
    const [notification] = await sequelize.query("INSERT INTO notifications(user_id, notification_type, title) VALUES (:user_id, 'TEST', 'test') RETURNING notification_id", { replacements: { user_id: user.user_id }, type: QueryTypes.SELECT });
    const [job] = await sequelize.query("INSERT INTO push_jobs(notification_id, receiver_user_id, title, expires_at) VALUES (:notification_id, :user_id, 'test', now()+interval '1 hour') RETURNING push_job_id", { replacements: { notification_id: notification.notification_id, user_id: user.user_id }, type: QueryTypes.SELECT });
    await sequelize.query("INSERT INTO push_deliveries(push_job_id, device_id) VALUES (:job_id, :device_id)", { replacements: { job_id: job.push_job_id, device_id: referenced.device_id } });
    await cleanupUnboundDevices();
    assert.equal(await UserDevice.findByPk(boundary.device_id), null);
    for (const device of [before_boundary, rebound, referenced]) assert.ok(await UserDevice.findByPk(device.device_id));
    await sequelize.query("UPDATE push_jobs SET status='FAILED', completed_at=now()-interval '31 days' WHERE push_job_id=:id", { replacements: { id: job.push_job_id } });
    await cleanupTerminalPushRecords(); await cleanupUnboundDevices();
    assert.equal(await UserDevice.findByPk(referenced.device_id), null);
    const [deliveries] = await sequelize.query('SELECT count(*)::int AS count FROM push_deliveries WHERE push_job_id=:id', { replacements: { id: job.push_job_id }, type: QueryTypes.SELECT });
    assert.equal(deliveries.count, 0);
  });

  test('completed retention cascades audit/provider tasks; pending/failed survive', async () => {
    const user = await createUser(); const receipt = await requestDeletion(user);
    await AccountDeletionRequest.update({ status: 'FAILED' }, { where: { deletion_request_id: receipt.deletion_request_id } });
    await retry(await readRequest(receipt)); await processAccountDeletionRequest(receipt.deletion_request_id);
    await AccountDeletionRequest.update({ completed_at: new Date(Date.now() - 31 * 86400000) }, { where: { deletion_request_id: receipt.deletion_request_id } });
    const pending_user = await createUser(); const pending = await requestDeletion(pending_user);
    await AccountDeletionRequest.update({ requested_at: new Date(Date.now() - 40 * 86400000) }, { where: { deletion_request_id: pending.deletion_request_id } });
    const failed_user = await createUser(); const failed = await requestDeletion(failed_user);
    await AccountDeletionRequest.update({ status: 'FAILED', requested_at: new Date(Date.now() - 40 * 86400000) }, { where: { deletion_request_id: failed.deletion_request_id } });
    const recent_user = await createUser(); const recent = await requestDeletion(recent_user);
    await processAccountDeletionRequest(recent.deletion_request_id);
    await AccountDeletionRequest.update({ completed_at: new Date(Date.now() - 29 * 86400000) }, { where: { deletion_request_id: recent.deletion_request_id } });
    await cleanupCompletedAccountDeletionRequests();
    assert.equal(await readRequest(receipt), null); assert.ok(await readRequest(pending));
    assert.ok(await readRequest(failed)); assert.ok(await readRequest(recent));
    const [audit] = await sequelize.query('SELECT count(*)::int AS count FROM account_deletion_operator_actions WHERE deletion_request_id = :id', { replacements: { id: receipt.deletion_request_id }, type: QueryTypes.SELECT });
    assert.equal(audit.count, 0);
    await cleanupTerminalPushRecords();
  });
}
