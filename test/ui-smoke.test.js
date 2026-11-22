/**
 * 函证助手 · 界面冒烟
 * 用假 DOM 跑真 app.js：读文件 → 选样 → 改参数 → 导出。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));
const Core = require(path.join(root, 'core.js'));

let pass = 0, fail = [];
function ok(cond, msg) { if (cond) pass++; else fail.push(msg); }
function eq(a, b, msg) {
  ok(a === b, msg + ' — 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

/* ---------------- 假 DOM ---------------- */

function makeEl(id) {
  const handlers = {};
  const el = {
    id, innerHTML: '', value: '', textContent: '', checked: false,
    disabled: false, style: {}, files: null, options: [], selectedIndex: -1,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); }
    },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    click() { (handlers.click || []).forEach(fn => fn({ target: el })); },
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute(a) { return el._attrs ? el._attrs[a] : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    _handlers: handlers
  };
  return el;
}

const els = {};
const document = {
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
  createElement() { return makeEl('tmp'); },
  body: makeEl('body'),
  addEventListener() {}
};
document.body.classList = makeEl('body').classList;

let payload = null;
function FakeFileReader() { this.onload = null; this.onerror = null; this.result = null; }
FakeFileReader.prototype.readAsArrayBuffer = function () {
  const self = this;
  setImmediate(() => {
    self.result = payload;
    if (self.onload) self.onload({ target: { result: payload } });
  });
};

let written = null;
const XLSXshim = Object.assign({}, XLSX, {
  writeFile(wb, name) { written = { wb, name }; }
});
XLSXshim.utils = XLSX.utils;
XLSXshim.read = XLSX.read;
XLSXshim.write = XLSX.write;

const blobParts = [];
function FakeBlob(parts) { blobParts.push(parts.join('')); }
const URLshim = { createObjectURL: () => 'blob:fake', revokeObjectURL() {} };

const sandbox = {
  window: {}, document, XLSX: XLSXshim, Core,
  FileReader: FakeFileReader, Blob: FakeBlob, URL: URLshim,
  Uint8Array, setImmediate, setTimeout, console, Date, JSON, Math, String,
  Number, Object, Array, parseInt, parseFloat, isNaN, Promise
};
sandbox.window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
sandbox.window.document = document;
sandbox.window.XLSX = XLSXshim;
sandbox.window.Core = Core;
sandbox.window.Blob = FakeBlob;
sandbox.window.URL = URLshim;
sandbox.window.setTimeout = setTimeout;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

