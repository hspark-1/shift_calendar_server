const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
const deployment_files = [
  "deploy/compose.production.yaml",
  "deploy/compose.stage.yaml",
  "deploy/config/feature-flags.production.env",
  "deploy/config/feature-flags.stage.env",
  "deploy/shiftmate-deploy",
  "deploy/shiftmate-deploy-launcher",
  "deploy/shiftmate-bootstrap",
  "deploy/stage.deploy.env.example",
  "deploy/sudoers/github-runner-shiftmate",
  ".github/workflows/validate-main.yml",
  ".github/workflows/deploy-production.yml",
  ".github/workflows/rollback-production.yml",
];
const present_deployment_files = deployment_files.filter((relative_path) =>
  fs.existsSync(path.join(repository_root, relative_path)),
);

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

if (present_deployment_files.length === 0) {
  test.skip("배포 정적 테스트: 별도 배포 저장소로 이동한 파일이 현재 저장소에 없어 건너뜀", () => {});
} else {
  test("배포 정적 테스트 파일은 전부 존재하거나 전부 별도 저장소에 있어야 한다", () => {
    assert.deepEqual(present_deployment_files, deployment_files);
  });

  test("Center Compose는 공유 Redis와 색상별 세 worker를 외부 포트 없이 정의한다", () => {
    const compose = readRepositoryFile("deploy/compose.production.yaml");
    assert.match(compose, /^  shiftmate_cache:/m);
    assert.match(compose, /^  shiftmate_blue_cache_worker:/m);
    assert.match(compose, /^  shiftmate_green_cache_worker:/m);
    assert.match(compose, /^  shiftmate_blue_push_worker:/m);
    assert.match(compose, /^  shiftmate_green_push_worker:/m);
    assert.match(compose, /^  shiftmate_blue_account_deletion_worker:/m);
    assert.match(compose, /^  shiftmate_green_account_deletion_worker:/m);
    assert.match(compose, /redis-server --save '' --appendonly no/);
    assert.match(compose, /--requirepass "\$\$REDIS_PASSWORD"/);
    assert.match(
      compose,
      /node", "dist\/workers\/workShiftCacheWorker\.js", "--healthcheck/,
    );
    assert.match(
      compose,
      /node", "dist\/workers\/pushWorker\.js", "--healthcheck/,
    );
    assert.match(
      compose,
      /node", "dist\/workers\/accountDeletionWorker\.js", "--healthcheck/,
    );
    assert.match(compose, /DB_POOL_MAX: "2"/);
    assert.match(compose, /source: firebase_service_account/);
    assert.match(
      compose,
      /x-account-deletion-worker-common:[\s\S]*source: apple_signin_private_key/,
    );
    assert.match(compose, /file: \.\/secrets\/firebase\.json/);
    assert.match(compose, /env_file:\n\s+- \.env\n\s+- feature-flags\.env/);
    assert.doesNotMatch(compose, /FIREBASE_SERVICE_ACCOUNT_FILE|\/dev\/null/);

    const redis_block = compose.slice(
      compose.indexOf("  shiftmate_cache:"),
      compose.indexOf("  shiftmate_blue_api_1:"),
    );
    assert.doesNotMatch(redis_block, /^    ports:/m);
  });

  test("Stage Compose는 API, Redis와 세 worker를 저장소 정본으로 정의한다", () => {
    const compose = readRepositoryFile("deploy/compose.stage.yaml");
    assert.match(compose, /^  shiftmate_stage_cache:/m);
    assert.match(compose, /^  shiftmate_stage_api:/m);
    assert.match(compose, /^  shiftmate_stage_cache_worker:/m);
    assert.match(compose, /^  shiftmate_stage_push_worker:/m);
    assert.match(compose, /^  shiftmate_stage_account_deletion_worker:/m);
    assert.match(compose, /"127\.0\.0\.1:3201:3000"/);
    assert.match(
      compose,
      /node", "dist\/workers\/workShiftCacheWorker\.js", "--healthcheck/,
    );
    assert.match(
      compose,
      /node", "dist\/workers\/pushWorker\.js", "--healthcheck/,
    );
    assert.match(
      compose,
      /node", "dist\/workers\/accountDeletionWorker\.js", "--healthcheck/,
    );
    assert.match(compose, /DB_POOL_MAX: "2"/);
    assert.match(compose, /source: firebase_service_account/);
    assert.match(
      compose,
      /shiftmate_stage_account_deletion_worker:[\s\S]*source: apple_signin_private_key/,
    );
    assert.match(compose, /file: \.\/secrets\/firebase\.json/);
    assert.match(
      compose,
      /name: shiftmate_stage_internal[\s\S]*external: true/,
    );
    assert.match(compose, /env_file:\n\s+- \.env\n\s+- feature-flags\.env/);

    const push_worker_block = compose.slice(
      compose.indexOf("  shiftmate_stage_push_worker:"),
      compose.indexOf("\nnetworks:"),
    );
    assert.doesNotMatch(push_worker_block, /^    ports:/m);
    const account_deletion_worker_block = compose.slice(
      compose.indexOf("  shiftmate_stage_account_deletion_worker:"),
      compose.indexOf("\nnetworks:"),
    );
    assert.doesNotMatch(account_deletion_worker_block, /^    ports:/m);
  });

  test("환경별 feature flag config는 동일한 6개 boolean key만 관리한다", () => {
    const expected_keys = [
      "WORK_SHIFT_CACHE_ENABLED",
      "PUSH_JOB_ENQUEUE_ENABLED",
      "PUSH_WORKER_ENABLED",
      "API_DOCS_ENABLED",
      "ACCOUNT_DELETION_ENABLED",
      "ACCOUNT_DELETION_WORKER_ENABLED",
    ];

    for (const relative_path of [
      "deploy/config/feature-flags.production.env",
      "deploy/config/feature-flags.stage.env",
    ]) {
      const entries = readRepositoryFile(relative_path)
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          assert.match(line, /^[A-Z0-9_]+=(true|false)$/);
          return line.split("=")[0];
        });
      assert.deepEqual(entries, expected_keys);
    }
  });

  test("Apple secret은 feature flag 없이 API와 탈퇴 worker에 mount되고 배포 전에 검증된다", () => {
    const center_base = readRepositoryFile("deploy/compose.production.yaml");
    const stage_base = readRepositoryFile("deploy/compose.stage.yaml");
    const script = readRepositoryFile("deploy/shiftmate-deploy");

    assert.match(center_base, /file: \.\/secrets\/apple_signin\.p8/);
    assert.match(stage_base, /file: \.\/secrets\/apple_signin\.p8/);
    assert.match(
      center_base,
      /x-api-common:[\s\S]*source: apple_signin_private_key/,
    );
    assert.match(
      stage_base,
      /shiftmate_stage_api:[\s\S]*source: apple_signin_private_key/,
    );
    assert.match(
      center_base,
      /x-account-deletion-worker-common:[\s\S]*source: apple_signin_private_key/,
    );
    assert.match(
      stage_base,
      /shiftmate_stage_account_deletion_worker:[\s\S]*source: apple_signin_private_key/,
    );
    assert.doesNotMatch(
      script,
      /readBooleanEnvironmentValue|APPLE_AUTH_ENABLED/,
    );
    assert.match(script, /validateAppleSecretConfiguration\(\)/);
    assert.match(script, /validateAppleSecretConfiguration Center/);
    assert.match(script, /validateAppleSecretConfiguration Stage/);
  });

  test("배포는 Redis, Stage API/worker, Center API/worker, Nginx 순서를 지킨다", () => {
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    assert.match(
      script,
      /http:\/\/127\.0\.0\.1:\$\{port\}\/api\/v1\/health\/ready/,
    );
    const center_redis = script.indexOf("compose up -d shiftmate_cache");
    const stage_redis = script.indexOf(
      'stage_compose up -d "$STAGE_REDIS_SERVICE"',
    );
    const stage_deploy = script.indexOf(
      "Deploying Stage API and workers",
      stage_redis,
    );
    const stage_apply = script.indexOf(
      '"$STAGE_SERVICE" "$STAGE_WORKER_SERVICE" "$STAGE_PUSH_WORKER_SERVICE"',
      stage_deploy,
    );
    const stage_cache_worker_health = script.indexOf(
      'wait_for_compose_health stage "$STAGE_WORKER_SERVICE"',
      stage_apply,
    );
    const stage_push_worker_health = script.indexOf(
      'wait_for_compose_health stage "$STAGE_PUSH_WORKER_SERVICE"',
      stage_cache_worker_health,
    );
    const stage_account_deletion_worker_health = script.indexOf(
      'wait_for_compose_health stage "$STAGE_ACCOUNT_DELETION_WORKER_SERVICE"',
      stage_push_worker_health,
    );
    const center_apply = script.indexOf(
      'compose up -d --no-deps --force-recreate "${target_services[@]}"',
    );
    const center_cache_worker_health = script.indexOf(
      'wait_for_compose_health center "$target_cache_worker"',
      center_apply,
    );
    const center_push_worker_health = script.indexOf(
      'wait_for_compose_health center "$target_push_worker"',
      center_cache_worker_health,
    );
    const center_account_deletion_worker_health = script.indexOf(
      'wait_for_compose_health center "$target_account_deletion_worker"',
      center_push_worker_health,
    );
    const nginx_switch = script.indexOf('render_upstream "$TARGET_COLOR"');

    assert.ok(center_redis >= 0);
    assert.ok(center_redis < stage_redis);
    assert.ok(stage_redis < stage_apply);
    assert.ok(stage_apply < stage_cache_worker_health);
    assert.ok(stage_cache_worker_health < stage_push_worker_health);
    assert.ok(stage_push_worker_health < stage_account_deletion_worker_health);
    assert.ok(stage_account_deletion_worker_health < center_apply);
    assert.ok(center_apply < center_cache_worker_health);
    assert.ok(center_cache_worker_health < center_push_worker_health);
    assert.ok(
      center_push_worker_health < center_account_deletion_worker_health,
    );
    assert.ok(center_account_deletion_worker_health < nginx_switch);
  });

  test("기존 Stage 장애는 진단을 남기되 새 이미지의 Stage 복구를 차단하지 않는다", () => {
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    const existing_stage_check = script.indexOf(
      'if ! checkHealthOnce "$STAGE_INTERNAL_HEALTH_PORT"; then',
    );
    const existing_stage_warning = script.indexOf(
      "WARNING: existing Stage readiness failed",
      existing_stage_check,
    );
    const existing_stage_diagnostics = script.indexOf(
      "printStageApiDiagnostics",
      existing_stage_warning,
    );
    const image_pull = script.indexOf('docker pull "$REQUESTED_IMAGE"');
    const stage_apply = script.indexOf("Deploying Stage API and workers");

    assert.ok(existing_stage_check >= 0);
    assert.ok(existing_stage_check < existing_stage_warning);
    assert.ok(existing_stage_warning < existing_stage_diagnostics);
    assert.ok(existing_stage_diagnostics < image_pull);
    assert.ok(image_pull < stage_apply);
    assert.doesNotMatch(script, /die "existing Stage health check failed/);
    assert.match(script, /stage_compose ps -a "\$STAGE_SERVICE"/);
    assert.match(script, /stage_compose logs --tail=200 "\$STAGE_SERVICE"/);
  });

  test("최초 Blue/Green 전환도 설정된 이미지와 readiness를 검증한다", () => {
    const script = readRepositoryFile("deploy/shiftmate-bootstrap");
    assert.match(script, /GREEN_IMAGE must be configured/);
    assert.match(script, /configured image: %s/);
    assert.match(
      script,
      /http:\/\/127\.0\.0\.1:\$\{port\}\/api\/v1\/health\/ready/,
    );
    assert.doesNotMatch(script, /current 1\.0\.2 image/);
  });

  test("배포 실패와 색상 전환은 기존 API와 세 worker만 복원·중지한다", () => {
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    assert.match(
      script,
      /printf 'shiftmate_%s_api_3\\n' "\$color"[\s\S]*printf 'shiftmate_%s_cache_worker\\n' "\$color"[\s\S]*printf 'shiftmate_%s_push_worker\\n' "\$color"[\s\S]*printf 'shiftmate_%s_account_deletion_worker\\n' "\$color"/,
    );
    assert.match(
      script,
      /mapfile -t failed_services < <\(services_for_color "\$TARGET_COLOR"\)[\s\S]*compose stop --timeout 15 "\$\{failed_services\[@\]\}"/,
    );
    assert.match(
      script,
      /grep -Fqx "  \$\{STAGE_PUSH_WORKER_SERVICE\}:" "\$STAGE_OVERRIDE_FILE"[\s\S]*STAGE_PUSH_WORKER_OVERRIDE_EXISTED=1/,
    );
    assert.match(
      script,
      /grep -Fqx "  \$\{STAGE_ACCOUNT_DELETION_WORKER_SERVICE\}:" "\$STAGE_OVERRIDE_FILE"[\s\S]*STAGE_ACCOUNT_DELETION_WORKER_OVERRIDE_EXISTED=1/,
    );
    assert.match(
      script,
      /stage_restore_services=\("\$STAGE_SERVICE" "\$STAGE_WORKER_SERVICE"\)[\s\S]*if \(\( STAGE_PUSH_WORKER_OVERRIDE_EXISTED == 1 \)\); then[\s\S]*stage_restore_services\+=\("\$STAGE_PUSH_WORKER_SERVICE"\)[\s\S]*stage_compose stop --timeout 15 "\$STAGE_PUSH_WORKER_SERVICE"[\s\S]*stage_compose rm -f "\$STAGE_PUSH_WORKER_SERVICE"/,
    );
    assert.match(
      script,
      /stage_compose up -d --no-deps --force-recreate[\s\\]*"\$\{stage_restore_services\[@\]\}"/,
    );
    assert.match(
      script,
      /mapfile -t old_services < <\(services_for_color "\$OLD_COLOR"\)[\s\S]*compose stop --timeout 15 "\$\{old_services\[@\]\}"/,
    );
  });

  test("Stage 배포 설정은 API, 세 worker, Redis를 각각 식별한다", () => {
    const example = readRepositoryFile("deploy/stage.deploy.env.example");
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    assert.match(example, /^STAGE_SERVICE=/m);
    assert.match(example, /^STAGE_WORKER_SERVICE=/m);
    assert.match(example, /^STAGE_PUSH_WORKER_SERVICE=/m);
    assert.match(example, /^STAGE_ACCOUNT_DELETION_WORKER_SERVICE=/m);
    assert.match(example, /^STAGE_REDIS_SERVICE=/m);
    assert.match(example, /^STAGE_SERVICE=shiftmate_stage_api$/m);
    assert.match(
      example,
      /^STAGE_WORKER_SERVICE=shiftmate_stage_cache_worker$/m,
    );
    assert.match(
      example,
      /^STAGE_PUSH_WORKER_SERVICE=shiftmate_stage_push_worker$/m,
    );
    assert.match(
      example,
      /^STAGE_ACCOUNT_DELETION_WORKER_SERVICE=shiftmate_stage_account_deletion_worker$/m,
    );
    assert.match(example, /^STAGE_REDIS_SERVICE=shiftmate_stage_cache$/m);
    assert.match(
      script,
      /CENTER_FIREBASE_SECRET_FILE=.*secrets\/firebase\.json/,
    );
    assert.match(
      script,
      /STAGE_FIREBASE_SECRET_FILE=.*secrets\/firebase\.json/,
    );
    assert.match(script, /CENTER_FIREBASE_SECRET_DIR=.*secrets/);
    assert.match(script, /STAGE_FIREBASE_SECRET_DIR=.*secrets/);
    assert.match(
      script,
      /CENTER_FIREBASE_SECRET_DIR must be owned by root:root with mode 700/,
    );
    assert.match(
      script,
      /STAGE_FIREBASE_SECRET_DIR must be owned by root:root with mode 700/,
    );
    assert.match(
      script,
      /CENTER_FIREBASE_SECRET_FILE must be owned by root:root with mode 444/,
    );
    assert.match(
      script,
      /STAGE_FIREBASE_SECRET_FILE must be owned by root:root with mode 444/,
    );
  });

  test("worker health 실패는 Docker health subprocess 출력을 배포 로그에 남긴다", () => {
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    assert.match(script, /printComposeHealthLogs\(\)/);
    assert.match(script, /\.State\.Health\.Log/);
    assert.match(
      script,
      /wait_for_compose_health stage "\$STAGE_PUSH_WORKER_SERVICE" \|\| \{[\s\S]*printComposeHealthLogs stage "\$STAGE_PUSH_WORKER_SERVICE"/,
    );
    assert.match(
      script,
      /wait_for_compose_health center "\$target_push_worker" \|\| \{[\s\S]*printComposeHealthLogs center "\$target_push_worker"/,
    );
    assert.match(
      script,
      /wait_for_compose_health stage "\$STAGE_ACCOUNT_DELETION_WORKER_SERVICE" \|\| \{[\s\S]*printComposeHealthLogs stage "\$STAGE_ACCOUNT_DELETION_WORKER_SERVICE"/,
    );
    assert.match(
      script,
      /wait_for_compose_health center "\$target_account_deletion_worker" \|\| \{[\s\S]*printComposeHealthLogs center "\$target_account_deletion_worker"/,
    );
  });

  test("고정 launcher는 exact main checkout의 배포 엔진과 Compose/config만 root 번들로 실행한다", () => {
    const launcher = readRepositoryFile("deploy/shiftmate-deploy-launcher");
    const sudoers = readRepositoryFile(
      "deploy/sudoers/github-runner-shiftmate",
    );

    assert.match(launcher, /expected_actor="hspark-1"/);
    assert.match(
      launcher,
      /expected_repository="hspark-1\/shift_calendar_server-deploy"/,
    );
    assert.match(launcher, /runner_work_root="\/opt\/actions-runner\/_work"/);
    assert.match(launcher, /mode must be deploy or rollback/);
    assert.match(
      launcher,
      /deploy image SHA must match the checked-out source SHA/,
    );
    assert.match(launcher, /rev-parse HEAD/);
    assert.match(launcher, /verifySourceFile\(\)/);
    assert.match(launcher, /ls-tree "\$source_sha" "\$repository_path"/);
    assert.match(
      launcher,
      /rev-parse "\$\{source_sha\}:\$\{repository_path\}"/,
    );
    assert.match(launcher, /verifySourceFile deploy\/shiftmate-deploy 100755/);
    assert.match(
      launcher,
      /verifySourceFile deploy\/compose\.production\.yaml 100644/,
    );
    assert.match(
      launcher,
      /verifySourceFile deploy\/compose\.stage\.yaml 100644/,
    );
    assert.match(
      launcher,
      /verifySourceFile deploy\/config\/feature-flags\.production\.env 100644/,
    );
    assert.match(
      launcher,
      /verifySourceFile deploy\/config\/feature-flags\.stage\.env 100644/,
    );
    assert.match(launcher, /install -o root -g root -m 0700/);
    assert.match(
      launcher,
      /install -o root -g root -m 0600 "\$center_compose_source" "\$root_center_compose"/,
    );
    assert.match(
      launcher,
      /install -o root -g root -m 0600 "\$stage_compose_source" "\$root_stage_compose"/,
    );
    assert.match(
      launcher,
      /install -o root -g root -m 0600[\s\\]*"\$center_feature_flags_source" "\$root_center_feature_flags"/,
    );
    assert.match(
      launcher,
      /install -o root -g root -m 0600[\s\\]*"\$stage_feature_flags_source" "\$root_stage_feature_flags"/,
    );
    assert.match(
      launcher,
      /"\$root_center_compose"[\s\\]*"\$root_stage_compose"[\s\\]*"\$root_center_feature_flags"[\s\\]*"\$root_stage_feature_flags"/,
    );
    assert.match(launcher, /\/usr\/bin\/env -i/);
    assert.match(
      sudoers,
      /NOPASSWD: \/usr\/local\/sbin\/shiftmate-deploy-launcher/,
    );
    assert.doesNotMatch(
      sudoers,
      /NOPASSWD: \/usr\/local\/sbin\/shiftmate-deploy(?:\s|$)/,
    );
  });

  test("검증된 main Compose와 feature flag config를 원자 설치하고 실패 시 복원한다", () => {
    const script = readRepositoryFile("deploy/shiftmate-deploy");
    const validate_sources = script.indexOf("validateComposeSources");
    const sync_sources = script.indexOf("syncDeploymentConfigFiles");
    const install_center = script.indexOf(
      'installComposeSource "$CENTER_COMPOSE_SOURCE" "$COMPOSE_FILE"',
      sync_sources,
    );
    const install_stage = script.indexOf(
      'installComposeSource "$STAGE_COMPOSE_SOURCE" "$STAGE_COMPOSE_FILE"',
      install_center,
    );
    const center_service_contract = script.indexOf(
      "verified Center Compose source",
      validate_sources,
    );
    const stage_service_contract = script.indexOf(
      "verified Stage Compose source",
      center_service_contract,
    );
    const existing_stage_check = script.indexOf(
      'if ! checkHealthOnce "$STAGE_INTERNAL_HEALTH_PORT"; then',
    );

    assert.match(script, /\[\[ \$# -eq 6 \]\]/);
    assert.match(
      script,
      /Center Compose source must be owned by root:root with mode 600/,
    );
    assert.match(
      script,
      /Stage Compose source must be owned by root:root with mode 600/,
    );
    assert.match(
      script,
      /Center feature flags source must be owned by root:root with mode 600/,
    );
    assert.match(
      script,
      /Stage feature flags source must be owned by root:root with mode 600/,
    );
    assert.match(
      script,
      /--project-directory "\$APP_DIR"[\s\S]*--profile blue[\s\S]*--profile green[\s\S]*config --quiet/,
    );
    assert.match(
      script,
      /--project-directory "\$STAGE_APP_DIR"[\s\S]*--file "\$STAGE_COMPOSE_SOURCE"[\s\S]*config --quiet/,
    );
    assert.match(
      script,
      /temp_file="\$\(mktemp "\$\{target_file\}\.XXXXXX"\)"[\s\S]*install -o root -g root -m 0644[\s\S]*mv -f "\$temp_file" "\$target_file"/,
    );
    assert.ok(validate_sources >= 0);
    assert.ok(sync_sources > validate_sources);
    assert.ok(center_service_contract > validate_sources);
    assert.ok(stage_service_contract > center_service_contract);
    assert.ok(center_service_contract < install_center);
    assert.ok(stage_service_contract < install_center);
    assert.ok(install_center > sync_sources);
    assert.ok(install_stage > install_center);
    assert.ok(existing_stage_check > install_stage);
    assert.match(
      script,
      /cp --preserve=mode,ownership "\$COMPOSE_FILE" "\$CENTER_COMPOSE_BACKUP"/,
    );
    assert.match(
      script,
      /cp --preserve=mode,ownership "\$STAGE_COMPOSE_FILE" "\$STAGE_COMPOSE_BACKUP"/,
    );
    assert.match(
      script,
      /if \(\( BASE_COMPOSE_CHANGED == 1 \)\); then[\s\S]*installComposeSource "\$CENTER_COMPOSE_BACKUP" "\$COMPOSE_FILE"[\s\S]*installComposeSource "\$STAGE_COMPOSE_BACKUP" "\$STAGE_COMPOSE_FILE"/,
    );
    assert.match(script, /validateFeatureFlagSource\(\)/);
    assert.match(
      script,
      /value\["ACCOUNT_DELETION_ENABLED"\] == "true"[\s\S]*value\["ACCOUNT_DELETION_WORKER_ENABLED"\] != "true"/,
    );
    assert.match(script, /installFeatureFlagSource\(\)/);
    assert.match(script, /removeManagedFeatureFlagsFromEnvironment\(\)/);
    assert.match(
      script,
      /installFeatureFlagSource[\s\\]*"\$CENTER_FEATURE_FLAGS_SOURCE" "\$CENTER_FEATURE_FLAGS_FILE"/,
    );
    assert.match(
      script,
      /cp --preserve=mode,ownership "\$CENTER_ENV_BACKUP" "\$CENTER_ENV_FILE"[\s\S]*cp --preserve=mode,ownership "\$STAGE_ENV_BACKUP" "\$STAGE_ENV_FILE"/,
    );
    assert.match(
      script,
      /CENTER_FEATURE_FLAGS_EXISTED == 1[\s\S]*CENTER_FEATURE_FLAGS_BACKUP[\s\S]*rm -f "\$CENTER_FEATURE_FLAGS_FILE"/,
    );
  });

  test("main push 배포와 수동 rollback은 self-hosted exact checkout을 launcher로 실행한다", () => {
    const validation_workflow = readRepositoryFile(
      ".github/workflows/validate-main.yml",
    );
    const deploy_workflow = readRepositoryFile(
      ".github/workflows/deploy-production.yml",
    );
    const rollback_workflow = readRepositoryFile(
      ".github/workflows/rollback-production.yml",
    );
    const deploy_job = deploy_workflow.slice(
      deploy_workflow.indexOf("  deploy:"),
    );

    assert.match(validation_workflow, /pull_request:\n\s+branches:\n\s+- main/);
    assert.match(validation_workflow, /permissions:\n\s+contents: read/);
    assert.match(validation_workflow, /npm ci\n\s+npm test/);
    assert.match(validation_workflow, /bash -n/);
    assert.match(validation_workflow, /visudo -cf/);
    assert.match(deploy_workflow, /push:\n\s+branches:\n\s+- main/);
    assert.match(deploy_workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
    assert.match(
      deploy_job,
      /permissions:\n\s+contents: read\n\s+packages: read/,
    );
    assert.match(deploy_job, /uses: actions\/checkout@v6/);
    assert.match(deploy_job, /ref: \$\{\{ github\.sha \}\}/);
    assert.match(deploy_job, /persist-credentials: false/);
    assert.match(
      deploy_job,
      /sudo \/usr\/local\/sbin\/shiftmate-deploy-launcher/,
    );
    assert.match(deploy_job, /\s+deploy \\/);
    assert.match(deploy_job, /"\$GITHUB_WORKSPACE"/);
    assert.match(deploy_job, /"\$GITHUB_SHA"/);
    assert.match(deploy_job, /"\$GITHUB_REPOSITORY"/);

    assert.match(rollback_workflow, /contents: read/);
    assert.match(rollback_workflow, /uses: actions\/checkout@v6/);
    assert.match(
      rollback_workflow,
      /sudo \/usr\/local\/sbin\/shiftmate-deploy-launcher/,
    );
    assert.match(rollback_workflow, /\s+rollback \\/);
  });

  test("CI는 cache/push/회원 탈퇴 PostgreSQL·Redis 통합 테스트를 이미지 빌드 전에 실행한다", () => {
    const workflow = readRepositoryFile(
      ".github/workflows/deploy-production.yml",
    );
    const postgres_service = workflow.indexOf("      postgres:");
    const push_postgres_service = workflow.indexOf("      push_postgres:");
    const redis_service = workflow.indexOf("      redis:");
    const integration_test = workflow.indexOf("run: npm run test:integration");
    const push_integration_test = workflow.indexOf(
      "run: npm run test:push-integration",
    );
    const account_deletion_integration_test = workflow.indexOf(
      "run: npm run test:account-deletion-integration",
    );
    const image_build = workflow.indexOf("uses: docker/build-push-action@");
    assert.ok(postgres_service >= 0);
    assert.ok(push_postgres_service > postgres_service);
    assert.ok(redis_service > push_postgres_service);
    assert.ok(integration_test > redis_service);
    assert.ok(push_integration_test > integration_test);
    assert.ok(account_deletion_integration_test > push_integration_test);
    assert.ok(image_build > account_deletion_integration_test);
  });

  test("npm lockfile은 CI clean install에 필요한 optional dependency metadata를 완성한다", () => {
    const lockfile = JSON.parse(readRepositoryFile("package-lock.json"));
    const package_entries = Object.entries(lockfile.packages);
    const incomplete_entries = package_entries
      .filter(
        ([package_path, metadata]) =>
          package_path && !metadata.link && !metadata.version,
      )
      .map(([package_path]) => package_path);

    assert.deepEqual(incomplete_entries, []);
    assert.equal(
      lockfile.packages["node_modules/@opentelemetry/api"].version,
      "1.9.1",
    );
  });
}
