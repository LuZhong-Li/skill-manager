/**
 * 问题证据的词表与分词：把一句自然语言描述翻成可检索的代码片段。
 *
 * 单独成文件，是因为这里全是词典与轻量字符串处理，会随实际使用不断增补；
 * 而探查逻辑（巡览、打分、编排）放在 `evidence.ts`，应当保持稳定可读。
 */

/** 口语句式：写代码时不会出现在标识符里的词，不参与文件内容匹配。 */
const STOPWORDS = new Set([
  '一个',
  '一下',
  '什么',
  '怎么',
  '我们',
  '你们',
  '他们',
  '这个',
  '那个',
  '这样',
  '那样',
  '可以',
  '需要',
  '应该',
  '但是',
  '然后',
  '因为',
  '所以',
  '如果',
  '时候',
  '问题',
  '情况',
  '现在',
  '就是',
  '不是',
  '没有',
  '去做',
  '出来',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'when',
  'what',
  'have',
  'does',
  'will',
  'should',
  'would',
  'could',
  'into',
  'about',
]);

/** 症状词表：把「崩溃/报错/慢/丢数据」这类描述翻译成可检索的代码线索。 */
const SYMPTOM_CLUES: Array<{ keywords: string[]; tokens: string[] }> = [
  {
    keywords: ['崩溃', '闪退', 'crash', 'exit code', '退出码'],
    tokens: ['crash', 'throw', 'catch', 'exit', 'error', 'uncaught', 'SIGSEGV'],
  },
  {
    keywords: ['报错', '错误', '异常', 'error', '失败', 'fail'],
    tokens: ['error', 'catch', 'throw', 'invalid', 'reject', 'fail'],
  },
  {
    keywords: ['慢', '卡', '性能', '超时', 'timeout', 'slow'],
    tokens: ['timeout', 'slow', 'perf', 'cache', 'batch', 'concurren'],
  },
  {
    keywords: ['丢', '丢失', '不一致', '重复', '覆盖'],
    tokens: ['write', 'sync', 'transaction', 'lock', 'dedup', 'merge', 'copy'],
  },
  {
    keywords: ['安装', 'install', '打包', 'pack'],
    tokens: ['install', 'pack', 'build', 'landing', 'distribute'],
  },
  {
    keywords: ['更新', '升级', 'update', 'upgrade'],
    tokens: ['update', 'check', 'version', 'semver', 'ref'],
  },
  {
    keywords: ['权限', '登录', '认证', '鉴权', 'auth'],
    tokens: ['auth', 'permission', 'token', 'role', 'session'],
  },
  {
    keywords: ['配置', 'config', '设置'],
    tokens: ['config', 'setting', 'env', 'option'],
  },
  {
    keywords: ['导出', '导入', 'import', 'export', '备份'],
    tokens: ['export', 'import', 'backup', 'restore'],
  },
  {
    keywords: ['界面', '页面', '按钮', 'ui', '样式'],
    tokens: ['render', 'view', 'component', 'style', 'ui'],
  },
];

/**
 * 中文检索词表：把连续汉字切成更小的可检索单元。
 *
 * 没有分词器就不能指望「安装时崩溃并报错」这种整句命中；这里用一张受控词表
 * 取「最长的已登记子串」，既不引入依赖，也能让「更新失败」「导出丢数据」
 * 这类短语落到 update / export / dedup 这些真实存在的标识符片段上。
 */
const CORE_TERMS = [
  // 动作
  '安装',
  '卸载',
  '更新',
  '升级',
  '导入',
  '导出',
  '备份',
  '恢复',
  '刷新',
  '配置',
  '校验',
  '扫描',
  '索引',
  '分发',
  '渲染',
  '加载',
  '解析',
  '登录',
  '认证',
  '鉴权',
  '权限',
  '搜索',
  '筛选',
  '分页',
  '排序',
  '上传',
  '下载',
  '同步',
  '部署',
  '打包',
  '构建',
  '启动',
  '退出',
  '保存',
  '写入',
  '读取',
  '删除',
  '创建',
  '重命名',
  '合并',
  '拆分',
  '分片',
  '超时',
  '重试',
  '缓存',
  '并发',
  // 症状
  '崩溃',
  '闪退',
  '报错',
  '错误',
  '异常',
  '失败',
  '卡顿',
  '很慢',
  '太慢',
  '变慢',
  '缓慢',
  '卡死',
  '性能',
  '内存',
  '泄露',
  '泄漏',
  '死锁',
  '阻塞',
  '丢失',
  '丢数据',
  '丢失数据',
  '重复',
  '不一致',
  '覆盖',
  '越界',
  '空值',
  '乱码',
  '编码',
  '中文',
  '路径',
  '显示',
  '界面',
  '页面',
  '按钮',
  '弹窗',
  '样式',
  '布局',
  '主题',
  '颜色',
  '列表',
  '详情',
  '表单',
  '表格',
  // 对象
  '技能',
  '插件',
  '宿主',
  '账本',
  '版本',
  '依赖',
  '运行时',
  '工作区',
  '中心库',
  '指纹',
  '契约',
  '文档',
  '测试',
  '用例',
  '日志',
  '进度',
  '状态',
  '锁',
] as const;

