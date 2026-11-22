/**
 * 函证助手 · 第一轮审查修复回归
 * 每条对应审查员给出的真实反例；修好的标志是这条用例通过。
 */
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) {
  ok(a === b, msg + ' — 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

console.log('[1 客户编码不能当单位名称]');
const rows1 = [
  ['客户编码', '客户名称', '科目', '期末余额'],
  ['001', '华远科技有限公司', '应收账款', 1286400.5],
  ['002', '东方建设集团', '应收账款', 762000]
];
const h1 = Core.detectHeader(rows1);
eq(h1.nameCol, 1, '名称列是「客户名称」不是「客户编码」');
eq(h1.codeCol, 0, '「客户编码」当编码列');
const p1 = Core.parseRows(rows1, h1, { firstExcelRow: 1 });
eq(p1.entities[0].name, '华远科技有限公司', '读出来的是公司名');
const l1 = Core.letterHTML(p1.entities[0], {});
ok(l1.indexOf('致：华远科技有限公司') > 0, '函的抬头是公司名');
ok(l1.indexOf('001') < 0 || l1.indexOf('致：001') < 0, '抬头不是编码');

console.log('\n[2 合计行的各种写法]');
['合计', '合  计', '总计', '小计', '合计（人民币）', '合计(元)', '本期合计', '本页合计', '共　计'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认成合计行');
});
['华远科技有限公司', '合计贸易有限公司', '小计部'].forEach(function (n) {
  ok(!Core.isTotalName(n), '「' + n + '」不能被误判成合计行');
});
const rows2 = [
  ['单位名称', '期末余额'],
  ['甲公司', 1000],
  ['乙公司', 2000],
  ['合计（人民币）', 3000]
];
const p2 = Core.parseRows(rows2, Core.detectHeader(rows2), {});
eq(p2.entities.length, 2, '合计行不当单位');
eq(Core.mergeByName(p2.entities).reduce((a, e) => a + e.cents, 0), 300000, '总额是 3,000 不是 6,000');

console.log('\n[3 借方余额 / 贷方余额两列]');
const rows3 = [
  ['客户名称', '借方余额', '贷方余额'],
  ['甲', 1000, 0],
  ['乙', 0, 5000],
  ['丙', 800, 0]
];
const h3 = Core.detectHeader(rows3);
ok(h3.debitCol >= 0 && h3.creditCol >= 0, '认出借贷两列');
const p3 = Core.parseRows(rows3, h3, {});
const byName3 = {};
p3.entities.forEach(e => byName3[e.name] = e.cents);
eq(byName3['甲'], 100000, '甲的借方余额');
eq(byName3['乙'], -500000, '乙在贷方，是负数，不是 0');
eq(byName3['丙'], 80000, '丙的借方余额');
eq(p3.entities.reduce((a, e) => a + e.cents, 0), -320000, '净额 −3,200');

console.log('\n[4 科目空着的钱要有去处]');
const m4 = Core.mergeByName([
  { name: '华远', subject: '应收账款', cents: 100000000 },
  { name: '华远', subject: '', cents: 50000000 },
  { name: '华远', subject: '预收账款', cents: -30000000 }
]);
const s4 = Core.selectEntities(m4, { mode: 'all' });
const l4 = Core.letterHTML(s4.selected[0], {});
ok(l4.indexOf('未填科目') > 0, '空科目的钱单列成「未填科目」');
ok(l4.indexOf('500,000.00') > 0, '这笔钱在函里看得见');
const moneys4 = (l4.match(/<td class="r">(?:<b>)?[-\d,.]+/g) || []).map(s => s.replace(/<td class="r">(?:<b>)?/, ''));
const nums4 = moneys4.map(s => Core.toCents(s));
const detail4 = nums4.slice(0, -1).reduce((a, b) => a + b, 0);
eq(detail4, nums4[nums4.length - 1], '明细相加 = 合计（' + Core.moneyText(detail4) + '）');

console.log('\n[5 标题行含「单位」「余额」不能当表头]');
const rows5 = [
  ['往来单位期末余额表'],
  ['单位名称', '期末余额'],
  ['甲公司', 1000]
];
const h5 = Core.detectHeader(rows5);
eq(h5.rowIndex, 1, '表头在第 2 行，不是标题行');
eq(h5.nameCol, 0, '名称列');
eq(h5.amountCol, 1, '金额列');
const p5 = Core.parseRows(rows5, h5, {});
eq(p5.entities.length, 1, '能读出甲公司');

console.log('\n[6 方向列影响符号]');
const rows6 = [
  ['客户名称', '方向', '期末余额'],
  ['甲', '借', 1000],
  ['乙', '贷', 5000]
];
const h6 = Core.detectHeader(rows6);
ok(h6.dirCol >= 0, '认出方向列');
const p6 = Core.parseRows(rows6, h6, {});
const byName6 = {};
p6.entities.forEach(e => byName6[e.name] = e.cents);
eq(byName6['甲'], 100000, '借方是正数');
eq(byName6['乙'], -500000, '贷方是负数，不能一律当正数');

console.log('\n[7 零余额户不进随机抽样]');
const zeroPool = [
  { name: 'A', cents: 1000000 },
  { name: 'B', cents: 0 },
  { name: 'C', cents: 50000 }
];
const zeroSel = Core.selectEntities(zeroPool, { mode: 'mixed', thresholdCents: 100000, sampleSize: 3, seed: 1 });
ok(!zeroSel.selected.some(s => s.name === 'B'), '余额 0 的户不会被抽中去发 0.00 的函');
const allSel = Core.selectEntities(zeroPool, { mode: 'all' });
ok(allSel.selected.some(s => s.name === 'B'), '选「全部」时仍然给，由人决定');

console.log('\n[8 读取情况要进底稿]');
const ctl8 = Core.controlRows(s4, {
  client: '某公司', cutOff: '2026-06-30',
  notes: ['2 行的金额读不出，没有计入', '1 行有金额但没有单位名称'],
  excludedNames: ['华远', '东方']
});
const flat8 = JSON.stringify(ctl8);
ok(flat8.indexOf('读取情况') > 0, '底稿里有一块「读取情况」');
ok(flat8.indexOf('金额读不出') > 0, '具体问题写进去了');
ok(flat8.indexOf('人工排除') > 0, '排除名单写进去了');

console.log('\n[9 HTML 标题要转义]');
const doc9 = Core.printDocument(s4, { client: '</title><script>alert(1)</script>' });
ok(doc9.indexOf('<script>alert(1)') < 0, '标题里的脚本被转义');

console.log('\n[10 同种子同结果、不同种子不同组合]');
const pool10 = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => ({ name: n, cents: (i + 1) * 1000 }));
const run10 = seed => Core.selectEntities(pool10, { mode: 'sample', sampleSize: 2, seed }).selected.map(s => s.name).join(',');
eq(run10(7), run10(7), '同种子复现');
ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(run10)).size > 1, '不同种子确实不同');


