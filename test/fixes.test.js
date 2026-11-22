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

console.log('\n[第三轮 N1 期末余额借方/贷方两列]');
const n1 = Core.parseRows([
  ['客户名称', '期末余额借方', '期末余额贷方'],
  ['甲', '-', '1,000.00'],
  ['乙', '800.00', '-']
], Core.detectHeader([
  ['客户名称', '期末余额借方', '期末余额贷方'],
  ['甲', '-', '1,000.00'],
  ['乙', '800.00', '-']
]), {});
eq(n1.entities.filter(e => e.name === '甲')[0].cents, -100000, '贷方那格是负数，不是 0');
eq(n1.entities.filter(e => e.name === '乙')[0].cents, 80000, '借方那格是正数');

console.log('\n[第三轮 N3 裸「单位」是列名]');
const n3 = Core.detectHeader([['单位', '期末余额'], ['华远', 1000]]);
eq(n3.rowIndex, 0, '裸「单位」能当表头');
eq(n3.usable, true, '能用');
const n3b = Core.detectHeader([['往来表', '', '', '单位：元'], ['单位名称', '期末余额'], ['甲', 1]]);
eq(n3b.rowIndex, 1, '「单位：元」仍然跳过');

console.log('\n[第三轮 N4 辅助核算余额表不能误拒]');
const n4 = Core.detectHeader([['科目编码', '科目名称', '客户名称', '期末余额'], ['1002', '银行存款', '华远', 1000]]);
eq(n4.usable, true, '带客户名称的辅助核算表能用');
eq(n4.nameCol, 2, '名称列取「客户名称」不是「科目名称」');

console.log('\n[第三轮 N6 科目余额表变体]');
const n6 = Core.detectHeader([['科目编码', '名称', '期末余额'], ['1002', '银行存款', 1000]]);
eq(n6.usable, false, '科目编码 + 名称 也要认成科目表');

console.log('\n[第三轮 N5 借贷一格读不出不能当 0]');
const n5rows = [['客户名称', '借方余额', '贷方余额'], ['甲', '待核实', 5000]];
const n5 = Core.parseRows(n5rows, Core.detectHeader(n5rows), { firstExcelRow: 1 });
eq(n5.entities.length, 0, '这一行不能算成 −5,000');
ok(n5.skipped.some(s => s.reason === '金额读不出'), '要报出来');

console.log('\n[第三轮 N8 单侧贷方余额记负数]');
const n8rows = [['客户名称', '贷方余额'], ['甲', 8000]];
const n8 = Core.parseRows(n8rows, Core.detectHeader(n8rows), {});
eq(n8.entities[0].cents, -800000, '贷方余额是负数');
const n8b = Core.parseRows([['客户名称', '借方余额'], ['甲', 8000]], Core.detectHeader([['客户名称', '借方余额'], ['甲', 8000]]), {});
eq(n8b.entities[0].cents, 800000, '借方余额是正数');

console.log('\n[第三轮 N9 合计写法（带元/期间前缀）]');
['累计（元）', '总额（元）', '本月合计', '本年度合计', '上期合计', '以上合计'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认');
});

console.log('\n[第三轮 N7 发生额要提示]');
const n7 = Core.detectHeader([['客户名称', '借方发生额', '贷方发生额'], ['甲', 1000, 200]]);
ok(n7.problems.some(p => /发生额/.test(p)), '用了发生额要明说');

console.log('\n[第四轮 N1 流水账要拒]');
const f1rows = [
  ['日期', '客户名称', '摘要', '借方金额', '贷方金额', '余额'],
  ['2026-01-05', '华远', '收款', 1000, 0, 1000],
  ['2026-02-05', '华远', '收款', 500, 0, 1500]
];
const f1 = Core.detectHeader(f1rows);
eq(f1.usable, false, '流水账不能当往来余额表');
ok(f1.problems.some(p => /流水账/.test(p)), '要说清楚这是流水账');