/** 检索词 → 代码里更可能出现的标识符片段。 */
export const TERM_TOKENS: Record<string, string[]> = {
  安装: ['install'],
  卸载: ['uninstall'],
  更新: ['update', 'upgrade'],
  升级: ['update', 'upgrade'],
  导入: ['import'],
  导出: ['export'],
  备份: ['backup'],
  恢复: ['restore', 'recover'],
  刷新: ['refresh', 'reload'],
  配置: ['config'],
  校验: ['validate', 'verify', 'check'],
  扫描: ['scan'],
  索引: ['index'],
  分发: ['land', 'distribute', 'landing'],
  渲染: ['render'],
  加载: ['load'],
  解析: ['parse'],
  登录: ['login', 'signin', 'auth'],
  认证: ['auth', 'token'],
  鉴权: ['auth', 'permission', 'role'],
  权限: ['permission', 'role', 'acl'],
  搜索: ['search', 'query'],
  筛选: ['filter'],
  分页: ['page', 'cursor'],
  排序: ['sort', 'order'],
  上传: ['upload'],
  下载: ['download'],
  同步: ['sync'],
  部署: ['deploy'],
  打包: ['pack', 'build'],
  构建: ['build'],
  启动: ['start', 'boot', 'init'],
  退出: ['exit', 'quit', 'dispose'],
  保存: ['save', 'persist'],
  写入: ['write'],
  读取: ['read', 'load'],
  删除: ['delete', 'remove', 'clean'],
  创建: ['create'],
  重命名: ['rename'],
  合并: ['merge'],
  拆分: ['split'],
  分片: ['chunk', 'shard'],
  超时: ['timeout'],
  重试: ['retry'],
  缓存: ['cache', 'memo'],
  并发: ['concurren', 'parallel', 'lock'],
  崩溃: ['crash', 'throw', 'catch', 'exit'],
  闪退: ['crash', 'exit'],
  报错: ['error', 'throw', 'reject'],
  错误: ['error'],
  异常: ['error', 'exception', 'throw'],
  失败: ['fail', 'error', 'reject'],
  卡顿: ['slow', 'perf'],
  很慢: ['slow', 'perf', 'timeout'],
  太慢: ['slow', 'perf', 'timeout'],
  变慢: ['slow', 'perf'],
  缓慢: ['slow', 'perf'],
  卡死: ['hang', 'deadlock', 'block'],
  性能: ['perf', 'latency'],
  内存: ['memory', 'heap'],
  泄露: ['leak'],
  泄漏: ['leak'],
  死锁: ['deadlock', 'lock'],
  阻塞: ['block', 'wait'],
  丢失: ['lost', 'missing', 'drop'],
  丢数据: ['lost', 'missing', 'drop', 'write'],
  丢失数据: ['lost', 'missing', 'drop', 'write'],
  重复: ['dup', 'repeat'],
  不一致: ['mismatch', 'inconsistent', 'drift'],
  覆盖: ['overwrite', 'cover'],
  越界: ['bound', 'range'],
  空值: ['null', 'undefined', 'empty'],
  乱码: ['encoding', 'charset', 'utf8'],
  编码: ['encoding', 'charset', 'utf8'],
  中文: ['chinese', 'cjk', 'utf8'],
  路径: ['path'],
  显示: ['render', 'display', 'view'],
  界面: ['ui', 'view', 'render'],
  页面: ['page', 'view'],
  按钮: ['button'],
  弹窗: ['modal', 'dialog'],
  样式: ['style', 'css'],
  布局: ['layout'],
  主题: ['theme', 'dark', 'light'],
  颜色: ['color', 'theme'],
  列表: ['list'],
  详情: ['detail'],
  表单: ['form'],
  表格: ['table'],
  技能: ['skill'],
  插件: ['plugin'],
  宿主: ['host'],
  账本: ['landing', 'ledger'],
  版本: ['version', 'semver'],
  依赖: ['depend', 'require'],
  运行时: ['runtime', 'node', 'engines'],
  工作区: ['workspace'],
  中心库: ['library', 'store'],
  指纹: ['digest', 'hash', 'fingerprint'],
  契约: ['contract'],
  文档: ['doc'],
  测试: ['test', 'spec'],
  用例: ['test', 'case'],
  日志: ['log'],
  进度: ['progress'],
  状态: ['status', 'state'],
  锁: ['lock'],
};

