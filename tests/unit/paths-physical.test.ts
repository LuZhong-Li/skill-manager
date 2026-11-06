/**
 * M7-T4：统一路径规范化与宿主归属比较。
 *
 * 归属判定的失败模式是「等价路径得出不同结论」：同一目录换个分隔符、
 * 换个大小写、或目标尚未创建时 `realpath` 失败退化成长度前缀比较，
 * 就会把工作区内路径判成外部，或把 `workspace-evil` 判成 `workspace` 的子路径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPhysicallyWithin, isWithin, physicalKey } from '../../kernel/store/paths/index.ts';
import { makeTempDir } from '../helpers/temp.ts';

const win = process.platform === 'win32';

test('M7-T4 归属：根包含自身，且子路径被认作内部', () => {
  const root = makeTempDir('sm-t4-');
  const child = join(root, 'skills', 'alpha');
  assert.equal(isPhysicallyWithin(root, root), true);
  assert.equal(isPhysicallyWithin(root, child), true);
});

test('M7-T4 归属：前缀相似的兄弟目录不算内部', () => {
  const root = makeTempDir('sm-t4-');
  const sibling = `${root}-evil`;
  assert.equal(
    isPhysicallyWithin(root, sibling),
    false,
    'workspace-evil 不得被判为 workspace 之内',
  );
  assert.equal(isPhysicallyWithin(join(root, 'skills'), join(root, 'skills-other')), false);
});

test('M7-T4 归属：尚未创建的计划目标仍按最近存在祖先判定', () => {
  const root = makeTempDir('sm-t4-');
  const planned = join(root, 'skills', 'not-created-yet', 'SKILL.md');
  assert.equal(existsSync(planned), false, '前置：目标确实不存在');
  assert.equal(
    isPhysicallyWithin(root, planned),
    true,
    'realpath 失败时不得退化成字符串比较而把计划目标判成外部',
  );
});

test('M7-T4 归属：分隔符混用不影响结论', () => {
  const root = makeTempDir('sm-t4-');
  const mixed = win ? `${root}\\skills/alpha` : `${root}/skills\\alpha`;
  assert.equal(isPhysicallyWithin(root, mixed), true);
});

test('M7-T4 归属：上跳路径被拒绝，越界目标被拒绝', () => {
  const root = makeTempDir('sm-t4-');
  assert.equal(isPhysicallyWithin(root, join(root, '..', 'outside')), false);
  assert.equal(isPhysicallyWithin(root, '/etc/passwd'), false);
});

test('M7-T4 键：等价写法得到同一个物理键', () => {
  const root = makeTempDir('sm-t4-');
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', 'marker.txt'), 'x');
  const direct = join(root, 'skills', 'marker.txt');
  const detoured = join(root, 'skills', '..', 'skills', 'marker.txt');
  assert.equal(physicalKey(direct), physicalKey(detoured));
});

test('M7-T4 词法防护：..foo 子项不被误判为越界', () => {
  const root = makeTempDir('sm-t4-');
  assert.equal(isWithin(root, '..foo/x'), true, '以 .. 开头的普通目录名不是上跳');
  assert.equal(isWithin(root, '../outside'), false);
});

test('M7-T4 Windows：盘符与路径大小写不影响归属', (t) => {
  if (!win) return t.skip('仅 Windows 有大小写不敏感的路径语义');
  const root = makeTempDir('sm-t4-');
  const upper = root.toUpperCase();
  assert.equal(physicalKey(upper), physicalKey(root), '大小写不同应折叠为同一物理键');
  assert.equal(isPhysicallyWithin(upper, join(root, 'skills')), true);
});

test('M7-T4 Windows：不同盘符不算内部', (t) => {
  if (!win) return t.skip('仅 Windows 存在多盘符');
  const root = makeTempDir('sm-t4-');
  const otherDrive = root.toLowerCase().startsWith('c:') ? 'Z:\\workspace' : 'C:\\workspace';
  assert.equal(isPhysicallyWithin(root, otherDrive), false);
});

test('M7-T4 Windows：8.3 短名与长名等价（本机未启用则跳过）', (t) => {
  if (!win) return t.skip('仅 Windows 存在 8.3 短名');
  const long = 'C:\\Program Files';
  const short = 'C:\\PROGRA~1';
  if (!existsSync(long) || !existsSync(short)) return t.skip('本机未启用或不可访问 8.3 短名');
  assert.equal(physicalKey(short), physicalKey(long));
});
