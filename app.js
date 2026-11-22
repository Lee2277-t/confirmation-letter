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
    forced: {},        // 名字 -> true，手工加进来的（本来没抽中）
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
    // 合并单元格不在这里填：填了会把「金额」抄到每一行，同一笔钱被加好几遍。
    // 名称列的空白由 parseRows 的「沿用上一个名称」处理，金额列一律不填。    // 错误值（#REF!）在 raw 模式下是 null，和空格子分不清，先换成文字
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

  /**
   * 多张表都能读时挑哪张。
   * 关键是「余额表」优先于「流水/发生额表」——流水表行数多得多，
   * 只按行数挑会把整批函做成用发生额出的。
   */
  function pickSheet(wb) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var rows = sheetRows(wb, name);
      var h = Core.detectHeader(rows);
      if (h.rowIndex < 0) return;
      if (h.usable === false) return;
      var score = 100 + (h.amountKind === '余额' ? 30 : 0) + Math.min(rows.length, 2000) / 1000;
      if (!best || score > best.score) best = { name: name, rows: rows, header: h, score: score };
    });
    return best;
  }

  /** CSV 可能是 GBK（Excel 另存的默认编码），先按 UTF-8 严解，失败再按 GBK */
  function decodeCsv(buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length > 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) {
      try { return new TextDecoder('gbk').decode(u8); }
      catch (e2) { return new TextDecoder('utf-8').decode(u8); }
    }
  }

  function readWorkbook(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      var isCsv = /\.csv$/i.test(file.name || '');
      reader.onload = function () {
        try {
          var wb = isCsv
            ? XLSX.read(decodeCsv(reader.result), { type: 'string', cellDates: false })
            : XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: false });
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
    state.forced = {};
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

  /** 门槛读不出来就明确报错——静默当 0 会变成「谁都不算大额」，底稿口径却是「≥0 全取」 */
  function parseThreshold() {
    var raw = String($('threshold').value || '').trim();
    if (!raw) return { ok: false, msg: '金额门槛没填。填 0 会变成「谁都不算大额」，请填一个金额，例如 500000' };
    var c = Core.toCents(raw);
    if (c === null) return { ok: false, msg: '金额门槛「' + raw + '」读不出金额，请填数字，例如 500000（不支持「万」字）' };
    if (c < 0) return { ok: false, msg: '金额门槛不能是负数' };
    if (c === 0) return { ok: false, msg: '金额门槛不能是 0，否则一户都不会被当成大额' };
    return { ok: true, cents: c };
  }

  function currentOpts() {
    var mode = $('selMode').value;
    var thr = parseThreshold();
    return {
      mode: mode,
      thresholdCents: thr.ok ? thr.cents : 0,
      thresholdError: thr.ok ? '' : thr.msg,
      sampleSize: parseInt($('sampleSize').value, 10) || 0,
      seed: parseInt($('seed').value, 10) || 1
    };
  }

  function recompute() {
    var opts = currentOpts();
    if (opts.thresholdError && (opts.mode === 'mixed' || opts.mode === 'threshold')) {
      state.result = null;
      state.selected = [];
      $('statBox').innerHTML = '<div class="note bad">' + esc(opts.thresholdError) + '</div>';
      renderList();
      refreshButtons();
      return;
    }
    var pool = state.entities.filter(function (e) { return !state.excluded[e.name]; });
    state.result = Core.selectEntities(pool, opts);
    // 手工勾上但没被抽中的户要补进来，不然勾了等于没勾
    var picked = {};
    state.result.selected.forEach(function (s) { picked[s.name] = true; });
    Object.keys(state.forced).forEach(function (name) {
      if (picked[name]) return;
      var e = state.entities.filter(function (x) { return x.name === name; })[0];
      if (!e) return;
      state.result.selected.push({
        no: state.result.selected.length + 1, name: e.name, cents: e.cents,
        subjects: e.subjects || [], subjectCents: e.subjectCents || {},
        noSubjectCents: e.noSubjectCents || 0, codes: e.codes || [],
        srcRows: e.srcRows || [], reason: '手工指定'
      });
      picked[name] = true;
    });
    state.result.selected.forEach(function (s, i) { s.no = i + 1; });
    state.result.count = state.result.selected.length;
    state.result.totalCents = state.result.selected.reduce(function (a, s) { return a + s.cents; }, 0);
    // 覆盖率要按「全部往来余额」算，不能按排除后的池子算：
    // 否则把最大的那户排除掉，覆盖率会跳到 100%，底稿上等于说函证覆盖了全部
    var allAbs = state.entities.reduce(function (a, e) { return a + Math.abs(e.cents); }, 0);
    var selAbs = state.result.selected.reduce(function (a, s) { return a + Math.abs(s.cents); }, 0);
    state.result.coverage = allAbs === 0 ? 0 : selAbs / allAbs;
    state.result.poolCount = state.entities.length;
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
        var wasSelected = false;
        (state.result ? state.result.selected : []).forEach(function (s) {
          if (s.name === name && s.reason !== '手工指定') wasSelected = true;
        });
        if (el.checked) {
          delete state.excluded[name];
          if (!wasSelected) state.forced[name] = true;
        } else {
          state.excluded[name] = true;
          delete state.forced[name];
        }
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
      seed: currentOpts().seed,
      notes: (state.parsed && state.parsed.problems) || [],
      excludedNames: Object.keys(state.excluded || {})
    };
  }

  function requireFields() {
    var client = $('clientName').value.trim();
    var cut = $('cutOff').value.trim();
    var miss = [];
    if (!client) miss.push('被审计单位');
    if (!cut) miss.push('截止日');
    if (miss.length) {
      $('genInfo').textContent = '请先填：' + miss.join('、') + '。函上要盖章要写日期，空着发不出去。';
      return false;
    }
    return true;
  }

  function exportControl() {
    if (!requireFields()) return;
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
    if (!requireFields()) return;
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

  /** 把工作簿里所有能用的表列出来，默认选评分最高的那张；返回提示文字 */
  function fillSheetSelect(wb, picked) {
    var sel = $('sheetSel');
    var usable = [];
    wb.SheetNames.forEach(function (name) {
      var rows = sheetRows(wb, name);
      var h = Core.detectHeader(rows);
      if (h.rowIndex >= 0 && h.usable !== false) usable.push(name);
    });
    sel.innerHTML = wb.SheetNames.map(function (n) {
      var label = n + (usable.indexOf(n) >= 0 ? '' : '（认不出）');
      return '<option value="' + n.replace(/"/g, '&quot;') + '"' +
        (n === picked ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
    sel.disabled = wb.SheetNames.length <= 1;
    // 提示文字交回调用方，避免被随后的「文件名 · 表名」整句覆盖
    return usable.length > 1
      ? ' · 还有 ' + (usable.length - 1) + ' 张表也能用，可在左边切换'
      : '';
  }

  $('sheetSel').addEventListener('change', function () {
    if (!state.wb) return;
    var name = $('sheetSel').value;
    var rows = sheetRows(state.wb, name);
    var h = Core.detectHeader(rows);
    if (h.rowIndex < 0 || h.usable === false) {
      clearAll('这张表认不出：' + (h.problems[0] || '找不到表头'));
      return;
    }
    state.sheetName = name;
    state.rows = rows;
    state.header = h;
    state.origin = sheetOrigin(state.wb, name);
    state.excluded = {};
    state.forced = {};
    parse();
    recompute();
    $('fileInfo').textContent = state.fileName + ' · ' + name;
  });

  $('file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    readWorkbook(f).then(function (res) {
      if (!res.ok) { clearAll('读不了这个文件：' + res.error); return; }
      var pick = pickSheet(res.wb);
      if (!pick) {
        // 能认出表头但不能用（比如是科目余额表）：把具体原因说出来，别只说「找不到」
        var why = '';
        res.wb.SheetNames.forEach(function (name) {
          if (why) return;
          var h = Core.detectHeader(sheetRows(res.wb, name));
          if (h.rowIndex >= 0 && h.problems.length) why = h.problems.join('；');
        });
        clearAll(why || '这个文件里找不到「单位名称 + 余额」这样的表。函证对象要能认出单位名称和金额两列。');
        return;
      }
      // 换了一家客户，上一家的单位名和截止日不能留着，否则函会盖错名字
      $('clientName').value = '';
      $('cutOff').value = '';
      state.wb = res.wb;
      var sheetHint = fillSheetSelect(res.wb, pick.name);
      setWorkbook(res, pick);
      $('fileInfo').textContent = res.fileName + ' · ' + pick.name + sheetHint;
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

  /** 供测试与将来可能的批量操作调用：等价于点某一行的勾选框 */
  function setInclude(name, on) {
    var wasSelected = false;
    (state.result ? state.result.selected : []).forEach(function (s) {
      if (s.name === name && s.reason !== '手工指定') wasSelected = true;
    });
    if (on) {
      delete state.excluded[name];
      if (!wasSelected) state.forced[name] = true;
    } else {
      state.excluded[name] = true;
      delete state.forced[name];
    }
    recompute();
  }
  window.__setInclude = setInclude;

  // 启动时若没有文件，两个导出按钮都不可用
  clearAll('');
}());
