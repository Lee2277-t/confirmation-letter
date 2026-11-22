/*!
 * 函证助手 · 纯逻辑层（不碰 DOM，不碰文件）
 * 金额一律按「分」的整数算，只在显示和导出时除 100。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.1.1';

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
  // 「客户编码」「供应商编号」里也有「客户」「供应商」，不能当单位名称列
  var CODE_WORDS = /编码|编号|代码|账号|卡号|账户/;
  var DEBIT_WORDS = /借方余额|借方期末|借方/;
  var CREDIT_WORDS = /贷方余额|贷方期末|贷方/;

  function isTotalName(name) {
    var n = norm(name);
    if (!n) return false;
    // 「合计（人民币）」「本期合计」「合  计」都要认，但不能把「合计贸易有限公司」当合计行
    var core = '合计|总计|小计|共计';
    var prefix = new RegExp('^(' + core + ')');
    var m = prefix.exec(n);
    if (m) {
      var rest = n.slice(m[0].length);
      if (!rest) return true;
      return /^(人民币|元|金额|本页|本表|本期|本季|本年|累计|以上|以下|及){1,3}$/.test(rest) && rest.length <= 6;
    }
    var suffix = new RegExp('^(本页|本表|本期|本季|本年|累计|以上)(' + core + ')$');
    return suffix.test(n);
  }

  /**
   * 一行能当表头吗？名称列和金额列必须是两列。
   * 标题行「往来单位期末余额表」里「单位」和「余额」在同一格，
   * 不这样排除就会把标题当表头，然后整张表读不出。
   */
  function analyzeRow(row) {
    var nameCols = [], amountCols = [], subjectCols = [], codeCols = [];
    var debitCols = [], creditCols = [];
    (row || []).forEach(function (cell, c) {
      var t = norm(cell);
      if (!t) return;
      var isCode = CODE_WORDS.test(t);
      var isDebit = DEBIT_WORDS.test(t);
      var isCredit = CREDIT_WORDS.test(t);
      if (isDebit) { debitCols.push(c); return; }
      if (isCredit) { creditCols.push(c); return; }
      if (isCode) { codeCols.push(c); return; }
      if (NAME_WORDS.test(t)) { nameCols.push(c); return; }
      if (AMOUNT_WORDS.test(t)) { amountCols.push(c); return; }
      if (SUBJECT_WORDS.test(t)) subjectCols.push(c);
    });
    // 借贷两列都在，就不用单列余额
    var hasBoth = debitCols.length > 0 && creditCols.length > 0;
    var score = nameCols.length * 3 + (hasBoth ? 3 : amountCols.length * 2) +
      subjectCols.length + (codeCols.length ? 1 : 0);
    if (!nameCols.length || (!amountCols.length && !hasBoth)) score = 0;
    return {
      score: score, nameCols: nameCols, amountCols: amountCols,
      subjectCols: subjectCols, codeCols: codeCols,
      debitCols: debitCols, creditCols: creditCols, hasBoth: hasBoth
    };
  }

  /**
   * 找表头。要求至少一个「名称」列 + 一个「金额」列（或借贷两列）。
   * 找不到就返回 rowIndex:-1 和原因，不硬猜。
   */
  function detectHeader(rows) {
    var limit = Math.min(rows.length, 20);
    var best = { rowIndex: -1, score: 0 };
    for (var r = 0; r < limit; r++) {
      var a = analyzeRow(rows[r]);
      if (a.score > best.score) best = { rowIndex: r, score: a.score, a: a };
    }
    if (best.rowIndex < 0 || best.score < 5) {
      return { rowIndex: -1, nameCol: -1, amountCol: -1, subjectCol: -1, codeCol: -1,
        debitCol: -1, creditCol: -1, dirCol: -1,
        problems: ['找不到能认的表头（需要一列单位/客户名称，一列余额或金额）'] };
    }

    var a2 = best.a;
    var nameCol = a2.nameCols[0];
    var amountCol = -1, amountRank = -1, debitCol = -1, creditCol = -1, dirCol = -1;
    var row = rows[best.rowIndex] || [];

    if (a2.hasBoth) {
      debitCol = a2.debitCols[0];
      creditCol = a2.creditCols[0];
    } else {
      a2.amountCols.forEach(function (c) {
        var t = norm(row[c]);
        // 「期末余额」优先于「发生额」，避免拿到借方发生额
        var rank = /期末余额|期末数/.test(t) ? 3 : (/余额/.test(t) ? 2 : 1);
        if (rank > amountRank) { amountRank = rank; amountCol = c; }
      });
    }

    // 方向列（借/贷）会影响金额符号
    for (var c2 = 0; c2 < row.length; c2++) {
      if (/^(方向|借贷方向|余额方向)$/.test(norm(row[c2]))) { dirCol = c2; break; }
    }

    var problems = [];
    if (debitCol < 0 && creditCol < 0 && amountCol < 0) problems.push('没找到余额或金额列');
    if (debitCol >= 0 && creditCol >= 0) {
      problems.push('检测到「借方余额」和「贷方余额」两列，按 借−贷 合成净额');
    }

    return {
      rowIndex: best.rowIndex, nameCol: nameCol, amountCol: amountCol,
      subjectCol: a2.subjectCols.length ? a2.subjectCols[0] : -1,
      codeCol: a2.codeCols.length ? a2.codeCols[0] : -1,
      debitCol: debitCol, creditCol: creditCol, dirCol: dirCol,
      problems: problems
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

    var useDebitCredit = header.debitCol >= 0 && header.creditCol >= 0;
    if (header.rowIndex < 0 || header.nameCol < 0 ||
        (!useDebitCredit && header.amountCol < 0)) {
      return { entities: [], skipped: [], problems: problems };
    }

    for (var r = header.rowIndex + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var excelRow = firstExcelRow + r;
      var name = str(row[header.nameCol]).trim();
      var subject = header.subjectCol >= 0 ? str(row[header.subjectCol]).trim() : '';
      var code = header.codeCol >= 0 ? str(row[header.codeCol]).trim() : '';

      var cents = null, rawAmount = '', how = '';
      if (useDebitCredit) {
        var d = toCents(row[header.debitCol]);
        var cr = toCents(row[header.creditCol]);
        if (d === null && cr === null) cents = null;
        else cents = (d || 0) - (cr || 0);
        rawAmount = str(row[header.debitCol]) + '/' + str(row[header.creditCol]);
        how = '借−贷';
      } else {
        rawAmount = row[header.amountCol];
        cents = toCents(rawAmount);
      }

      // 方向列：写「贷」的当负数（往来表里预收/应付常见）
      if (cents !== null && header.dirCol >= 0) {
        var dir = norm(row[header.dirCol]);
        if (/^贷/.test(dir) && cents > 0) cents = -cents;
        else if (/^借/.test(dir) && cents < 0) cents = -cents;
      }

      var blank = !name && str(rawAmount).trim() === '' && !subject;
      if (blank) continue;
      if (isTotalName(name)) { skipped.push({ srcRow: excelRow, reason: '合计行', name: name }); continue; }

      if (!name) {
        // 有金额没名字：不能静默丢，否则这笔钱在函证清单里彻底消失
        if (cents !== null && cents !== 0) {
          skipped.push({ srcRow: excelRow, reason: '没有单位名称', name: '', cents: cents });
        }
        continue;
      }
      if (cents === null) {
        skipped.push({ srcRow: excelRow, reason: '金额读不出', name: name, raw: rawAmount });
        continue;
      }

      entities.push({
        name: name, subject: subject, code: code,
        cents: cents, srcRow: excelRow, how: how
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
        map[k] = {
          name: e.name, cents: 0, subjects: [], subjectCents: {},
          codes: [], srcRows: [], count: 0, noSubjectCents: 0
        };
        order.push(k);
      }
      map[k].cents += e.cents;
      map[k].count++;
      if (e.subject) {
        if (map[k].subjects.indexOf(e.subject) < 0) map[k].subjects.push(e.subject);
        map[k].subjectCents[e.subject] = (map[k].subjectCents[e.subject] || 0) + e.cents;
      } else {
        // 科目空着的钱也要有去处，否则函里「合计」比明细多出一截，对方一看就对不上
        map[k].noSubjectCents += e.cents;
      }
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
        // 余额为 0 的户发函没有意义，抽样时不进池子（选「全部」时仍然给，由人自己决定）
        if (e.cents === 0) return;
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
          noSubjectCents: e.noSubjectCents || 0,
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

    // 读表时发现的问题也要落进底稿：只在界面提示的话，归档之后没人知道这几行被跳过
    var notes = opts.notes || [];
    if (notes.length) {
      head.push([]);
      head.push(['读取情况（这些行没有参与函证，请回原表核对）']);
      notes.forEach(function (n) { head.push([n]); });
    }
    var excl = opts.excludedNames || [];
    if (excl.length) {
      head.push([]);
      head.push(['人工排除（未发函）：' + excl.join('、')]);
    }
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
    // 科目空着的钱单列一行，否则明细加起来对不上合计。
    var subs = (entity.subjects || []).slice();
    var subAmt = entity.subjectCents || {};
    var noSub = entity.noSubjectCents || 0;
    if (noSub !== 0) subs.push('未填科目');
    if (!subs.length) subs = ['往来款项'];

    var rows = subs.map(function (subj) {
      var amt = subj === '未填科目' ? noSub : (subAmt[subj] !== undefined ? subAmt[subj] : entity.cents);
      return '<tr><td class="c">' + esc(subj) + '</td><td class="r">' +
        esc(moneyText(amt)) + '</td></tr>';
    }).join('');

    var sumShown = subs.reduce(function (a, subj) {
      return a + (subj === '未填科目' ? noSub : (subAmt[subj] !== undefined ? subAmt[subj] : entity.cents));
    }, 0);
    if (subs.length > 1 && sumShown !== entity.cents) {
      // 明细和总额对不上时必须让差额自己现形，不能悄悄用总额盖过去
      rows += '<tr><td class="c">其他</td><td class="r">' + esc(moneyText(entity.cents - sumShown)) + '</td></tr>';
    }
    if (subs.length > 1) {
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
      '<title>' + str(opts.client || '').replace(/[<>&]/g, function (c) {
        return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
      }) + ' 询证函' + '</title>' +
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