function el(id) { return document.getElementById(id); }
function fire(id, type) {
  const e = el(id);
  (e._handlers[type] || []).forEach(fn => fn({ target: e }));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function state_forceInclude(name) {
  if (typeof sandbox.window.__setInclude !== 'function') return false;
  sandbox.window.__setInclude(name, true);
  return true;
}

function xlsxOf(rows, sheetName, merge) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (merge) sheet['!merges'] = [XLSX.utils.decode_range(merge)];
  XLSX.utils.book_append_sheet(wb, sheet, sheetName || 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

async function loadFile(rows, sheetName, merge) {
  payload = xlsxOf(rows, sheetName, merge);
  const f = el('file');
  f.files = [{ name: '往来余额.xlsx' }];
  fire('file', 'change');
  await sleep(120);
}

(async function () {
  console.log('[初始状态]');
  eq(el('genControl').disabled, true, '没文件时不能生成控制表');
  eq(el('genLetter').disabled, true, '没文件时不能生成询证函');

  console.log('\n[读一张正常的往来余额表]');
  await loadFile([
    ['单位名称', '科目', '期末余额'],
    ['华远科技有限公司', '应收账款', 1286400.5],
    ['东方建设集团', '应收账款', 762000],
    ['新宇贸易有限公司', '应收账款', 158000],
    ['恒泰物流', '应收账款', 42000],
    ['瑞诚电子', '应收账款', 8000],
    ['华远科技有限公司', '预收账款', -120000]
  ], '往来余额');

  ok(/往来余额/.test(el('fileInfo').textContent), '显示读到的工作表名');
  const stats = el('statBox').innerHTML;
  ok(/可函证户数/.test(stats), '有统计');
  ok(/5 户/.test(stats) || />5</.test(stats), '同名合并后是 5 户（实际：' + stats.slice(0, 120) + '）');
  eq(el('genControl').disabled, false, '有数据就能生成');
  eq(el('genLetter').disabled, false, '有数据就能生成询证函');

  console.log('\n[列表里有每一户]');
  const listHtml = el('listBox').innerHTML;
  ok(listHtml.indexOf('华远科技有限公司') > 0, '列表里有华远');
  ok(listHtml.indexOf('瑞诚电子') > 0, '列表里有瑞诚');
  ok(listHtml.indexOf('1,286,400.50') > 0 || listHtml.indexOf('1,166,400.50') > 0, '金额显示带千分位');

  console.log('\n[改口径会重算]');
  el('selMode').value = 'all';
  fire('selMode', 'change');
  ok(/5 户/.test(el('statBox').innerHTML) || />5</.test(el('statBox').innerHTML), '全部要 → 5 户');

  el('selMode').value = 'threshold';
  el('threshold').value = '500000';
  fire('threshold', 'change');
  const thrStats = el('statBox').innerHTML;
  ok(/>2</.test(thrStats) || /2 户/.test(thrStats), '阈值 50 万 → 2 户（实际：' + thrStats.replace(/<[^>]+>/g, ' ').slice(0, 80) + '）');

  console.log('\n[生成控制表]');
  el('clientName').value = '示例制造有限公司';
  el('cutOff').value = '2026-06-30';
  el('selMode').value = 'mixed';
  el('threshold').value = '500000';
  el('sampleSize').value = '3';
  el('seed').value = '7';
  fire('sampleSize', 'change');

  written = null;
  fire('genControl', 'click');
  ok(written, '真的调用了写文件');
  if (written) {
    ok(/函证_示例制造有限公司_2026-06-30_控制表\.xlsx$/.test(written.name), '文件名带单位和截止日（' + written.name + '）');
    const sheet = written.wb.Sheets[written.wb.SheetNames[0]];
    const back = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    ok(back.find(r => String(r[0]).indexOf('函证控制表') === 0), '表里有标题');
    const body = back.filter(r => typeof r[0] === 'number');
    eq(body.length, 3, '抽了 3 户');
  }

  console.log('\n[生成询证函]');
  blobParts.length = 0;
  fire('genLetter', 'click');
  eq(blobParts.length, 1, '生成了一个 HTML');
  const doc = blobParts[0] || '';
  eq((doc.match(/class="letter"/g) || []).length, 3, '3 户 3 页');
  ok(doc.indexOf('示例制造有限公司') > 0, '抬头有被审计单位');
  ok(/生成/.test(el('genInfo').textContent), '界面给了反馈');

  console.log('\n[换一张认不出表头的文件]');
  await loadFile([['摘要', '借方', '贷方'], ['买东西', 100, 0]], '流水');
  ok(/找不到/.test(el('fileInfo').textContent), '明确说找不到可认的表');
  eq(el('genControl').disabled, true, '认不出就不能生成，而不是拿错数据生成');
  eq(el('genLetter').disabled, true, '同上');

  console.log('\n[示例数据按钮]');
  fire('demoBtn', 'click');
  await sleep(20);
  eq(el('genControl').disabled, false, '示例数据能生成');
  ok(/示例/.test(el('fileInfo').textContent), '标明了是示例');


  console.log('\n[门槛读不出来要当场报错，不能静默当 0]');
  await loadFile([
    ['单位名称', '期末余额'],
    ['甲', 1000000],
    ['乙', 800000],
    ['丙', 300000],
    ['丁', 50000]
  ], '往来');
  el('clientName').value = '某公司';
  el('cutOff').value = '2026-06-30';
  el('selMode').value = 'mixed';
  el('sampleSize').value = '3';
  el('threshold').value = '50万';
  fire('threshold', 'change');
  ok(/读不出金额/.test(el('statBox').innerHTML), '门槛写「50万」要报错（实际：' + el('statBox').innerHTML.replace(/<[^>]+>/g, '').slice(0, 60) + '）');
  eq(el('genControl').disabled, true, '门槛不对时不能导出');
  eq(el('genLetter').disabled, true, '同上');

  el('threshold').value = '0';
  fire('threshold', 'change');
  ok(/不能是 0/.test(el('statBox').innerHTML), '门槛 0 也要拦');

  el('threshold').value = '500000';
  fire('threshold', 'change');
  eq(el('genControl').disabled, false, '填对了就能导出');
  ok(/>3</.test(el('statBox').innerHTML) || /3 户/.test(el('statBox').innerHTML), '2 户大额 + 1 户随机 = 3 户');
  el('selMode').value = 'threshold';
  fire('selMode', 'change');
  ok(/>2</.test(el('statBox').innerHTML) || /2 户/.test(el('statBox').innerHTML), '纯阈值：50 万以上正好 2 户');

  console.log('\n[没填被审计单位不能导出]');
  el('clientName').value = '';
  written = null;
  fire('genControl', 'click');
  ok(!written, '没填单位名不生成');
  ok(/被审计单位/.test(el('genInfo').textContent), '提示要填被审计单位');
  el('clientName').value = '某公司';

  console.log('\n[换文件要清掉上一家的单位名]');
  await loadFile([['单位名称', '期末余额'], ['戊', 100]], '另一张');
  eq(el('clientName').value, '', '换文件后单位名清空，避免盖错名字');
  eq(el('cutOff').value, '', '截止日也清空');

  console.log('\n[手工勾选要能加不能只减]');
  await loadFile([
    ['单位名称', '期末余额'],
    ['大户', 1000000],
    ['小户', 10000]
  ], '往来');
  el('clientName').value = '某公司';
  el('cutOff').value = '2026-06-30';
  el('selMode').value = 'threshold';
  el('threshold').value = '500000';
  fire('threshold', 'change');
  ok(/>1</.test(el('statBox').innerHTML), '阈值下只有大户');
  state_forceInclude('小户');
  ok(/>2</.test(el('statBox').innerHTML) || /2 户/.test(el('statBox').innerHTML), '手工勾上小户后变成 2 户');

  console.log('\n[借贷两列的表在界面上要能用]');
  await loadFile([
    ['客户名称', '借方余额', '贷方余额'],
    ['甲', 1000, 0],
    ['乙', 0, 5000]
  ], '往来');
  el('selMode').value = 'all';
  fire('selMode', 'change');
  eq(el('genControl').disabled, false, '借贷两列的表能生成（上一版会整张拒掉）');
  ok(/乙/.test(el('listBox').innerHTML), '列表里有贷方那户');
  ok(/-5,000\.00/.test(el('listBox').innerHTML), '贷方余额显示为负数');

  console.log('\n[科目余额表要拒，并说明原因]');
  await loadFile([['科目编码', '科目名称', '期末余额'], ['1002', '银行存款', 1000]], '科目');
  eq(el('genControl').disabled, true, '科目余额表不能发函');
  ok(/科目余额表/.test(el('fileInfo').textContent), '提示说清楚是科目余额表（实际：' + el('fileInfo').textContent.slice(0, 50) + '）');

  console.log('\n[手工勾选后覆盖率要重算]');
  await loadFile([
    ['单位名称', '期末余额'],
    ['大户', 1000000],
    ['小户', 10000]
  ], '往来');
  el('clientName').value = '某公司';
  el('cutOff').value = '2026-06-30';
  el('selMode').value = 'threshold';
  el('threshold').value = '500000';
  fire('threshold', 'change');
  const covBefore = el('statBox').innerHTML.match(/([\d.]+)<span class="u">%/);
  state_forceInclude('小户');
  const covAfter = el('statBox').innerHTML.match(/([\d.]+)<span class="u">%/);
  ok(covBefore && covAfter, '能读到覆盖率');
  ok(covBefore && covAfter && covBefore[1] !== covAfter[1], '勾上小户后覆盖率要变（' + (covBefore && covBefore[1]) + '% → ' + (covAfter && covAfter[1]) + '%）');
  ok(covAfter && Math.abs(parseFloat(covAfter[1]) - 100) < 0.05, '两户都函，覆盖率就是 100%');

  console.log('\n[多张表：余额表优先于流水表]');
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [['客户名称', '借方发生额', '贷方发生额']].concat(
        Array.from({ length: 30 }, (_, i) => ['客户' + i, 1000 + i, 0])
      )), '流水');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [['客户名称', '期末余额'], ['华远科技有限公司', 1000000], ['东方建设', 500000]
      ]), '余额表');
    payload = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const f = el('file');
    f.files = [{ name: '两表.xlsx' }];
    fire('file', 'change');
    await sleep(150);
    ok(/余额表/.test(el('fileInfo').textContent), '选的是余额表不是流水表（实际：' + el('fileInfo').textContent + '）');
    ok(/可函证户数[\s\S]{0,40}>2</.test(el('statBox').innerHTML) || />2</.test(el('statBox').innerHTML), '2 户，不是 30 户');
  }

  console.log('\n[裸「单位」表头能读]');
  await loadFile([['单位', '期末余额'], ['华远科技有限公司', 1000000]], '往来');
  eq(el('genControl').disabled, false, '「单位」这种表头也能用');

  console.log('\n[合并单元格：客户名只在首行时不能丢钱]');
  {
    const ws = XLSX.utils.aoa_to_sheet([
      ['单位名称', '科目', '期末余额'],
      ['华远科技有限公司', '应收账款', 1000000],
      ['', '预收账款', -300000],
      ['', '其他应收款', 200000],
      ['东方建设', '应收账款', 500000]
    ]);
    ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '往来');
    payload = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const f = el('file');
    f.files = [{ name: '合并.xlsx' }];
    fire('file', 'change');
    await sleep(150);
    const list = el('listBox').innerHTML;
    ok(/900,000\.00/.test(list), '华远 = 1,000,000 − 300,000 + 200,000 = 900,000（实际：' + list.replace(/<[^>]+>/g, ' ').slice(0, 100) + '）');
    ok(/预收账款/.test(list), '合并区下面的科目也带出来了');
  }

  console.log('\n[合并名称的逐笔台账要显示拒绝原因]');
  el('selMode').value = 'all';
  await loadFile([['客户名称', '摘要', '余额'], ['华远', '收款', 1000],
    [null, '收款', 1500], [null, '收款', 2000]], '逐笔台账', 'A2:A4');
  ok(/逐笔明细台账/.test(el('fileInfo').textContent), 'F3 显示逐笔余额不能相加的提示');
  ok(el('genControl').disabled && el('genLetter').disabled, 'F3 禁用控制表和询证函');

  console.log('\n[首列备注保留价税合计明细，跳过首列合计行]');
  await loadFile([['备注', '客户名称', '期末余额'], ['价税合计', '华远', 1000],
    ['合计（本币）', null, 1000], [null, '东方', 500], ['本页小计', null, 500],
    [null, '海岚', 200]], '期末余额');
  const balanceRows = el('listBox').innerHTML.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  ok(balanceRows.some(row => row.includes('>华远</td>') && row.includes('>1,000.00</td>')) &&
    balanceRows.some(row => row.includes('>东方</td>') && row.includes('>500.00</td>')) &&
    balanceRows.some(row => row.includes('>海岚</td>') && row.includes('>200.00</td>')),
    'N1 列表显示华远 1,000 元、东方 500 元和海岚 200 元');
  ok(/跳过 2 行合计行/.test(el('statBox').innerHTML), 'N1 在选样统计中显示跳过两行合计');
  ok(!el('genControl').disabled && !el('genLetter').disabled, 'N1 首列备注合计不触发歧义拒收，两种导出均可用');

  console.log('\n[同样的凭证列，每户一行可读，同户多笔提示台账]');
  const voucherRows = [['客户名称', '日期', '凭证号', '摘要', '余额'],
    ['华远', '2026-06-08', '记-001', '期初', 1000], ['东方', '2026-06-11', '记-002', '期初', 500]];
  await loadFile(voucherRows, '往来余额');
  ok(el('fileInfo').textContent.includes('往来余额') && !el('fileInfo').textContent.includes('逐笔明细台账'),
    'N2 每户一行时显示导入成功');
  ok(/函证金额[\s\S]{0,40}>1,500\.00</.test(el('statBox').innerHTML), 'N2 两户函证金额为 1,500 元');
  ok(!el('genControl').disabled && !el('genLetter').disabled, 'N2 每户一行时两种导出均可用');
  await loadFile(voucherRows.concat([['华远', '2026-06-12', '记-003', '调整', 1300]]), '待核对');
  ok(/逐笔明细台账/.test(el('fileInfo').textContent), 'N2 同户多笔时提示逐笔明细台账');
  ok(el('genControl').disabled && el('genLetter').disabled, 'N2 同户多笔拒收后停用两种导出');

  console.log('\n[空名称的余额对不上累计要阻止导出]');
  await loadFile([['单位名称', '期末余额'], ['华远', 1000], ['东方', 500], [null, 1000]], '待核对');
  ok(/第 4 行没有单位名称，金额也与上面的合计对不上/.test(el('fileInfo').textContent),
    'F5 在导入处提示原表行号和金额不符原因');
  ok(el('genControl').disabled && el('genLetter').disabled, 'F5 禁用两种导出，即使上一次导入的表可导出');

  console.log('\n' + '='.repeat(56));
  if (fail.length) {
    console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
    fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
    process.exitCode = 1;
  } else {
    console.log('界面冒烟全部通过：' + pass + ' 项断言');
  }
}());
