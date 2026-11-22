/* 函证助手 · 界面层 */
(function () {
  'use strict';

  var Core = window.Core;
  var XLSX = window.XLSX;

  var state = {
    fileName: '',
    wb: null,
    sheetName: '',
    origin: 0,
    rows: [],
    header: null,
    parsed: null,
    entities: [],
    selected: [],
    excluded: {},      // 名字 -> true，手工排除的
    result: null,
    lastError: ''
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function money(c) { return Core.moneyText(c); }

  /* ---------------- 读表 ---------------- */

  function sheetRows(wb, name) {
    var ws = wb.Sheets[name];
    if (!ws) return [];
    // 错误值（#REF!）在 raw 模式下是 null，和空格子分不清，先换成文字
    Object.keys(ws).forEach(function (addr) {
      if (addr.charAt(0) === '!') return;
      var cell = ws[addr];
      if (!cell || cell.t !== 'e') return;
      cell.t = 's';
      cell.v = String(cell.w || '#错误值');
      delete cell.w;
    });
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  function sheetOrigin(wb, name) {
    var ws = wb.Sheets[name];
    if (!ws || !ws['!ref'] || !XLSX.utils.decode_range) return 0;
    try { return XLSX.utils.decode_range(ws['!ref']).s.r; } catch (e) { return 0; }
  }

  function pickSheet(wb) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var rows = sheetRows(wb, name);
      var h = Core.detectHeader(rows);
      if (h.rowIndex < 0 || h.problems.length) return;
      var n = h.rowIndex >= 0 ? rows.length : 0;
      var score = 100 + n / 1000;
      if (!best || score > best.score) best = { name: name, rows: rows, header: h, score: score };
    });
    return best;
  }

  function readWorkbook(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: false });
          resolve({ ok: true, wb: wb, fileName: file.name });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      };
      reader.onerror = function () { resolve({ ok: false, error: '文件读不了' }); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------------- 状态 ---------------- */

  function clearAll(msg) {
    state.parsed = null;
    state.entities = [];
    state.selected = [];
    state.result = null;
    state.header = null;
    state.rows = [];
    $('fileInfo').textContent = msg || '';
    $('statBox').innerHTML = '';
    $('listBox').innerHTML = '';
    $('listPanel').classList.add('hidden');
    $('genControl').disabled = true;
    $('genLetter').disabled = true;
    $('genInfo').textContent = '';
  }

  function setWorkbook(res, pick) {
    state.fileName = res.fileName;
    state.wb = res.wb;
    state.sheetName = pick.name;
    state.rows = pick.rows;
    state.header = pick.header;
    state.origin = sheetOrigin(res.wb, pick.name);
    state.excluded = {};
    state.lastError = '';
  }

  /* ---------------- 解析 ---------------- */

  function parse() {
    if (!state.header) { state.parsed = null; return; }
    state.parsed = Core.parseRows(state.rows, state.header, {
      firstExcelRow: (state.origin || 0) + 1
    });
    state.entities = Core.mergeByName(state.parsed.entities || []);
  }

  function currentOpts() {
    return {
      mode: $('selMode').value,
      thresholdCents: Core.toCents($('threshold').value || 0) || 0,
      sampleSize: parseInt($('sampleSize').value, 10) || 0,
      seed: parseInt($('seed').value, 10) || 1
    };
  }

  function recompute() {
    var opts = currentOpts();
    var pool = state.entities.filter(function (e) { return !state.excluded[e.name]; });
    state.result = Core.selectEntities(pool, opts);
    state.selected = state.result.selected;
    renderStats();
    renderList();
    refreshButtons();
  }

  function refreshButtons() {
    var ok = state.selected.length > 0;
    $('genControl').disabled = !ok;
    $('genLetter').disabled = !ok;
  }

  /* ---------------- 渲染 ---------------- */

  function renderStats() {
    var box = $('statBox');
    if (!state.result) { box.innerHTML = ''; return; }
    var r = state.result;
    var probs = (state.parsed && state.parsed.problems) || [];
    var html = '<div class="stats">' +
      '<div class="cell"><div class="k">可函证户数</div><div class="v">' + r.poolCount + '<span class="u"> 户</span></div></div>' +
      '<div class="cell ok"><div class="k">抽取</div><div class="v">' + r.count + '<span class="u"> 户</span></div></div>' +
      '<div class="cell"><div class="k">金额覆盖率</div><div class="v">' + (r.coverage * 100).toFixed(1) + '<span class="u">%</span></div></div>' +
      '<div class="cell"><div class="k">函证金额</div><div class="v">' + money(r.totalCents) + '</div></div>' +
      '</div>';
    if (probs.length) {
      html += '<div class="note warn">' + esc(probs.join('；')) + '</div>';
    }
    if (state.excluded && Object.keys(state.excluded).length) {
      html += '<div class="note warn">已手工排除 ' + Object.keys(state.excluded).length +
        ' 户（在下方列表里取消勾选可恢复）。</div>';
    }
    box.innerHTML = html;
  }

  function renderList() {
    var panel = $('listPanel');
    var box = $('listBox');
    if (!state.entities.length) { panel.classList.add('hidden'); box.innerHTML = ''; return; }
    panel.classList.remove('hidden');

    var picked = {};
    (state.selected || []).forEach(function (s) { picked[s.name] = true; });

    var html = '<table class="data"><thead><tr>' +
      '<th>函证</th><th>被函证单位</th><th>科目</th><th class="num">账面余额</th><th>选样方式</th>' +
      '</tr></thead><tbody>';
    state.entities.forEach(function (e) {
      var on = picked[e.name] && !state.excluded[e.name];
      var reason = '';
      (state.selected || []).forEach(function (s) { if (s.name === e.name) reason = s.reason; });
      html += '<tr class="' + (on ? '' : 'off') + '">' +
        '<td><input type="checkbox" data-name="' + esc(e.name) + '"' + (on ? ' checked' : '') + '></td>' +
        '<td>' + esc(e.name) + '</td>' +
        '<td>' + esc((e.subjects || []).join('、')) + '</td>' +
        '<td class="num">' + money(e.cents) + '</td>' +
        '<td>' + esc(reason || (state.excluded[e.name] ? '已排除' : '')) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;

    box.querySelectorAll('input[type=checkbox]').forEach(function (el) {
      el.addEventListener('change', function () {
        var name = el.getAttribute('data-name');
        if (el.checked) delete state.excluded[name];
        else state.excluded[name] = true;
        recompute();
      });
    });
  }

  /* ---------------- 导出 ---------------- */

  function controlOpts() {
    return {
      client: $('clientName').value.trim(),
      cutOff: $('cutOff').value.trim(),
      dateText: Core.dateTextOf(),
      kind: '往来款项',
      thresholdCents: currentOpts().thresholdCents,
      sampleSize: currentOpts().sampleSize,
      seed: currentOpts().seed
    };
  }

  function exportControl() {
    var opts = controlOpts();
    var rows = Core.controlRows(state.result, opts);
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 24 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '函证控制表');
    var name = Core.fileName(opts) + '_控制表.xlsx';
    XLSX.writeFile(wb, name);
    $('genInfo').textContent = '已生成：' + name;
  }

  function exportLetter() {
    var opts = controlOpts();
    var doc = Core.printDocument(state.result, opts);
    var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = Core.fileName(opts) + '_询证函.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    $('genInfo').textContent = '已生成：' + Core.fileName(opts) + '_询证函.html（用浏览器打开，Ctrl+P 打印或另存 PDF）';
  }

  /* ---------------- 事件 ---------------- */

  $('file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    readWorkbook(f).then(function (res) {
      if (!res.ok) { clearAll('读不了这个文件：' + res.error); return; }
      var pick = pickSheet(res.wb);
      if (!pick) {
        clearAll('这个文件里找不到「单位名称 + 余额」这样的表。函证对象要能认出单位名称和金额两列。');
        return;
      }
      setWorkbook(res, pick);
      $('fileInfo').textContent = res.fileName + ' · ' + pick.name;
      $('listPanel').classList.remove('hidden');
      parse();
      recompute();
    });
  });

  ['selMode', 'threshold', 'sampleSize', 'seed'].forEach(function (id) {
    $(id).addEventListener('change', recompute);
    $(id).addEventListener('input', recompute);
  });

  $('genControl').addEventListener('click', function () {
    try { exportControl(); } catch (e) { $('genInfo').textContent = '生成失败：' + e.message; }
  });
  $('genLetter').addEventListener('click', function () {
    try { exportLetter(); } catch (e) { $('genInfo').textContent = '生成失败：' + e.message; }
  });

  $('demoBtn').addEventListener('click', function () {
    var rows = [
      ['单位名称', '科目', '期末余额'],
      ['华远科技有限公司', '应收账款', 1286400.5],
      ['东方建设集团', '应收账款', 762000],
      ['新宇贸易有限公司', '应收账款', 158000],
      ['恒泰物流', '应收账款', 42000],
      ['瑞诚电子', '应收账款', 8000],
      ['华远科技有限公司', '预收账款', -120000]
    ];
    state.fileName = '示例-往来余额表';
    state.sheetName = '往来余额';
    state.rows = rows;
    state.origin = 0;
    state.header = Core.detectHeader(rows);
    state.wb = null;
    state.excluded = {};
    $('fileInfo').textContent = '示例数据（虚构）';
    $('clientName').value = '示例被审计单位';
    $('cutOff').value = '2026-06-30';
    parse();
    recompute();
  });

  // 启动时若没有文件，两个导出按钮都不可用
  clearAll('');
}());