console.log('\n[第二轮 1 借/贷两列在界面层也要能用]');
const h11 = Core.detectHeader([['客户名称', '借方余额', '贷方余额'], ['甲', 1000, 0]]);
eq(h11.usable, true, '借贷两列的表要标记为可用（usable）');
ok(h11.problems.length > 0, '但仍要提示「按借−贷合成净额」');
const h12 = Core.detectHeader([['客户名称', '借方余额'], ['甲', 1000]]);
eq(h12.usable, true, '只有一列借方余额也能用');
eq(h12.amountCol, 1, '单侧借方当金额列');
const h13 = Core.detectHeader([['客户名称', '借方发生额', '贷方发生额'], ['甲', 1000, 0]]);
eq(h13.debitCol, -1, '「借方发生额」不是余额列');
ok(h13.problems.some(p => /发生额/.test(p)), '用了发生额要提示');

console.log('\n[第二轮 2 合计的更多写法]');
['累计', '合计数', '合计额', '总额', '本年累计', '本期累计', '本期合计', '以上合计'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认成合计行');
});
['累计折旧', '合计贸易有限公司', '小计部'].forEach(function (n) {
  ok(!Core.isTotalName(n), '「' + n + '」不能误判');
});

console.log('\n[第二轮 4 标题行 + 单位：元]');
const h41 = Core.detectHeader([
  ['往来款项余额表', '', '', '单位：元'],
  ['单位名称', '期末余额'],
  ['甲', 5000]
]);
eq(h41.rowIndex, 1, '「单位：元」不参与评表头');
eq(h41.usable, true, '表可用');
const h42 = Core.detectHeader([['某某公司往来余额表', '金额单位：元'], ['单位名称', '期末余额'], ['甲', 1]]);
eq(h42.rowIndex, 1, '两列标题行也不挡路');

console.log('\n[第二轮 6 科目余额表要认出来并拒掉]');
const h61 = Core.detectHeader([['科目编码', '科目名称', '期末余额'], ['1002', '银行存款', 1000]]);
eq(h61.usable, false, '科目余额表不是往来表，不能拿去发函');
ok(h61.problems.some(p => /科目余额表/.test(p)), '要说清楚为什么');

console.log('\n[第二轮 7 纯随机也不抽 0 元户]');
const zeroSample = Core.selectEntities(
  [{ name: 'A', cents: 0 }, { name: 'B', cents: 100 }],
  { mode: 'sample', sampleSize: 2, seed: 1 }
);
ok(!zeroSample.selected.some(s => s.name === 'A'), '0 元户不进纯随机');

console.log('\n[第二轮 9 方向列与借贷两列不能双重取反]');
const h91 = Core.detectHeader([['客户名称', '方向', '借方余额', '贷方余额'], ['甲', '贷', 1000, 0]]);
ok(h91.problems.some(p => /方向列不再重复取反/.test(p)), '同时有两列时要提示');
console.log('\n' + '='.repeat(56));
if (fail.length) {
  console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
  fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
  process.exitCode = 1;
} else {
  console.log('第一轮修复回归全部通过：' + pass + ' 项断言');
}