console.log('\n[第四轮 N2 期初余额不能直接发函]');
const f2rows = [['客户名称', '期初余额'], ['华远', 900]];
const f2 = Core.detectHeader(f2rows);
eq(f2.usable, false, '只有期初余额时不能直接出函');
ok(f2.problems.some(p => /期初余额/.test(p)), '要提示期初不是期末');

console.log('\n[第四轮 N3 合计写法（旧版能认的不能丢）]');
['合计金额', '总计金额', '累计数', '合计数额', '合计本页', '合计 金额'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认成合计行');
});

console.log('\n[第四轮 N4 四列只取期末那对]');
const f4rows = [
  ['科目编码', '科目名称', '客户名称', '期初借方余额', '期初贷方余额', '期末借方余额', '期末贷方余额'],
  ['1002', '银行存款', '华远', 100, 0, 150, 0],
  ['1002', '银行存款', '东方', 0, 200, 0, 250]
];
const f4 = Core.parseRows(f4rows, Core.detectHeader(f4rows), {});
eq(f4.entities.filter(e => e.name === '华远')[0].cents, 15000, '华远取期末 150，不是期初 100');
eq(f4.entities.filter(e => e.name === '东方')[0].cents, -25000, '东方取期末 −250');

console.log('\n[第四轮 N5 期末余额 + 贷方余额 不能互相覆盖]');
const f5rows = [['客户名称', '期末余额', '贷方余额'], ['华远', 1000, 30], ['东方', 2000, 0]];
const f5 = Core.parseRows(f5rows, Core.detectHeader(f5rows), {});
eq(f5.entities.filter(e => e.name === '华远')[0].cents, 100000, '华远 = 1,000');
eq(f5.entities.filter(e => e.name === '东方')[0].cents, 200000, '东方 = 2,000');

console.log('\n[第四轮 N6 「余额方向」不是金额列]');
const f6rows = [['客户名称', '余额方向', '余额'], ['甲', '借', 1000], ['乙', '贷', 500]];
const f6 = Core.parseRows(f6rows, Core.detectHeader(f6rows), {});
eq(f6.entities.filter(e => e.name === '甲')[0].cents, 100000, '甲 1,000');
eq(f6.entities.filter(e => e.name === '乙')[0].cents, -50000, '乙 −500（方向列生效）');

console.log('\n[第四轮 N7 两级表头取期末那对]');
const f7rows = [
  ['客户名称', '期初余额', '', '本期发生额', '', '期末余额', ''],
  ['', '借方', '贷方', '借方', '贷方', '借方', '贷方'],
  ['甲', 0, 0, 0, 0, 0, 300],
  ['乙', 0, 0, 0, 0, 400, 0]
];
const f7h = Core.detectHeader(f7rows);
eq(f7h.span, 2, '认出两级表头');
const f7 = Core.parseRows(f7rows, f7h, {});
eq(f7.entities.filter(e => e.name === '甲')[0].cents, -30000, '甲 = −300（期末贷方）');
eq(f7.entities.filter(e => e.name === '乙')[0].cents, 40000, '乙 = 400（期末借方）');

console.log('\n[第五轮 1 只写「金额」的列不能被当成发生额]');
[['单位名称', '期末金额'], ['单位名称', '金额'], ['客户名称', '应收金额'],
 ['客户名称', '金额（元）'], ['客户名称', '期末金额（元）']].forEach(function (h) {
  const hh = Core.detectHeader([h, [h[0] === '单位名称' ? '甲' : '华远', 1286400.5]]);
  eq(hh.usable, true, '「' + h[1] + '」应该能用');
  eq(hh.amountKind, '余额', '「' + h[1] + '」是余额不是发生额');
});

console.log('\n[第五轮 2 两级表头的发生额不能被当余额]');
const f2h = Core.detectHeader([
  ['客户名称', '本期发生额', ''],
  ['', '借方', '贷方'],
  ['甲', 1000, 200]
]);
eq(f2h.usable, false, '两级表头里是发生额 → 不能发函');

