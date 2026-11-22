/*!
 * 函证助手 · 纯逻辑层（不碰 DOM，不碰文件）
 * 金额一律按「分」的整数算，只在显示和导出时除 100。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.1.0';

  /* ---------------- 基础 ---------------- */

  function str(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }

  /** 全角空格、括号、冒号都归一，便于比列名和单位名 */
  function norm(v) {
    return str(v)
      .replace(/[\u3000\s]+/g, '')
      .replace(/[（）()【】\[\]〔〕]/g, '')
      .replace(/[:：、，,。.·]/g, '')
      .toUpperCase();
  }

  /**
   * 金额转「分」。认常见的几种写法：
   *   1,234.56 / -1,234.56 / （1,234.56） / 1 234.56 / 一格的破折号 = 0
   * 读不出来返回 null —— 不能当 0，否则少了钱还显示正常。
   */
  function toCents(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      return Math.round(v * 100);
    }
    var s = str(v).trim();
    if (!s) return null;
    // 余额表里用一个破折号表示 0 很常见
    if (/^[-—–－]$/.test(s)) return 0;
    var neg = false;
    if (/^[（(].*[）)]$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\s\u3000]/g, '').replace(/[¥$]/g, '');
    if (/^[-－—–]/.test(s)) { neg = true; s = s.slice(1); }
    // 千分位只认「每三位一组」的写法：12,34 这种既可能是 1234 也可能是 12.34，
    // 猜错就是一笔钱的差错，宁可不认。
    if (/[,，]/.test(s)) {
      if (/^\d{1,3}([,，]\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/[,，]/g, '');
      else return null;
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var cents = Math.round(parseFloat(s) * 100);
    return neg ? -cents : cents;
  }

  /** 分转显示：1234567 -> "12,345.67" */
  function moneyText(cents) {
    if (cents === null || cents === undefined || !isFinite(cents)) return '';
    var neg = cents < 0;
    var n = Math.abs(Math.round(cents));
    var yuan = Math.floor(n / 100);
    var fen = String(n % 100).padStart(2, '0');
    var s = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + '.' + fen;
  }

  /* ---------------- 认表 ---------------- */

  var NAME_WORDS = /单位名称|客户名称|供应商名称|往来单位|单位|客户|供应商|户名|公司名称|名称/;
  var AMOUNT_WORDS = /期末余额|期末数|余额|金额|发生额/;
  var SUBJECT_WORDS = /科目|项目|类别|款项性质/;
  var CODE_WORDS = /账号|账户|编码|代码|编号/;
  var TOTAL_WORDS = /^(合计|总计|小计|合\s*计)$/;

  function isTotalName(name) {
    return TOTAL_WORDS.test(norm(name));
  }

  function scoreRow(row) {
    var name = 0, amount = 0, subject = 0, code = 0;
    (row || []).forEach(function (cell) {
      var t = norm(cell);
      if (!t) return;
      if (NAME_WORDS.test(t)) name++;
      if (AMOUNT_WORDS.test(t)) amount++;
      if (SUBJECT_WORDS.test(t)) subject++;
      if (CODE_WORDS.test(t)) code++;
    });
    return { name: name, amount: amount, subject: subject, code: code,
      total: name * 3 + amount * 2 + subject + code };
  }

  /**
   * 找表头。要求至少一个「名称」列 + 一个「金额」列。
   * 找不到就返回 rowIndex:-1 和原因，不硬猜。
   */
  function detectHeader(rows) {
    var limit = Math.min(rows.length, 20);
    var best = { rowIndex: -1, score: 0 };
    for (var r = 0; r < limit; r++) {
      var sc = scoreRow(rows[r]);
      if (sc.total > best.score) best = { rowIndex: r, score: sc.total, parts: sc };
    }
    if (best.rowIndex < 0 || best.score < 5) {
      return { rowIndex: -1, nameCol: -1, amountCol: -1, subjectCol: -1, codeCol: -1,
        problems: ['找不到能认的表头（需要一列单位/客户名称，一列余额或金额）'] };
    }

    var row = rows[best.rowIndex] || [];
    var nameCol = -1, amountCol = -1, subjectCol = -1, codeCol = -1;
    var amountRank = -1;
    for (var c = 0; c < row.length; c++) {
      var t = norm(row[c]);
      if (!t) continue;
      if (nameCol < 0 && NAME_WORDS.test(t)) { nameCol = c; continue; }
      if (AMOUNT_WORDS.test(t)) {
        // 「期末余额」优先于「发生额」，避免拿到借方发生额
        var rank = /期末余额|期末数/.test(t) ? 3 : (/余额/.test(t) ? 2 : 1);
        if (rank > amountRank) { amountRank = rank; amountCol = c; }
        continue;
      }
      if (subjectCol < 0 && SUBJECT_WORDS.test(t)) { subjectCol = c; continue; }
      if (codeCol < 0 && CODE_WORDS.test(t)) { codeCol = c; }
    }

    var problems = [];
    if (nameCol < 0) problems.push('没找到单位（客户/供应商）名称列');
    if (amountCol < 0) problems.push('没找到余额或金额列');

    return {
      rowIndex: best.rowIndex, nameCol: nameCol, amountCol: amountCol,
      subjectCol: subjectCol, codeCol: codeCol, problems: problems
    };
  }

  /**
   * 按表头读出一行行对象。
   * 读不出金额的行不能丢：单独记进 skipped，并说明原因。
   */
  function parseRows(rows, header, opts) {
    opts = opts || {};
    var firstExcelRow = opts.firstExcelRow || 1;
    var entities = [];
    var skipped = [];
    var problems = (header.problems || []).slice();

    if (header.rowIndex < 0 || header.nameCol < 0 || header.amountCol < 0) {
      return { entities: [], skipped: [], problems: problems };
    }

    for (var r = header.rowIndex + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var excelRow = firstExcelRow + r;
      var name = str(row[header.nameCol]).trim();
      var rawAmount = row[header.amountCol];
      var amount = toCents(rawAmount);
      var subject = header.subjectCol >= 0 ? str(row[header.subjectCol]).trim() : '';
      var code = header.codeCol >= 0 ? str(row[header.codeCol]).trim() : '';

      var blank = !name && str(rawAmount).trim() === '' && !subject;
      if (blank) continue;
      if (isTotalName(name)) { skipped.push({ srcRow: excelRow, reason: '合计行', name: name }); continue; }

      if (!name) {
        // 有金额没名字：不能静默丢，否则这笔钱在函证清单里彻底消失
        if (amount !== null && amount !== 0) {
          skipped.push({ srcRow: excelRow, reason: '没有单位名称', name: '', cents: amount });
        }
        continue;
      }
      if (amount === null) {
        skipped.push({ srcRow: excelRow, reason: '金额读不出', name: name, raw: str(rawAmount) });
        continue;
      }

      entities.push({
        name: name, subject: subject, code: code,
        cents: amount, srcRow: excelRow
      });
    }

    if (skipped.length) {
      var noName = skipped.filter(function (s) { return s.reason === '没有单位名称'; }).length;
      var badAmt = skipped.filter(function (s) { return s.reason === '金额读不出'; }).length;
      if (noName) problems.push(noName + ' 行有金额但没有单位名称，没有计入（请回原表核对）');
      if (badAmt) problems.push(badAmt + ' 行的金额读不出，没有计入');
    }
    return { entities: entities, skipped: skipped, problems: problems };
  }

  /** 同名单位合并（一家客户可能挂多个科目），金额相加 */
  function mergeByName(entities) {
    var map = {}, order = [];
    entities.forEach(function (e) {
      var k = norm(e.name);
      if (!map[k]) {
        map[k] = { name: e.name, cents: 0, subjects: [], subjectCents: {}, codes: [], srcRows: [], count: 0 };
        order.push(k);
      }
      map[k].cents += e.cents;
      map[k].count++;
      if (e.subject && map[k].subjects.indexOf(e.subject) < 0) {
        map[k].subjects.push(e.subject);
      }
      if (e.subject) map[k].subjectCents[e.subject] = (map[k].subjectCents[e.subject] || 0) + e.cents;
      if (e.code && map[k].codes.indexOf(e.code) < 0) map[k].codes.push(e.code);
      if (e.srcRow) map[k].srcRows.push(e.srcRow);
    });
    return order.map(function (k) { return map[k]; });
  }

  /* ---------------- 选样 ---------------- */

  /** 可复现的伪随机：同一个种子抽出同一批，便于复核 */
  function makeRandom(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 选样。四种口径：
   *   all        全部
   *   threshold  余额绝对值 ≥ 阈值
   *   sample     纯随机抽 N 个
   *   mixed      阈值以上全要，剩下的随机补到 N 个（审计上最常用）
   */
  function selectEntities(entities, opts) {
    opts = opts || {};
    var mode = opts.mode || 'all';
    var thresholdCents = opts.thresholdCents === undefined ? 0 : opts.thresholdCents;
    var sampleSize = opts.sampleSize === undefined ? 0 : opts.sampleSize;
    var rand = makeRandom(opts.seed === undefined ? 1 : opts.seed);

    var pool = entities.slice();
    var selected = [], reasons = {};

    if (mode === 'all') {
      pool.forEach(function (e) { selected.push(e); reasons[e.name] = '全部'; });
    } else if (mode === 'threshold') {
      pool.forEach(function (e) {
        if (Math.abs(e.cents) >= thresholdCents) { selected.push(e); reasons[e.name] = '超阈值'; }
      });
    } else {
      var big = [], rest = [];
      pool.forEach(function (e) {
        if (Math.abs(e.cents) >= thresholdCents && thresholdCents > 0) big.push(e);
        else rest.push(e);
      });
      if (mode === 'sample') { big = []; rest = pool.slice(); }
      big.forEach(function (e) { selected.push(e); reasons[e.name] = '超阈值'; });
      var need = Math.max(0, sampleSize - selected.length);
      shuffle(rest, rand).slice(0, need).forEach(function (e) {
        selected.push(e); reasons[e.name] = '随机抽取';
      });
    }

    // 稳定排序：金额大的在前，同额按名称，方便核对
    selected.sort(function (a, b) {
      var d = Math.abs(b.cents) - Math.abs(a.cents);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name);
    });

    var totalAbs = 0, selectedAbs = 0, allAbs = 0;
    pool.forEach(function (e) { allAbs += Math.abs(e.cents); });
    selected.forEach(function (e) { selectedAbs += Math.abs(e.cents); totalAbs += e.cents; });

    return {
      selected: selected.map(function (e, i) {
        return {
          no: i + 1, name: e.name, cents: e.cents,
          subjects: e.subjects || (e.subject ? [e.subject] : []),
          subjectCents: e.subjectCents || (e.subject ? (function () { var o = {}; o[e.subject] = e.cents; return o; }()) : {}),
          codes: e.codes || (e.code ? [e.code] : []),
          srcRows: e.srcRows || (e.srcRow ? [e.srcRow] : []),
          reason: reasons[e.name] || ''
        };
      }),
      count: selected.length,
      poolCount: pool.length,
      totalCents: totalAbs,
      coverage: allAbs === 0 ? 0 : selectedAbs / allAbs,
      mode: mode
    };
  }

  /* ---------------- 输出 ---------------- */

  function dateTextOf(d) {
    var dt = d || new Date();
    function p2(n) { return String(n).padStart(2, '0'); }
    return dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate());
  }

  function chineseDate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str(s).trim());
    if (!m) return str(s);
    return m[1] + '年' + parseInt(m[2], 10) + '月' + parseInt(m[3], 10) + '日';
  }

  /**
   * 函证控制表：审计底稿里要能直接用的那种。
   * 后面几列（发函/回函/差异）留空给人工登记，不预填假数据。
   */
  function controlRows(result, opts) {
    opts = opts || {};
    var head = [
      ['函证控制表（' + (opts.kind || '往来款项') + '）'],
      ['被审计单位：' + (opts.client || '（未填）'), '', '', '', '截止日：' + (opts.cutOff || '')],
      ['编制日期：' + (opts.dateText || dateTextOf()) + ' · 金额单位：元', '', '', '', '选样口径：' + modeText(result.mode, opts)],
      [],
      ['序号', '被函证单位', '科目', '账面余额', '函证金额', '选样方式', '发函日期', '回函日期', '回函金额', '差异', '差异说明']
    ];
    result.selected.forEach(function (s) {
      head.push([
        s.no, s.name, (s.subjects || []).join('、'),
        s.cents / 100, s.cents / 100, s.reason,
        '', '', '', '', ''
      ]);
    });
    head.push([]);
    head.push(['合计', '', '', result.selected.reduce(function (a, s) { return a + s.cents; }, 0) / 100,
      result.selected.reduce(function (a, s) { return a + s.cents; }, 0) / 100, '', '', '', '', '', '']);
    head.push([]);
    head.push(['抽样说明', '共 ' + result.poolCount + ' 户，抽取 ' + result.count + ' 户，' +
      '金额覆盖率 ' + (result.coverage * 100).toFixed(1) + '%' +
      (opts.seed !== undefined ? '，随机种子 ' + opts.seed : ''), '', '', '', '', '', '', '', '']);
    return head;
  }

  function modeText(mode, opts) {
    opts = opts || {};
    if (mode === 'all') return '全部';
    if (mode === 'threshold') return '余额绝对值 ≥ ' + moneyText(opts.thresholdCents || 0) + ' 元';
    if (mode === 'sample') return '随机抽取 ' + (opts.sampleSize || 0) + ' 户';
    return '余额绝对值 ≥ ' + moneyText(opts.thresholdCents || 0) + ' 元全取，其余随机补至 ' +
      (opts.sampleSize || 0) + ' 户';
  }

  /** 一页询证函的正文（不含 <html> 外壳），便于单独测 */
  function letterHTML(entity, opts) {
    opts = opts || {};
    var esc = function (s) {
      return str(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };
    // 一家单位挂多个科目时，要按科目分别列金额；
    // 每行都写总额会把同一笔钱算成两遍。
    var subs = (entity.subjects && entity.subjects.length) ? entity.subjects : [''];
    var hasBreak = subs.length > 1 && entity.subjectCents;
    var rows = subs.map(function (subj) {
      var amt = hasBreak ? (entity.subjectCents[subj] || 0) : entity.cents;
      return '<tr><td class="c">' + esc(subj || '往来款项') + '</td><td class="r">' +
        esc(moneyText(amt)) + '</td></tr>';
    }).join('');
    if (hasBreak) {
      rows += '<tr><td class="c"><b>合计</b></td><td class="r"><b>' + esc(moneyText(entity.cents)) + '</b></td></tr>';
    }

    return '' +
      '<section class="letter">' +
      '<h1>' + esc(opts.title || '企业询证函') + '</h1>' +
      '<p class="no">编号：' + esc(opts.serial || '') + '</p>' +
      '<p class="to">致：' + esc(entity.name) + '</p>' +
      '<p>' + esc(opts.intro ||
        '本公司聘请的会计师事务所正在对本公司财务报表进行审计，按照中国注册会计师审计准则的要求，' +
        '应当询证本公司与贵公司的往来款项。下列数据出自本公司账簿记录，如与贵公司记录相符，' +
        '请在本函下端“信息证明无误”处签章证明；如有不符，请在“信息不符”处列明不符项目。') + '</p>' +
      '<p>截至 ' + esc(chineseDate(opts.cutOff) || '＿＿＿＿年＿＿月＿＿日') + '，本公司与贵公司的往来款项如下：</p>' +
      '<table class="amt"><thead><tr><th>科目</th><th>金额（元）</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="small">本函仅为复核账目之用，并非催款结算。若款项在上述日期之后已经付清，仍请及时函复为盼。</p>' +
      '<p class="sign">' +
      '<span>（公司盖章）</span><span>' + esc(opts.client || '') + '</span><span>' + esc(chineseDate(opts.dateText) || '') + '</span>' +
      '</p>' +
      '<div class="reply">' +
      '<h2>信息证明无误</h2>' +
      '<p>（贵公司盖章）　　年　　月　　日　　经办人：＿＿＿＿＿＿</p>' +
      '<h2>信息不符，请列明不符项目及具体内容</h2>' +
      '<p>（贵公司盖章）　　年　　月　　日　　经办人：＿＿＿＿＿＿</p>' +
      '</div>' +
      '<p class="addr">回函地址：' + esc(opts.addr || '＿＿＿＿＿＿＿＿＿＿＿＿') +
      '　收件人：' + esc(opts.receiver || '＿＿＿＿') + '　电话：' + esc(opts.phone || '＿＿＿＿＿＿') + '</p>' +
      '</section>';
  }

  /** 打印版整份文档：A4、每户一页 */
  function printDocument(result, opts) {
    opts = opts || {};
    var pages = result.selected.map(function (s, i) {
      return letterHTML(s, Object.assign({}, opts, {
        serial: (opts.serialPrefix || '') + String(i + 1).padStart(3, '0')
      }));
    }).join('\n');
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + (opts.client || '') + ' 询证函' + '</title>' +
      '<style>' + LETTER_CSS + '</style></head><body>' + pages + '</body></html>';
  }

  var LETTER_CSS = [
    '@page{size:A4;margin:18mm 16mm}',
    'body{font-family:"SimSun","Songti SC",serif;color:#000;margin:0}',
    '.letter{page-break-after:always;font-size:12pt;line-height:1.9}',
    '.letter:last-child{page-break-after:auto}',
    'h1{text-align:center;font-size:20pt;letter-spacing:6px;margin:0 0 8pt}',
    '.no{text-align:right;margin:0 0 12pt}',
    '.to{margin:0 0 10pt}',
    'p{margin:6pt 0;text-indent:2em}',
    '.to,p.no,.small,.addr{text-indent:0}',
    'table.amt{width:100%;border-collapse:collapse;margin:8pt 0}',
    'table.amt th,table.amt td{border:1px solid #000;padding:4pt 6pt}',
    '.c{width:60%}.r{text-align:right}',
    '.sign{display:flex;justify-content:space-between;margin-top:18pt;text-indent:0}',
    '.reply{margin-top:16pt;border-top:1px dashed #666;padding-top:8pt}',
    '.reply h2{font-size:12pt;margin:10pt 0 4pt}',
    '.reply p{text-indent:0}',
    '.addr{margin-top:14pt;font-size:10.5pt}',
    '.small{font-size:10.5pt}'
  ].join('\n');

  /** 文件名：函证_被审计单位_截止日 */
  function fileName(opts) {
    opts = opts || {};
    var parts = ['函证'];
    parts.push(str(opts.client || '未命名').replace(/[\\/:*?"<>|]/g, '_'));
    if (opts.cutOff) parts.push(str(opts.cutOff).replace(/[\\/:*?"<>|]/g, '_'));
    return parts.join('_');
  }

  return {
    VERSION: VERSION,
    toCents: toCents,
    moneyText: moneyText,
    norm: norm,
    str: str,
    detectHeader: detectHeader,
    parseRows: parseRows,
    mergeByName: mergeByName,
    isTotalName: isTotalName,
    makeRandom: makeRandom,
    selectEntities: selectEntities,
    controlRows: controlRows,
    modeText: modeText,
    letterHTML: letterHTML,
    printDocument: printDocument,
    fileName: fileName,
    dateTextOf: dateTextOf,
    chineseDate: chineseDate,
    LETTER_CSS: LETTER_CSS
  };
}));
