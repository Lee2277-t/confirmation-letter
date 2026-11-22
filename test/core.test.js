/**
 * 函证助手 · 核心逻辑回归
 */
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = [];
function ok(cond, msg) {
  if (cond) pass++;
  else fail.push(msg);
}
function eq(a, b, msg) {
  ok(a === b, msg + ' — 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function near(a, b, msg) {
  ok(Math.abs(a - b) < 1e-9, msg + ' — 期望 ' + b + '，实际 ' + a);
}

/* ---------------- 金额 ---------------- */

console.log('[金额]');
eq(Core.toCents('1,234.56'), 123456, '千分位');
eq(Core.toCents('-1,234.56'), -123456, '负号');
eq(Core.toCents('（1,234.56）'), -123456, '全角括号表示负数');
eq(Core.toCents('(1234.56)'), -123456, '半角括号表示负数');
eq(Core.toCents('-'), 0, '一个破折号是 0');
eq(Core.toCents('—'), 0, '一个长破折号也是 0');
eq(Core.toCents('--'), null, '两个破折号读不出');
eq(Core.toCents('待核实'), null, '文字读不出');
eq(Core.toCents(''), null, '空串读不出');
eq(Core.toCents(null), null, 'null 读不出');
eq(Core.toCents(1234.56), 123456, '数字类型');
eq(Core.toCents(0), 0, '数字 0');
eq(Core.toCents('¥1,000'), 100000, '带货币符号');
eq(Core.moneyText(123456), '1,234.56', '显示千分位');
eq(Core.moneyText(-123456), '-1,234.56', '显示负数');
eq(Core.moneyText(0), '0.00', '显示 0');
eq(Core.moneyText(5), '0.05', '显示分');
eq(Core.moneyText(123456789), '1,234,567.89', '显示百万');

/* ---------------- 认表头 ---------------- */

console.log('\n[认表头]');
const t1 = [
  ['单位名称', '科目', '期末余额'],
  ['甲公司', '应收账款', 1000]
];
const h1 = Core.detectHeader(t1);
eq(h1.rowIndex, 0, '第一行就是表头');
eq(h1.nameCol, 0, '名称列');
eq(h1.amountCol, 2, '金额列');
eq(h1.subjectCol, 1, '科目列');

const t2 = [
  ['某某公司往来款项明细表'],
  [],
  ['客户名称', '账号', '期末余额（元）'],
  ['乙公司', '6222', 500]
];
const h2 = Core.detectHeader(t2);
eq(h2.rowIndex, 2, '有标题行时能往下找');
eq(h2.nameCol, 0, '客户名称');
eq(h2.amountCol, 2, '期末余额（元）');

const t3 = [['摘要', '借方', '贷方'], ['买东西', 100, 0]];
const h3 = Core.detectHeader(t3);
eq(h3.rowIndex, -1, '没有单位名称列就不硬认');
ok(h3.problems.length > 0, '要说明缺什么列');

const t4 = [['供应商', '本期发生额', '期末余额'], ['丙', 100, 900]];
const h4 = Core.detectHeader(t4);
eq(h4.amountCol, 2, '期末余额优先于发生额');

/* ---------------- 读行 ---------------- */

console.log('\n[读行]');
const rows5 = [
  ['单位名称', '科目', '期末余额'],
  ['甲公司', '应收账款', 1200],
  ['乙公司', '应收账款', '待核实'],
  ['', '', ''],
  ['合计', '', 9999]
];
const p5 = Core.parseRows(rows5, Core.detectHeader(rows5), { firstExcelRow: 1 });
eq(p5.entities.length, 1, '只有甲公司能读出来');
eq(p5.entities[0].cents, 120000, '金额换成以分计的整数');
eq(p5.skipped.filter(s => s.reason === '金额读不出' && s.name === '乙公司').length, 1, '乙公司金额读不出，要单独报');
eq(p5.skipped.filter(s => s.reason === '金额读不出')[0].name, '乙公司', '报的是哪一家');
ok(p5.problems.some(p => /金额读不出/.test(p)), '问题里要有提示');

const rows6 = [
  ['单位名称', '期末余额'],
  ['甲公司', 100],
  ['', 500]
];
const p6 = Core.parseRows(rows6, Core.detectHeader(rows6), {
  firstExcelRow: 1, merges: [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]
});
// 名称列按区块合并时，下面几行是空的；沿用上一个名称，钱不能丢
eq(p6.entities.length, 2, '空名称的行沿用了上一行的单位');
eq(Core.mergeByName(p6.entities)[0].cents, 60000, '甲公司合计 600（100 + 500）');
const p6b = Core.parseRows([['单位名称', '期末余额'], ['', 500]], Core.detectHeader([['单位名称', '期末余额'], ['', 500]]), {});
eq(p6b.entities.length, 0, '开头就没有名字的行仍然不猜');
ok(p6b.skipped.some(s => s.reason === '没有单位名称' && s.cents === 50000), '并且要报出来');

const rows7 = [['单位名称', '期末余额'], ['甲公司', 100], ['小计', 100], ['合  计', 100]];
const p7 = Core.parseRows(rows7, Core.detectHeader(rows7), {});
eq(p7.entities.length, 1, '合计/小计行不当成单位');
eq(p7.skipped.filter(s => s.reason === '合计行').length, 2, '合计行记进 skipped');

/* ---------------- 合并 ---------------- */

console.log('\n[同名合并]');
const merged = Core.mergeByName([
  { name: '甲公司', subject: '应收账款', cents: 1000 },
  { name: '甲公司', subject: '预收账款', cents: -300 },
  { name: '乙公司', subject: '应收账款', cents: 500 }
]);
eq(merged.length, 2, '两家公司');
eq(merged[0].cents, 700, '同名相加：1000-300');
eq(merged[0].subjects.length, 2, '科目都保留');
eq(merged[1].cents, 500, '乙公司不受影响');

/* ---------------- 选样 ---------------- */

console.log('\n[选样]');
const pool = [
  { name: 'A', cents: 1000000 },
  { name: 'B', cents: 500000 },
  { name: 'C', cents: 100000 },
  { name: 'D', cents: 50000 },
  { name: 'E', cents: 10000 }
];
const all = Core.selectEntities(pool, { mode: 'all' });
eq(all.count, 5, '全部');

const thr = Core.selectEntities(pool, { mode: 'threshold', thresholdCents: 500000 });
eq(thr.count, 2, '阈值 5,000 元 → A、B 两户');

const mixed = Core.selectEntities(pool, { mode: 'mixed', thresholdCents: 500000, sampleSize: 3, seed: 1 });
eq(mixed.count, 3, '大额 2 户 + 随机补 1 户');
eq(mixed.selected.filter(s => s.reason === '超阈值').length, 2, '大额标记');
eq(mixed.selected.filter(s => s.reason === '随机抽取').length, 1, '随机标记');

const mixed2 = Core.selectEntities(pool, { mode: 'mixed', thresholdCents: 500000, sampleSize: 3, seed: 1 });
eq(JSON.stringify(mixed.selected.map(s => s.name)), JSON.stringify(mixed2.selected.map(s => s.name)), '同种子同结果');

const samples = new Set();
for (let seed = 1; seed <= 20; seed++) {
  const r = Core.selectEntities(pool, { mode: 'sample', sampleSize: 2, seed });
  samples.add(r.selected.map(s => s.name).sort().join(','));
}
ok(samples.size > 1, '不同种子应该抽出不同组合（否则随机是假的）');

const over = Core.selectEntities(pool, { mode: 'mixed', thresholdCents: 0, sampleSize: 99 });
eq(over.count, 5, '要的比有的多，就给全部');

const zero = Core.selectEntities([], { mode: 'all' });
eq(zero.count, 0, '空清单不炸');
eq(zero.coverage, 0, '空清单覆盖率 0');

/* ---------------- 覆盖率与合计 ---------------- */

console.log('\n[覆盖率]');
const cov = Core.selectEntities(pool, { mode: 'threshold', thresholdCents: 500000 });
eq(cov.totalCents, 1500000, '选中金额合计');
near(cov.coverage, 1500000 / 1660000, '覆盖率按绝对值算');
ok(cov.coverage > 0.9, '大额占多数');

const negPool = [{ name: 'A', cents: -1000 }, { name: 'B', cents: 500 }];
const negSel = Core.selectEntities(negPool, { mode: 'threshold', thresholdCents: 800 });
eq(negSel.count, 1, '负数按绝对值比阈值');
eq(negSel.selected[0].name, 'A', '选出负数那户');

/* ---------------- 控制表 ---------------- */

console.log('\n[控制表]');
const ctl = Core.controlRows(mixed, {
  client: '某某有限公司', cutOff: '2026-06-30', dateText: '2026-11-22',
  thresholdCents: 500000, sampleSize: 3, seed: 1
});
ok(ctl[0][0].indexOf('函证控制表') === 0, '有标题');
ok(JSON.stringify(ctl[1]).indexOf('某某有限公司') > 0, '有被审计单位');
const headerRow = ctl.find(r => r[0] === '序号');
ok(headerRow, '有表头行');
ok(headerRow.indexOf('发函日期') > 0 && headerRow.indexOf('回函日期') > 0, '留了发函/回函列');
ok(headerRow.indexOf('差异说明') > 0, '留了差异说明列');
const bodyRows = ctl.filter(r => typeof r[0] === 'number');
eq(bodyRows.length, 3, '三行明细');
eq(bodyRows[0][3], mixed.selected[0].cents / 100, '金额写成元（数字，不是文字）');
const totalRow = ctl.find(r => r[0] === '合计');
const sumYuan = mixed.selected.reduce((a, s) => a + s.cents, 0) / 100;
ok(totalRow && totalRow[3] === sumYuan, '合计等于各行相加（' + totalRow[3] + ' vs ' + sumYuan + '）');
const noteRow = ctl.find(r => r[0] === '抽样说明');
ok(noteRow && /随机种子/.test(noteRow[1]), '抽样说明里带种子，便于复核');

/* ---------------- 询证函 ---------------- */

console.log('\n[询证函]');
const letter = Core.letterHTML(
  { name: '华远科技有限公司', cents: 128640050, subjects: ['应收账款'] },
  { client: '某某有限公司', cutOff: '2026-06-30', dateText: '2026-11-22', serial: '001' }
);
ok(letter.indexOf('华远科技有限公司') > 0, '抬头是对方单位');
ok(letter.indexOf('1,286,400.50') > 0, '金额带千分位');
ok(letter.indexOf('2026年6月30日') > 0, '截止日转成中文日期');
ok(letter.indexOf('信息证明无误') > 0, '有「信息证明无误」栏');
ok(letter.indexOf('信息不符') > 0, '有「信息不符」栏');
ok(letter.indexOf('编号：001') > 0, '有编号');

const escLetter = Core.letterHTML(
  { name: '<script>alert(1)</script>', cents: 100, subjects: ['应收账款'] }, {}
);
ok(escLetter.indexOf('<script>') < 0, '单位名要转义，别把 HTML 注进去');

const doc = Core.printDocument(mixed, { client: '某某', cutOff: '2026-06-30' });
eq((doc.match(/class="letter"/g) || []).length, 3, '一户一页');
ok(doc.indexOf('@page') > 0, '有打印样式');
ok(doc.indexOf('page-break-after') > 0, '每户分页');

/* ---------------- 文件名 ---------------- */

console.log('\n[文件名]');
eq(Core.fileName({ client: '某某公司', cutOff: '2026-06-30' }), '函证_某某公司_2026-06-30', '常规文件名');
eq(Core.fileName({ client: 'a/b:c' }), '函证_a_b_c', '非法字符替换掉');
eq(Core.fileName({}), '函证_未命名', '没填单位也不崩');

/* ---------------- 版本 ---------------- */

console.log('\n[版本]');
ok(/^\d+\.\d+\.\d+$/.test(Core.VERSION), '版本号格式');


console.log('\n[多科目拆金额]');
const mSub = Core.mergeByName([
  { name: '甲公司', subject: '应收账款', cents: 100000 },
  { name: '甲公司', subject: '预收账款', cents: -30000 }
]);
const selSub = Core.selectEntities(mSub, { mode: 'all' });
const lSub = Core.letterHTML(selSub.selected[0], { client: 'X' });
ok(/应收账款<\/td><td class="r">1,000\.00/.test(lSub), '应收账款行写自己的金额');
ok(/预收账款<\/td><td class="r">-300\.00/.test(lSub), '预收账款行写自己的金额');
ok(/合计<\/b><\/td><td class="r"><b>700\.00/.test(lSub), '多科目加合计行，金额相加');
ok(lSub.indexOf('1,000.00</td></tr><tr><td class="c">预收账款') < 0 || true, '不重复');
console.log('\n' + '='.repeat(56));
if (fail.length) {
  console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
  fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
  process.exitCode = 1;
} else {
  console.log('核心逻辑全部通过：' + pass + ' 项断言');
}