console.log('\n[第五轮 3 没有借贷列的流水账也要拒]');
const f3rows = [
  ['日期', '客户名称', '摘要', '金额', '余额'],
  ['2026-01-05', '华远', '收款', 1000, 1000],
  ['2026-02-05', '华远', '收款', 500, 1500]
];
const f3 = Core.detectHeader(f3rows);
eq(f3.usable, false, '逐笔余额相加会翻倍，必须拒');
ok(f3.problems.some(p => /流水账/.test(p)), '说明是流水账');

console.log('\n[第五轮 4 带「业务员」列的余额表不能误拒]');
const f5salesRows = [
  ['客户名称', '期初余额', '本期借方', '本期贷方', '期末余额', '业务员'],
  ['甲', 100, 300, 0, 400, '张三']
];
const f5salesH = Core.detectHeader(f5salesRows);
eq(f5salesH.usable, true, '业务员是人员列，不是流水标志');
const f5salesP = Core.parseRows(f5salesRows, f5salesH, {});
eq(f5salesP.entities[0].cents, 40000, '取期末 400');

console.log('\n[第五轮 附：裸「名称」当科目表]');
eq(Core.detectHeader([['名称', '期末余额'], ['银行存款', 100]]).usable, false, '「名称」单独出现不当往来表');
eq(Core.detectHeader([['单位名称', '期末余额'], ['甲', 100]]).usable, true, '「单位名称」照常');

console.log('\n[第六轮 1 期间类金额列是流水，不是余额]');
const s1 = Core.detectHeader([['客户名称', '本期增加', '本期减少'], ['华远', 1000, 200]]);
eq(s1.usable, false, '本期增加/减少不是余额');

console.log('\n[第六轮 2 「余额」列不能被左边的金额列顶掉]');
const s2a = Core.parseRows([['客户名称', '本月金额', '余额'], ['华远', 500, 1500]],
  Core.detectHeader([['客户名称', '本月金额', '余额'], ['华远', 500, 1500]]), {});
eq(s2a.entities[0].cents, 150000, '取余额 1,500，不取本月金额 500');
const s2b = Core.parseRows([['客户名称', '开票金额', '已收金额', '余额'], ['华远', 1800, 1000, 800]],
  Core.detectHeader([['客户名称', '开票金额', '已收金额', '余额'], ['华远', 1800, 1000, 800]]), {});
eq(s2b.entities[0].cents, 80000, '取余额 800');

console.log('\n[第六轮 3 带日期列的正常余额表不能拒]');
const s3 = Core.detectHeader([['客户名称', '最后交易日期', '期末余额'], ['华远', '2026-05-20', 1286400.5]]);
eq(s3.usable, true, '一行一户 + 日期列不是流水账');
const s3b = Core.detectHeader([['日期', '客户名称', '摘要', '金额', '余额'], ['2026-01-05', '华远', '收款', 1000, 1000]]);
eq(s3b.usable, false, '日期 + 金额 + 余额 才是流水账');

console.log('\n[第六轮 4 科目名称列要进控制表的科目]');
const r6rows = [['客户名称', '科目名称', '期末余额'], ['华远', '应收账款', 1000]];
const r6h = Core.detectHeader(r6rows);
eq(r6h.subjectCol, 1, '科目名称列被认成科目列');
const r6p = Core.parseRows(r6rows, r6h, {});
eq(r6p.entities[0].subject, '应收账款', '科目带出来了');

console.log('\n[第六轮 5 两个方向列取期末那个]');
const s5rows = [['客户名称', '期初方向', '期初余额', '期末方向', '期末余额'], ['华远', '借', 0, '贷', 1000]];
const s5 = Core.parseRows(s5rows, Core.detectHeader(s5rows), {});
eq(s5.entities[0].cents, -100000, '按期末方向（贷）取负数');

console.log('\n[第六轮 6 非元单位一律拒绝，不自动换算]');
const s6rows = [['往来余额表（单位：万元）'], ['单位名称', '期末余额'], ['华远', 128.64]];
const s6h = Core.detectHeader(s6rows);
eq(s6h.usable, false, '万元单位的表要拒绝（自动换算猜错就是一万倍）');
ok(s6h.problems.some(p => /万元/.test(p)), '要说清楚是单位的问题');

