const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

// SSH 접속 정보는 Git에서 제외된 .env.stage.local에서만 읽는다.
for (const name of ['STAGE_SSH_HOST', 'STAGE_SSH_USER', 'STAGE_SSH_KEY_PATH']) {
  if (!process.env[name]) {
    console.error(`${name}을 .env.stage.local에 설정하세요.`);
    process.exit(1);
  }
}
if (process.env.DB_HOST !== '127.0.0.1' || !/^\d+$/.test(process.env.DB_PORT || '')) {
  console.error('DB_HOST=127.0.0.1과 터널의 로컬 DB_PORT를 설정하세요.');
  process.exit(1);
}
fs.accessSync(process.env.STAGE_SSH_KEY_PATH, fs.constants.R_OK);
const socket_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftmate-ssh-'));
const socket_path = path.join(socket_dir, 'control');
const ssh_target = `${process.env.STAGE_SSH_USER}@${process.env.STAGE_SSH_HOST}`;
let server_process;
let stopping = false;

function cleanup() {
  spawnSync('ssh', ['-S', socket_path, '-O', 'exit', ssh_target], { stdio: 'ignore' });
  fs.rmSync(socket_dir, { recursive: true, force: true });
}

function stopServer(signal) {
  if (stopping) return;
  stopping = true;
  if (server_process) server_process.kill(signal);
}

process.on('exit', cleanup);
process.on('SIGINT', () => stopServer('SIGINT'));
process.on('SIGTERM', () => stopServer('SIGTERM'));

const tunnel_result = spawnSync('ssh', [
  '-M', '-S', socket_path, '-fN',
  '-i', process.env.STAGE_SSH_KEY_PATH,
  '-p', process.env.STAGE_SSH_PORT || '22',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ControlPersist=no',
  '-L', `127.0.0.1:${process.env.DB_PORT}:${process.env.STAGE_DB_HOST || '127.0.0.1'}:${process.env.STAGE_DB_PORT || '5433'}`,
  ssh_target,
], { stdio: 'inherit' });
if (tunnel_result.error || tunnel_result.status !== 0 || stopping) {
  console.error('SSH 터널 시작 실패. 기존 터널이 같은 로컬 포트를 사용하는지 확인하세요.');
  process.exit(1);
}

console.log(`SSH 터널 준비 완료. 로컬 DB 포트: ${process.env.DB_PORT}`);
server_process = spawn(process.execPath, [
  require.resolve('nodemon/bin/nodemon.js'),
  '--watch', 'src', '--ext', 'ts,json',
  '--exec', 'node --env-file=.env.stage.local -r ts-node/register src/index.ts',
], { stdio: 'inherit' });
server_process.on('error', () => {
  console.error('nodemon 시작 실패');
  process.exit(1);
});
server_process.on('exit', (code, signal) => {
  process.exit(code ?? (signal === 'SIGINT' ? 130 : 1));
});

const tunnel_monitor = setInterval(() => {
  const result = spawnSync('ssh', ['-S', socket_path, '-O', 'check', ssh_target], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.error('SSH 터널이 종료되어 로컬 서버도 종료합니다.');
    clearInterval(tunnel_monitor);
    stopServer('SIGTERM');
  }
}, 3000);
tunnel_monitor.unref();
