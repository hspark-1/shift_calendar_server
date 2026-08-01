const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repository_root = path.resolve(__dirname, "..");
const deployment_files = [
  "deploy/compose.production.yaml",
  "deploy/shiftmate-deploy",
  "deploy/shiftmate-bootstrap",
  ".github/workflows/deploy-production.yml",
];
const present_deployment_files = deployment_files.filter((relative_path) =>
  fs.existsSync(path.join(repository_root, relative_path)),
);

function readRepositoryFile(relative_path) {
  return fs.readFileSync(path.join(repository_root, relative_path), "utf8");
}

if (present_deployment_files.length === 0) {
  test.skip(
    "배포 정적 테스트: 별도 배포 저장소로 이동한 파일이 현재 저장소에 없어 건너뜀",
    () => {},
  );
} else {
  test(
    "배포 정적 테스트 파일은 전부 존재하거나 전부 별도 저장소에 있어야 한다",
    () => {
      assert.deepEqual(present_deployment_files, deployment_files);
    },
  );

test("Center Compose는 공유 Redis와 색상별 worker를 외부 포트 없이 정의한다", () => {
  const compose = readRepositoryFile("deploy/compose.production.yaml");
  assert.match(compose, /^  shiftmate_cache:/m);
  assert.match(compose, /^  shiftmate_blue_cache_worker:/m);
  assert.match(compose, /^  shiftmate_green_cache_worker:/m);
  assert.match(compose, /redis-server --save '' --appendonly no/);
  assert.match(compose, /--requirepass "\$\$REDIS_PASSWORD"/);
  assert.match(compose, /node", "dist\/workers\/workShiftCacheWorker\.js", "--healthcheck/);

  const redis_block = compose.slice(
    compose.indexOf("  shiftmate_cache:"),
    compose.indexOf("  shiftmate_blue_api_1:"),
  );
  assert.doesNotMatch(redis_block, /^    ports:/m);
});

test("배포는 Redis, Stage API/worker, Center API/worker, Nginx 순서를 지킨다", () => {
  const script = readRepositoryFile("deploy/shiftmate-deploy");
  assert.match(
    script,
    /http:\/\/127\.0\.0\.1:\$\{port\}\/api\/v1\/health\/ready/,
  );
  const center_redis = script.indexOf("compose up -d shiftmate_cache");
  const stage_redis = script.indexOf('stage_compose up -d "$STAGE_REDIS_SERVICE"');
  const stage_apply = script.indexOf(
    'stage_compose up -d --no-deps --force-recreate "$STAGE_SERVICE" "$STAGE_WORKER_SERVICE"',
    stage_redis,
  );
  const stage_worker_health = script.indexOf(
    'wait_for_compose_health stage "$STAGE_WORKER_SERVICE"',
    stage_apply,
  );
  const center_apply = script.indexOf(
    'compose up -d --no-deps --force-recreate "${target_services[@]}"',
  );
  const center_worker_health = script.indexOf(
    'wait_for_compose_health center "$target_worker"',
    center_apply,
  );
  const nginx_switch = script.indexOf('render_upstream "$TARGET_COLOR"');

  assert.ok(center_redis >= 0);
  assert.ok(center_redis < stage_redis);
  assert.ok(stage_redis < stage_apply);
  assert.ok(stage_apply < stage_worker_health);
  assert.ok(stage_worker_health < center_apply);
  assert.ok(center_apply < center_worker_health);
  assert.ok(center_worker_health < nginx_switch);
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

test("배포 실패와 색상 전환은 API와 worker를 같은 단위로 복원·중지한다", () => {
  const script = readRepositoryFile("deploy/shiftmate-deploy");
  assert.match(
    script,
    /printf 'shiftmate_%s_api_3\\n' "\$color"[\s\S]*printf 'shiftmate_%s_cache_worker\\n' "\$color"/,
  );
  assert.match(
    script,
    /mapfile -t failed_services < <\(services_for_color "\$TARGET_COLOR"\)[\s\S]*compose stop --timeout 15 "\$\{failed_services\[@\]\}"/,
  );
  assert.match(
    script,
    /stage_compose up -d --no-deps --force-recreate "\$STAGE_SERVICE" "\$STAGE_WORKER_SERVICE"/,
  );
  assert.match(
    script,
    /mapfile -t old_services < <\(services_for_color "\$OLD_COLOR"\)[\s\S]*compose stop --timeout 15 "\$\{old_services\[@\]\}"/,
  );
});

test("CI는 PostgreSQL·Redis 통합 테스트를 이미지 빌드 전에 실행한다", () => {
  const workflow = readRepositoryFile(".github/workflows/deploy-production.yml");
  const postgres_service = workflow.indexOf("      postgres:");
  const redis_service = workflow.indexOf("      redis:");
  const integration_test = workflow.indexOf("run: npm run test:integration");
  const image_build = workflow.indexOf("uses: docker/build-push-action@");
  assert.ok(postgres_service >= 0);
  assert.ok(redis_service > postgres_service);
  assert.ok(integration_test > redis_service);
  assert.ok(image_build > integration_test);
});
}