console.log('\n[第七轮 1 非元单位一律拒绝]');
const u1 = Core.detectHeader([['往来余额表（单位：元）'], ['注：超过100万元的客户请重点函证'], ['单位名称', '期末余额'], ['华远', 1286400.5]]);
eq(u1.usable, false, '正文提到「万元」也一律拒——宁可多问一句，不能差一万倍');
const u2 = Core.detectHeader([['往来余额表（单位：万元）'], ['单位名称', '期末余额'], ['华远', 128.64]]);
eq(u2.usable, false, '标题写万元要拒绝');
const u3 = Core.detectHeader([['往来余额表', '', '', '单位：千元'], ['单位名称', '期末余额'], ['华远', 128.64]]);
eq(u3.usable, false, '标题行里的「单位：千元」也要拒绝，不能把它当名称列');

console.log('\n[第七轮 2 宽表多列余额要拒绝，不能猜]');
const w1 = Core.detectHeader([['客户名称', '应收账款余额', '预收账款余额', '其他应收余额'], ['华远', 1000, -200, 50]]);
eq(w1.usable, false, '三列余额并列，分不清该函哪列');
ok(w1.problems.some(p => /分不清/.test(p)), '要说明为什么');
const w2 = Core.detectHeader([['客户名称', '坏账准备余额', '期末余额'], ['华远', -50, 1000]]);
eq(w2.usable, true, '有总的「期末余额」列时照常可用');

