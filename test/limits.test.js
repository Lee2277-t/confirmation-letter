/**
 * 函证助手 · 异常输入
 * 审计工具最怕的不是算错，是算错了还说没事。
 */
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) {
  ok(a === b, msg + ' — 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

console.log('[空表 / 空行]');
const empty = Core.detectHeader([]);
eq(empty.rowIndex, -1, '空表认不出表头');
ok(empty.problems.length > 0, '空表要说明原因');

const onlyBlank = Core.detectHeader([[], [], []]);
eq(onlyBlank.rowIndex, -1, '全空行认不出表头');

const p0 = Core.parseRows([], { rowIndex: -1, nameCol: -1, amountCol: -1, problems: ['没有表头'] }, {});
eq(p0.entities.length, 0, '没有表头解析出 0 行');
ok(p0.problems.indexOf('没有表头') >= 0, '原因透传');

console.log('\n[没有表头的表不能被当成有表头]');
const noName = [['摘要', '金额'], ['买东西', 100]];
const hn = Core.detectHeader(noName);
eq(hn.rowIndex, -1, '只有摘要+金额，不算往来表');
ok(hn.problems.some(p => /名称/.test(p)), '要说明缺名称列');

console.log('\n[金额是各种脏数据]');
const dirty = [
  ['单位名称', '期末余额'],
  ['甲', '1,200.005'],
  ['乙', ' ＃REF! '],
  ['丙', '#DIV/0!'],
  ['丁', '  -  '],
  ['戊', '12,34'],
  ['己', true],
  ['庚', -0]
];
const hd = Core.detectHeader(dirty);
const pd = Core.parseRows(dirty, hd, { firstExcelRow: 1 });
eq(pd.entities.length, 3, '甲（四舍五入到分）、丁（破折号=0）、庚（0）能读出来');
ok(pd.entities.some(e => e.name === '甲' && e.cents === 120001), '三位小数四舍五入到分');
ok(pd.entities.some(e => e.name === '丁' && e.cents === 0), '破折号当 0');
eq(pd.skipped.filter(s => s.reason === '金额读不出').length, 4, '乙丙戊己读不出，要报 4 行');

console.log('\n[负数与零]');
const negRows = [
  ['单位名称', '期末余额'],
  ['甲', -1000],
  ['乙', 0],
  ['丙', '（2000）']
];
const pn = Core.parseRows(negRows, Core.detectHeader(negRows), {});
eq(pn.entities.length, 3, '负数、零、括号负数都要读出来');
eq(pn.entities.filter(e => e.name === '丙')[0].cents, -200000, '括号是负数');

const selZero = Core.selectEntities(
  Core.mergeByName(pn.entities),
  { mode: 'threshold', thresholdCents: 100 }
);
eq(selZero.count, 2, '阈值按绝对值：甲 1,000、丙 2,000 都过 1 元线');
ok(selZero.selected.some(s => s.name === '丙' && s.cents < 0), '负数那户在选中列表里');

console.log('\n[超长名称与特殊字符]');
const longName = 'Ａ'.repeat(300);
const longRows = [['单位名称', '期末余额'], [longName, 100]];
const pl = Core.parseRows(longRows, Core.detectHeader(longRows), {});
eq(pl.entities.length, 1, '超长名称能读');
const letterLong = Core.letterHTML({ name: longName, cents: 100, subjects: [] }, {});
ok(letterLong.length > 300, '函里带上了全名');
ok(letterLong.indexOf('<script>') < 0, '没有标签注入');

console.log('\n[表头行在很下面]');
const deep = [];
for (let i = 0; i < 15; i++) deep.push(['说明文字 ' + i]);
deep.push(['单位名称', '期末余额']);
deep.push(['甲', 100]);
const hDeep = Core.detectHeader(deep);
eq(hDeep.rowIndex, 15, '第 16 行才是表头也能找到');
const pDeep = Core.parseRows(deep, hDeep, { firstExcelRow: 1 });
eq(pDeep.entities.length, 1, '数据行照读');
eq(pDeep.entities[0].srcRow, 17, '原始行号是 17（Excel 里的第 17 行）');

console.log('\n[列顺序打乱 / 多余列]');
const shuffled = [
  ['备注', '期末余额', '客户名称', '经办人'],
  ['x', 500, '甲公司', '张三']
];
const hs = Core.detectHeader(shuffled);
eq(hs.nameCol, 2, '名称在第 3 列');
eq(hs.amountCol, 1, '金额在第 2 列');
const ps = Core.parseRows(shuffled, hs, {});
eq(ps.entities[0].name, '甲公司', '按列位置取值，不按位置猜');
eq(ps.entities[0].cents, 50000, '金额对');

console.log('\n[选样的边界]');
const one = Core.selectEntities([{ name: 'A', cents: 100 }], { mode: 'mixed', thresholdCents: 0, sampleSize: 5 });
eq(one.count, 1, '只有一户时不会造出多余的');
const negSize = Core.selectEntities([{ name: 'A', cents: 100 }], { mode: 'sample', sampleSize: -3 });
eq(negSize.count, 0, '负数户数当 0，不报错');
const badThr = Core.selectEntities([{ name: 'A', cents: 100 }], { mode: 'threshold', thresholdCents: undefined });
eq(badThr.count, 1, '阈值缺省当 0，全部过线');

console.log('\n[控制表在空结果时不崩]');
const emptyResult = Core.selectEntities([], { mode: 'all' });
const ctl = Core.controlRows(emptyResult, { client: '', cutOff: '' });
ok(Array.isArray(ctl), '空结果也能出控制表');
ok(ctl.find(r => r[0] === '合计'), '有合计行');

console.log('\n[打印文档在空结果时不崩]');
const doc = Core.printDocument(emptyResult, {});
ok(/^<!DOCTYPE html>/i.test(doc), '仍是完整 HTML');
eq((doc.match(/class="letter"/g) || []).length, 0, '没有页面');

console.log('\n[种子必须是确定的]');
const r1 = Core.selectEntities(
  [{ name: 'A', cents: 1 }, { name: 'B', cents: 2 }, { name: 'C', cents: 3 }, { name: 'D', cents: 4 }],
  { mode: 'sample', sampleSize: 2, seed: 42 }
);
const r2 = Core.selectEntities(
  [{ name: 'A', cents: 1 }, { name: 'B', cents: 2 }, { name: 'C', cents: 3 }, { name: 'D', cents: 4 }],
  { mode: 'sample', sampleSize: 2, seed: 42 }
);
eq(r1.selected.map(s => s.name).join(','), r2.selected.map(s => s.name).join(','), '同种子同结果');

console.log('\n' + '='.repeat(56));
if (fail.length) {
  console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
  fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
  process.exitCode = 1;
} else {
  console.log('异常输入全部通过：' + pass + ' 项断言');
}
