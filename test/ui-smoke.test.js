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

function xlsxOf(rows, sheetName) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName || 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

async function loadFile(rows, sheetName) {
  payload = xlsxOf(rows, sheetName);
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

  console.log('\n' + '='.repeat(56));
  if (fail.length) {
    console.log('失败 ' + fail.length + ' / ' + (pass + fail.length) + ' 项：');
    fail.forEach((m, i) => console.log('  ' + (i + 1) + '. ' + m));
    process.exitCode = 1;
  } else {
    console.log('界面冒烟全部通过：' + pass + ' 项断言');
  }
}());