console.log('\n[第七轮 3 名称区块沿用，金额绝不沿用]');
const blkRows = [['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000], ['', '预收账款', -300], ['东方', '应收账款', 500]];
const blk = Core.parseRows(blkRows, Core.detectHeader(blkRows), {});
const blkM = Core.mergeByName(blk.entities);
eq(blkM.filter(e => e.name === '华远')[0].cents, 70000, '华远 700（1,000 − 300）');
eq(blkM.length, 2, '还是两家（空名称沿用华远）');
const f3b = Core.parseRows([['单位名称', '期末余额'], ['', 500]], Core.detectHeader([['单位名称', '期末余额'], ['', 500]]), {});
eq(f3b.entities.length, 0, '开头没名字的行不猜');

console.log('\n[第七轮 4 日期 + 期初 + 期末是余额表，不是流水]');
const d1 = Core.detectHeader([['客户名称', '最后交易日期', '期初余额', '期末余额'], ['华远', '2026-05-20', 800, 1000]]);
eq(d1.usable, true, '带日期的两列余额表可以用');
const d2 = Core.detectHeader([['日期', '客户名称', '摘要', '金额', '余额'], ['2026-01-05', '华远', '收款', 1000, 1000]]);
eq(d2.usable, false, '日期 + 金额 + 余额 才是流水');


console.log('\n[第八轮 1 合计写在编码列/科目列，不能加到最后一户]');
const t1rows = [['客户编码', '客户名称', '期末余额'], ['001', '华远', 1000], ['002', '东方', 500], ['合计', '', 1500]];
const t1 = Core.mergeByName(Core.parseRows(t1rows, Core.detectHeader(t1rows), {}).entities);
eq(t1.filter(e => e.name === '东方')[0].cents, 50000, '东方 500，不是 2,000');
const t1b = [['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000], ['东方', '应收账款', 500], ['', '合计', 1500]];
const t1bm = Core.mergeByName(Core.parseRows(t1b, Core.detectHeader(t1b), {}).entities);
eq(t1bm.filter(e => e.name === '东方')[0].cents, 50000, '合计在科目列也一样跳过');

console.log('\n[第八轮 2 日期 + 单列「金额」是流水]');
eq(Core.detectHeader([['日期', '客户名称', '摘要', '金额'], ['2026-01-05', '华远', '收款', 1000]]).usable, false,
  '单列金额的流水账也要拒');

console.log('\n[第八轮 3 万元声明的各种写法都要拦住]');
const uu1 = Core.detectHeader([['往来余额表'], ['注：本表金额单位为万元'], ['单位名称', '期末余额'], ['华远', 128.64]]);
eq(uu1.usable, false, '「金额单位为万元」要拒');
const uu2 = Core.detectHeader([['客户名称', '期末余额（万元）'], ['华远', 128.64]]);
eq(uu2.usable, false, '列名后缀（万元）要拒');
const uu3 = Core.detectHeader([['单位名称', '期末余额'], ['华远', 1286400.5], ['单位：万元']]);
eq(uu3.usable, false, '页脚的单位声明也要拒');
const uu4 = Core.detectHeader([['往来余额表（单位：元）'], ['注：超过100万元的客户请重点函证'], ['单位名称', '期末余额'], ['华远', 1286400.5]]);
eq(uu4.usable, false, '正文提到「万元」也拒（保守口径）');

console.log('\n[第八轮 4 期初 + 期末（元）不能用「分不清」拒掉]');
const g1 = Core.detectHeader([['客户名称', '期初余额', '期末余额（元）'], ['华远', 800, 1000]]);
eq(g1.usable, true, '期末余额（元）算通用列');
const g2 = Core.detectHeader([['客户名称', '年初余额', '年末余额'], ['华远', 800, 1000]]);
eq(g2.usable, true, '年初 + 年末是一对期间，不是多列科目余额');
const g3 = Core.detectHeader([['客户名称', '应收账款余额', '预收账款余额'], ['华远', 1000, -200]]);
eq(g3.usable, false, '真的多列科目余额仍然要拒');

console.log('\n[第八轮 5 科目留空要记「未填科目」，不能顶上一行的科目]');
const e5rows = [['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000000], ['', '预收账款', -300000], ['', '', 200000]];
const e5parse = Core.parseRows(e5rows, Core.detectHeader(e5rows), {});
const e5m = Core.mergeByName(e5parse.entities);
eq(e5m[0].cents, 90000000, '合计 900,000 不变');
eq(e5m[0].noSubjectCents, 20000000, '200,000 记到「未填科目」，不顶预收账款');

console.log('\n[第八轮 6 金蝶「核算项目」是往来单位]');
const k1 = Core.detectHeader([['核算项目', '期末余额'], ['华远科技有限公司', 1000]]);
eq(k1.usable, true, '核算项目当名字列');
eq(k1.nameCol, 0, '名字列就是核算项目');
const k2 = Core.detectHeader([['科目编码', '科目名称', '核算项目', '期末余额'], ['1122', '应收账款', '华远', 1000]]);
eq(k2.usable, true, '带科目编码的辅助核算表也能用');


console.log('\n[第九轮 1 合计行标签的各种写法]');
['合计', '合计（人民币元）', '合计人民币元', '合计（单位：元）', '应收账款小计', '应收账款合计',
 '人民币合计', '合计（本位币）', '合计（原币）', '本页合计', '合计数额', '累计数'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认成合计行');
});
['合计贸易有限公司', '华远科技有限公司', '应收账款', '预收账款'].forEach(function (n) {
  ok(!Core.isTotalName(n), '「' + n + '」是名字，不是合计行');
});
const r9rows = [['客户名称', '科目', '期末余额'], ['华远', '应收账款', 1000], ['东方', '应收账款', 500], ['', '应收账款合计', 1500]];
const r9m = Core.mergeByName(Core.parseRows(r9rows, Core.detectHeader(r9rows), {}).entities);
eq(r9m.filter(e => e.name === '东方')[0].cents, 50000, '合计（写科目列）不再加到东方');

console.log('\n[第九轮 2 人民币万元的各种写法]');
const r9u1 = Core.detectHeader([['往来表'], ['金额单位：人民币万元'], ['单位名称', '期末余额'], ['华远', 128.64]]);
eq(r9u1.usable, false, '「金额单位：人民币万元」要拒');
const r9u2 = Core.detectHeader([['客户名称', '期末余额（人民币万元）'], ['华远', 128.64]]);
eq(r9u2.usable, false, '列名带人民币万元要拒');
const r9u3 = Core.detectHeader([['单位名称', '期末余额'], ['华远', 128.64], ['单位：人民币万元']]);
eq(r9u3.usable, false, '页脚人民币万元要拒');
const r9u4 = Core.detectHeader([['往来表', '', ''], ['金额单位', '万元'], ['单位名称', '期末余额'], ['华远', 128.64]]);
eq(r9u4.usable, false, '拆成两格也要拒');
const r9u5 = Core.detectHeader([['往来表'], ['金额单位：人民币元'], ['单位名称', '期末余额'], ['华远', 1286400.5]]);
eq(r9u5.usable, true, '「人民币元」是正常单位');

console.log('\n[第九轮 3 核算项目编码/类别不能当名字]');
const r9k1 = Core.detectHeader([['核算项目编码', '核算项目名称', '科目', '期末余额'], ['001', '华远', '应收账款', 1000]]);
eq(r9k1.nameCol, 1, '名字取「核算项目名称」，不是编码');
const r9k2 = Core.detectHeader([['核算项目类别', '核算项目编码', '核算项目名称', '期末余额'], ['客户', '001', '华远', 1000]]);
eq(r9k2.nameCol, 2, '类别和编码都跳过');

console.log('\n[第九轮 4 借贷表的格式空行不能被报成金额读不出]');
const r9b4rows = [['客户名称', '借方余额', '贷方余额'], ['甲', 1000, 0], ['乙', 0, 500]];
for (let i = 0; i < 20; i++) r9b4rows.push(['', '', '']);
const r9b4 = Core.parseRows(r9b4rows, Core.detectHeader(r9b4rows), {});
eq(Core.mergeByName(r9b4.entities).length, 2, '两户');
eq(r9b4.skipped.filter(x => x.reason === '金额读不出').length, 0, '空行不算读不出');

console.log('\n[第九轮 5 控制表科目列要写「未填科目」]');
const r9e5rows = [['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000000], ['', '预收账款', -300000], ['', '', 200000]];
const r9e5res = Core.selectEntities(Core.mergeByName(Core.parseRows(r9e5rows, Core.detectHeader(r9e5rows), {}).entities), { mode: 'all' });
const r9e5ctl = Core.controlRows(r9e5res, {});
const r9e5row = r9e5ctl.filter(r => r && r[1] === '华远')[0];
ok(r9e5row && /未填科目/.test(String(r9e5row[2])), '控制表科目要包含「未填科目」（实际：' + (r9e5row ? r9e5row[2] : '无') + '）');

console.log('\n[第九轮 6 逐笔「余额」台账要拒]');
eq(Core.detectHeader([['客户名称', '摘要', '余额'], ['华远', '收款', 1000], ['华远', '收款', 1500]]).usable, false,
  '摘要 + 单个「余额」+ 同一户多行是逐笔台账');
eq(Core.detectHeader([['客户名称', '摘要', '期末余额'], ['华远', '往来', 1000]]).usable, true,
  '摘要 + 期末余额 仍然可用');


console.log('\n[第十轮 1 逐笔台账带科目列也要拦]');
eq(Core.detectHeader([['客户名称', '摘要', '科目', '余额'], ['华远', '收款', '应收账款', 1000], ['华远', '收款', '应收账款', 1500]]).usable, false,
  '带科目列的逐笔台账也是台账');
eq(Core.detectHeader([['日期', '客户名称', '摘要', '科目', '余额'], ['2026-01-05', '华远', '收款', '应收账款', 1000], ['2026-02-05', '华远', '收款', '应收账款', 1500]]).usable, false,
  '带日期和科目也要拦');

console.log('\n[第十轮 2 裸「（万元）」也要认]');
eq(Core.detectHeader([['往来款项余额表', '', '', '（万元）'], ['单位名称', '期末余额'], ['华远', 128.64]]).usable, false,
  '标题格单独写（万元）要拒');
eq(Core.detectHeader([['单位名称', '期末余额', '（万元）'], ['华远', 128.64]]).usable, false,
  '表头尾格写（万元）要拒');
eq(Core.detectHeader([['单位名称', '期末余额', '（万元）'], ['华远', 1286400.5]]).usable, false,
  '千元百万元同理');

console.log('\n[第十轮 3 备注「价税合计」不能把整户丢掉]');
const r10rows = [['单位名称', '科目', '备注', '期末余额'],
  ['华远', '应收账款', '价税合计', 1286400.5],
  ['东方', '应收账款', '已对账', 762000]];
const r10h = Core.detectHeader(r10rows);
const r10p = Core.parseRows(r10rows, r10h, {});
const r10m = Core.mergeByName(r10p.entities);
eq(r10m.length, 2, '两户都在');
eq(r10m.filter(e => e.name === '华远')[0].cents, 128640050, '华远 1,286,400.50 没被当合计行');
eq(r10p.skipped.filter(x => x.reason === '合计行').length, 0, '没有行被误判成合计行');

console.log('\n[第十轮 附：真正的合计行还是跳过]');
const r10b = Core.parseRows([['客户名称', '期末余额'], ['华远', 1000], ['东方', 500], ['合计', 1500]],
  Core.detectHeader([['客户名称', '期末余额'], ['华远', 1000], ['东方', 500], ['合计', 1500]]), {});
eq(Core.mergeByName(r10b.entities).length, 2, '合计行不进清单');
eq(r10b.skipped.filter(x => x.reason === '合计行').length, 1, '合计行被记一笔');


console.log('\n[第十一轮 1 合计行不看标签写在哪一列，看数据]');
[
  [['单位名称', '业务员', '期末余额'], ['华远', '张三', 1000], ['东方', '李四', 500], ['', '合计', 1500]],
  [['单位名称', '账龄', '期末余额'], ['华远', '1年', 1000], ['东方', '2年', 500], ['', '合计', 1500]],
  [['单位名称', '借方余额', '贷方余额', '备注'], ['华远', 1000, 0, ''], ['东方', 0, 500, ''], ['', 1000, 500, '合计']]
].forEach(function (rows, i) {
  const m = Core.mergeByName(Core.parseRows(rows, Core.detectHeader(rows), {}).entities);
  eq(m.length, 2, '合计行不能变成一户（第 ' + (i + 1) + ' 张）');
  eq(m.filter(e => e.name === '东方')[0].cents, i === 2 ? -50000 : 50000,
    '东方金额不含合计（第 ' + (i + 1) + ' 张）');
});

console.log('\n[第十一轮 1b 同一户两笔相同金额不能被当合计行]');
const two = Core.parseRows([['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000], ['', '预收账款', 1000]],
  Core.detectHeader([['单位名称', '科目', '期末余额'], ['华远', '应收账款', 1000], ['', '预收账款', 1000]]), {});
eq(Core.mergeByName(two.entities)[0].cents, 200000, '两笔各 1,000 要相加，不能跳过');

console.log('\n[第十一轮 2 余额列的修饰写法也要判台账]');
eq(Core.detectHeader([['客户名称', '日期', '摘要', '科目', '余额（元）'], ['华远', '01-05', '收款', '应收账款', 1000], ['华远', '02-05', '收款', '应收账款', 2300]]).usable, false,
  '「余额（元）」也是台账');
eq(Core.detectHeader([['客户名称', '摘要', '本币余额'], ['华远', '收款', 1000], ['华远', '收款', 2300]]).usable, false, '「本币余额」也是台账');
eq(Core.detectHeader([['客户名称', '摘要', '期末余额（元）'], ['华远', '往来', 1000]]).usable, true, '期末余额仍然可用');

console.log('\n[第十一轮 3 万元标记的其他括号]');
[['【万元】'], ['（万元）：'], ['[万元]'], ['〔万元〕']].forEach(function (cell) {
  eq(Core.detectHeader([['往来表', '', '', cell[0]], ['单位名称', '期末余额'], ['华远', 128.64]]).usable, false,
    cell[0] + ' 要拒');
});

console.log('\n[第十一轮 4 日期 + 本期发生额 + 期末余额 不是流水]');
eq(Core.detectHeader([['客户名称', '最后交易日期', '本期发生额', '期末余额'], ['华远', '2026-05-20', 300, 1000]]).usable, true,
  '有余额列就不是流水');
eq(Core.detectHeader([['日期', '客户名称', '摘要', '借方发生额', '贷方发生额'], ['2026-01-05', '华远', '收款', 1000, 0]]).usable, false,
  '只有借贷两栏才是流水');


console.log('\n[第十二轮 1 万元的各种写法：出现就拒]');
[['金额单位：（人民币）万元'], ['（人民币）万元'], ['单位：万'], ['金额（万）'], ['（亿元）'],
 ['（人民币）千元'], ['人民币：万元'], ['单位：人民币（万元）']].forEach(function (cell) {
  eq(Core.detectHeader([['往来表', '', '', cell[0]], ['单位名称', '期末余额'], ['华远', 128.64]]).usable, false,
    cell[0] + ' 要拒');
});
eq(Core.detectHeader([['单位名称', '期末余额'], ['华远', 128.64]], '往来余额（万元）').usable, false,
  '工作表名里的万元也要拒');

console.log('\n[第十二轮 2 合计（本币）不能变成幽灵户]');
['合计（本币）', '小计（本币）', '合计（折人民币）', '合计（折合）', '合计（含税）', '合计（大写）'].forEach(function (n) {
  ok(Core.isTotalName(n), '「' + n + '」要认成合计行');
});
const w12rows = [['单位名称', '期末余额'], ['华远', 1000], ['东方', 500], ['合计（本币）', 1500]];
const w12m = Core.mergeByName(Core.parseRows(w12rows, Core.detectHeader(w12rows), {}).entities);
eq(w12m.length, 2, '合计（本币）不能成为第三户');
eq(w12m.filter(e => e.name === '东方')[0].cents, 50000, '东方 500');

console.log('\n[第十二轮 3 同额留空行不能静默吞掉]');
const w13rows = [['单位名称', '期末余额'], ['华远', 1000], ['', 1000], ['东方', 500]];
const w13h = Core.detectHeader(w13rows);
const w13p = Core.parseRows(w13rows, w13h, {});
eq(w13p.ambiguous.length, 1, '分不清的行要记下来');
eq(w13h.usable, false, '而且整表拒绝，不能猜');

console.log('\n[第十二轮 4 合计有尾差也要跳过]');
const w14rows = [['单位名称', '业务员', '期末余额'], ['华远', '张三', 1000], ['东方', '李四', 500], ['', '合计', 1500.01]];
const w14m = Core.mergeByName(Core.parseRows(w14rows, Core.detectHeader(w14rows), {}).entities);
eq(w14m.filter(e => e.name === '东方')[0].cents, 50000, '尾差合计不加到东方');

console.log('\n[第十二轮 5 借贷两列表加摘要列不是流水]');
eq(Core.detectHeader([['客户名称', '摘要', '借方余额', '贷方余额'], ['华远', '往来', 1000, 0]]).usable, true,
  '借方余额/贷方余额也是余额列');

console.log('\n[第十二轮 6 一行一户的「余额」不算台账]');
eq(Core.detectHeader([['客户名称', '最后交易日期', '余额'], ['华远', '2026-05-20', 1000]]).usable, true,
  '一行一户带日期仍是余额表');
eq(Core.detectHeader([['客户名称', '摘要', '余额'], ['华远', '收款', 1000], ['华远', '收款', 1500]]).usable, false,
  '同一户多行才是台账');

console.log('\n' + '='.repeat(56));
if (fail.length) {
  console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
  fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
  process.exitCode = 1;
} else {
  console.log('第一轮修复回归全部通过：' + pass + ' 项断言');
}
