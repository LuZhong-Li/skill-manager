/**
 * 入口层信息性选项的退出码。
 *
 * `--help` 与 `--version` 不执行任何指令，属于「成功地把信息交给你」，
 * 因此必须返回 0。曾经 `--help` 会把解析器的「未给出指令名」计入退出码而返回 2，
 * 与 `--version`、无参数调用（都是 0）互相矛盾——这类不一致会让脚本误判失败。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture } from '../helpers/cli.ts';

test('入口：--help 输出用法并以 0 退出', async () => {
  const { code, out } = await capture(['--help']);
  assert.equal(code, 0, '--help 是信息性输出，不得以非零退出');
  assert.match(out, /用法：/, '应输出用法说明');
  assert.match(out, /--version/, '应列出选项');
});

test('入口：无参数同样输出用法并以 0 退出', async () => {
  const { code, out } = await capture([]);
  assert.equal(code, 0);
  assert.match(out, /用法：/);
});

test('入口：--version 只输出版本并以 0 退出', async () => {
  const { code, out } = await capture(['--version']);
  assert.equal(code, 0);
  assert.match(out.trim(), /^\d+\.\d+\.\d+$/);
});