/**
 * 症状词：描述「出了什么毛病」，而不是「哪个功能」。
 *
 * 它们必须比功能词（安装、导出、搜索……）权重低——否则「搜索很慢」会命中
 * 某个恰好定义了 slow / timeout 词表的文件，把真正实现搜索的代码挤下去。
 */
const SYMPTOM_WORDS = new Set([
  '崩溃',
  '闪退',
  '报错',
  '错误',
  '异常',
  '失败',
  '卡顿',
  '很慢',
  '太慢',
  '变慢',
  '缓慢',
  '卡死',
  '性能',
  '内存',
  '泄露',
  '泄漏',
  '死锁',
  '阻塞',
  '丢失',
  '丢数据',
  '丢失数据',
  '重复',
  '不一致',
  '覆盖',
  '越界',
  '空值',
  '乱码',
]);

/** 该检索词是否为症状词（只作佐证，不作主证据）。 */
export function isSymptomWord(word: string): boolean {
  if (SYMPTOM_WORDS.has(word)) return true;
  return SYMPTOM_CLUES.some((clue) => clue.keywords.includes(word));
}

/** 从连续汉字里取最长的已登记词；取不到时返回空。 */
function longestTerm(text: string): string {
  for (let length = Math.min(text.length, 4); length >= 2; length -= 1) {
    const candidate = text.slice(0, length);
    if ((CORE_TERMS as readonly string[]).includes(candidate)) return candidate;
  }
  return '';
}

/** 把中文片段切成检索词（最长匹配、从左到右）。 */
export function segmentChinese(text: string): string[] {
  const terms: string[] = [];
  let rest = text;
  while (rest.length >= 2) {
    const term = longestTerm(rest);
    if (term === '') {
      rest = rest.slice(1);
      continue;
    }
    terms.push(term);
    rest = rest.slice(term.length);
  }
  return terms;
}

/** 把问题描述切成可检索的关键词（中文词 + 英文标识符）。 */
export function keywordsOf(problem: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const token = raw.trim().toLowerCase();
    if (token.length < 2) return;
    if (STOPWORDS.has(token)) return;
    if (seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };
  // 英文与数字标识符：长度 ≥3 才参与，避免 a / an / of 这类噪声
  for (const item of problem.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []) push(item);
  // 中文按受控词表切分
  for (const chunk of problem.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (const term of segmentChinese(chunk)) push(term);
  }
  return tokens.slice(0, 12);
}

/** 检索词展开成代码标识符片段：中文词走词表，英文词本身即是片段。 */
export function codeTokensOf(keywords: readonly string[], problem: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const token = raw.toLowerCase();
    if (token.length < 2) return;
    if (seen.has(token)) return;
    seen.add(token);
    tokens.push(token);
  };
  for (const keyword of keywords) {
    if (/^[a-z][a-z0-9_-]*$/.test(keyword)) push(keyword);
    for (const token of TERM_TOKENS[keyword] ?? []) push(token);
  }
  for (const clue of symptomClueTokens(problem)) push(clue);
  return tokens.slice(0, 20);
}

/** 由症状词表补充检索线索（去重）。 */
export function symptomClueTokens(problem: string): string[] {
  const lower = problem.toLowerCase();
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const clue of SYMPTOM_CLUES) {
    if (!clue.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) continue;
    for (const token of clue.tokens) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens.slice(0, 12);
}

/** 兼容旧命名：症状线索。 */
export const symptomTokensOf = symptomClueTokens;
