import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resetLocks,
  withLock,
  withProcessLock,
  withWriterLock,
  workspaceLockFile,
} from '../../kernel/store/locking/index.ts';
import { KernelError } from '../../kernel/store/errors.ts';
import { CODES } from '@skill-manager/contract';
import { ensureWorkspaceDirs, layoutOf } from '../../kernel/store/workspace/index.ts';
import { makeTempDir } from '../helpers/temp.ts';

test('S-04 同一 key 的调用串行执行', async () => {
  resetLocks();
  const order: string[] = [];
  const first = withLock('k', async () => {
    order.push('first-start');
    await new Promise((resolve) => setTimeout(resolve, 30));
    order.push('first-end');
  });
  const second = withLock('k', () => {
    order.push('second');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('S-04 不同 key 之间互不阻塞', async () => {
  resetLocks();
  const order: string[] = [];
  await Promise.all([
    withLock('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('a');
    }),
    withLock('b', () => {
      order.push('b');
    }),
  ]);
  assert.equal(order[0], 'b', '未被占用的 key 应先完成');
});

test('S-04 前序任务失败不阻塞后续排队', async () => {
  resetLocks();
  const failing = withLock('k', () => {
    throw new Error('boom');
  });
  const following = withLock('k', () => 'ok');
  await assert.rejects(failing);
  assert.equal(await following, 'ok');
});

test('S-04 值传递与返回正常', async () => {
  resetLocks();
  assert.equal(await withLock('x', () => 42), 42);
});

test('M7-T1 跨进程锁：获取后同进程再取必须等待并超时', async () => {
  const lockFile = join(makeTempDir('sm-lock-'), 'workspace.lock');
  let reached = false;
  const outer = withProcessLock({ lockFile }, async () => {
    await assert.rejects(
      () => withProcessLock({ lockFile, timeoutMs: 200, pollMs: 20 }, () => undefined),
      (error: unknown) => error instanceof KernelError && error.code === CODES.LOCK_FAILED,
    );
    reached = true;
    return 'done';
  });
  assert.equal(await outer, 'done');
  assert.equal(reached, true);
  assert.equal(existsSync(lockFile), false, '释放后锁文件必须消失');
});

test('M7-T1 跨进程锁：真实子进程竞争时只能串行进入', async () => {
  const root = makeTempDir('sm-lock-race-');
  ensureWorkspaceDirs(layoutOf(root));
  const log = join(root, 'order.log');
  const script = join(root, 'worker.mjs');
  writeFileSync(
    script,
    `
import { appendFileSync } from 'node:fs';
import { withWriterLock } from ${JSON.stringify(new URL('../../kernel/store/locking/index.ts', import.meta.url).href)};
import { layoutOf } from ${JSON.stringify(new URL('../../kernel/store/workspace/index.ts', import.meta.url).href)};
const [root, log, name] = process.argv.slice(2);
await withWriterLock(layoutOf(root), async () => {
  appendFileSync(log, \`\${name}-enter\\n\`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  appendFileSync(log, \`\${name}-exit\\n\`);
});
`,
  );
  const run = (name: string) =>
    new Promise<number | null>((resolve) => {
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', script, root, log, name],
        { stdio: 'ignore' },
      );
      child.on('exit', (code) => resolve(code));
    });
  const codes = await Promise.all([run('a'), run('b')]);
  assert.deepEqual(codes, [0, 0], '两个进程都应成功结束');
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 4, '两个进程各写进入与退出两行');
  // 严格交替：enter 之后必须紧跟同一进程的 exit
  assert.match(lines[0]!, /^(a|b)-enter$/);
  const first = lines[0]!.replace('-enter', '');
  assert.equal(lines[1], `${first}-exit`, '任一时刻只能有一个进程处于临界区');
  assert.equal(existsSync(workspaceLockFile(root)), false, '释放后锁文件必须消失');
});

test('M7-T1 跨进程锁：持有者进程已退出时回收陈旧锁并继续', async () => {
  const root = makeTempDir('sm-lock-stale-');
  const layout = layoutOf(root);
  ensureWorkspaceDirs(layout);
  const lockFile = workspaceLockFile(root);
  // 造一个必然不存在的 pid，并写一个有效 token 格式的锁记录
  writeFileSync(
    lockFile,
    JSON.stringify({ pid: 2147480, token: 'stale', created_at: '2020-01-01' }),
  );
  const value = await withProcessLock({ lockFile, timeoutMs: 2000, pollMs: 20 }, () => 'recovered');
  assert.equal(value, 'recovered');
  assert.equal(existsSync(lockFile), false);
});

test('M7-T1 跨进程锁：活锁不回收，且超时诊断点名持有者', async () => {
  const lockFile = join(makeTempDir('sm-lock-live-'), 'workspace.lock');
  // 当前测试进程自身作为「活着的持有者」
  writeFileSync(
    lockFile,
    JSON.stringify({ pid: process.pid, token: 'live', created_at: '2026-01-01T00:00:00Z' }),
  );
  await assert.rejects(
    () => withProcessLock({ lockFile, timeoutMs: 200, pollMs: 20 }, () => undefined),
    (error: unknown) => {
      assert.ok(error instanceof KernelError);
      assert.equal(error.code, CODES.LOCK_FAILED);
      assert.match(error.message, new RegExp(String(process.pid)), '诊断须点名持有者 pid');
      return true;
    },
  );
  assert.equal(existsSync(lockFile), true, '活锁不得被回收');
});

test('M7-T1 跨进程锁：释放时只删除自己持有的锁', async () => {
  const lockFile = join(makeTempDir('sm-lock-owner-'), 'workspace.lock');
  await assert.rejects(
    () =>
      withProcessLock({ lockFile, timeoutMs: 150, pollMs: 20 }, async () => {
        // 持有期间被其他进程抢走（模拟）：替换 token
        writeFileSync(
          lockFile,
          JSON.stringify({ pid: process.pid, token: 'intruder', created_at: '2026-01-01' }),
        );
        throw new Error('boom');
      }),
    /boom/,
  );
  // 失败路径的 finally 不应删除 token 已变化的锁
  assert.equal(existsSync(lockFile), true);
  assert.match(readFileSync(lockFile, 'utf8'), /intruder/);
});

test('M7-T1 工作区锁：加锁不在工作区内留下任何文件', async () => {
  const root = join(makeTempDir('sm-lock-uninit-'), 'not-created');
  const layout = layoutOf(root);
  const value = await withWriterLock(layout, () => 'ok');
  assert.equal(value, 'ok');
  assert.equal(existsSync(workspaceLockFile(root)), false, '释放后不留锁文件');
  mkdirSync(root, { recursive: true });
  assert.equal(existsSync(layout.locksDir), false, '不得为未初始化工作区创建目录');
});

test('M7-T1 工作区锁：已初始化工作区的加锁不改变任何内容', async () => {
  const root = makeTempDir('sm-lock-readonly-');
  const layout = layoutOf(root);
  ensureWorkspaceDirs(layout);
  const before = readdirSync(root).sort();
  const lockFile = workspaceLockFile(root);
  await withWriterLock(layout, () => undefined);
  assert.deepEqual(readdirSync(root).sort(), before, '工作区顶层条目不得变化');
  assert.equal(existsSync(lockFile), false);
  assert.deepEqual(readdirSync(layout.locksDir), [], '锁文件不落在工作区 locks 目录内');
});

test('M7-T1 工作区锁：同一进程嵌套调用可重入', async () => {
  const root = makeTempDir('sm-lock-reentrant-');
  const layout = layoutOf(root);
  ensureWorkspaceDirs(layout);
  const value = await withWriterLock(layout, () =>
    withWriterLock(layout, () => Promise.resolve('nested')),
  );
  assert.equal(value, 'nested');
  assert.equal(existsSync(workspaceLockFile(root)), false, '重入后仍须释放锁');
});
