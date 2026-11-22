/**
 * 函证助手 · 导出装配
 * 控制表要能直接贴进底稿，询证函要能直接打印。
 */
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
const Core = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) {
  ok(a === b, msg + ' — 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

const entities = Core.mergeByName([
  { name: '华远科技有限公司', subject: '应收账款', cents: 128640050 },
  { name: '东方建设集团', subject: '应收账款', cents: 76200000 },
  { name: '新宇贸易有限公司', subject: '应收账款', cents: 15800000 },
  { name: '恒泰物流', subject: '应收账款', cents: 4200000 },
  { name: '瑞诚电子', subject: '应收账款', cents: 800000 }
]);
const result = Core.selectEntities(entities, {
  mode: 'mixed', thresholdCents: 50000000, sampleSize: 4, seed: 3
});

const opts = {
  client: '示例制造有限公司', cutOff: '2026-06-30', dateText: '2026-11-22',
  thresholdCents: 50000000, sampleSize: 4, seed: 3, kind: '往来款项'
};

console.log('[控制表能装进 xlsx]');
const rows = Core.controlRows(result, opts);
const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '函证控制表');
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
const byteLen = buf.byteLength || buf.length || 0;
ok(byteLen > 2000, '真的有内容（' + byteLen + ' 字节）');

const back = XLSX.read(new Uint8Array(buf), { type: 'array' });
const sheet = back.Sheets['函证控制表'];
ok(sheet, '工作表名对');
const round = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

console.log('\n[读回来还是那些数]');
const backHeader = round.find(r => r[0] === '序号');
ok(backHeader && backHeader[1] === '被函证单位', '表头完整');
const backRows = round.filter(r => typeof r[0] === 'number');
eq(backRows.length, result.count, '明细行数和选样一致');
result.selected.forEach((s, i) => {
  eq(backRows[i][1], s.name, '第 ' + (i + 1) + ' 行单位名');
  eq(backRows[i][3], s.cents / 100, '第 ' + (i + 1) + ' 行金额（元）');
});
const backTotal = round.find(r => r[0] === '合计');
eq(backTotal[3], result.selected.reduce((a, s) => a + s.cents, 0) / 100, '合计对');

console.log('\n[金额是数字不是文字]');
ok(typeof backRows[0][3] === 'number', '账龄金额写成数字，方便底稿里再算');
ok(/^\d+(\.\d+)?$/.test(String(backRows[0][3])), '没有千分位逗号混进单元格');

console.log('\n[留空的列不该有假数据]');
['发函日期', '回函日期', '回函金额', '差异', '差异说明'].forEach(function (label, i) {
  const idx = backHeader.indexOf(label);
  ok(idx > 0, '有「' + label + '」列');
  if (idx > 0) {
    const filled = backRows.filter(r => r[idx] !== null && r[idx] !== '' && r[idx] !== undefined);
    eq(filled.length, 0, '「' + label + '」必须是空的，等人工登记');
  }
});

console.log('\n[抽样说明留痕]');
const note = round.find(r => r[0] === '抽样说明');
ok(note && /共 \d+ 户/.test(note[1]), '写了几户里抽几户');
ok(note && /随机种子 3/.test(note[1]), '写了种子，复核能重跑');

console.log('\n[询证函单独打印]');
const doc = Core.printDocument(result, opts);
eq((doc.match(/class="letter"/g) || []).length, result.count, '一户一页');
ok(doc.indexOf('示例制造有限公司') > 0, '抬头有被审计单位');
ok(doc.indexOf('2026年6月30日') > 0, '截止日中文');
result.selected.forEach(function (s) {
  ok(doc.indexOf(s.name) > 0, '有 ' + s.name + ' 的函');
});
ok(doc.indexOf('@page{size:A4') > 0, 'A4 打印样式');

console.log('\n[编号是连续的]');
const serials = (doc.match(/编号：\d+/g) || []);
eq(serials.length, result.count, '每页一个编号');
ok(serials[0] === '编号：001', '从 001 开始（实际 ' + serials[0] + '）');
ok(serials[serials.length - 1] === '编号：' + String(result.count).padStart(3, '0'), '最后一个是 ' + serials[serials.length - 1]);

console.log('\n[HTML 结构完整]');
ok(/^<!DOCTYPE html>/i.test(doc), '有 doctype');
ok(/<\/html>\s*$/.test(doc), '有收尾');
ok(doc.indexOf('<style>') > 0, '样式内联，单文件能打印');

console.log('\n' + '='.repeat(56));
if (fail.length) {
  console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
  fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
  process.exitCode = 1;
} else {
  console.log('导出装配全部通过：' + pass + ' 项断言');
}
