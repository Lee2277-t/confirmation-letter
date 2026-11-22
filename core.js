/*!
 * 函证助手 · 纯逻辑层（不碰 DOM，不碰文件）
 * 金额一律按「分」的整数算，只在显示和导出时除 100。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.3.1';

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
  // 只认「借方余额」这类；「借方发生额」是本期发生数，不是余额
  var DEBIT_WORDS = /借方余额|期末余额借方|期末借方|借方期末/;
  var CREDIT_WORDS = /贷方余额|期末余额贷方|期末贷方|贷方期末/;
  // 只有带币种字样的才是计量单位标注（「单位：元」「金额单位：元」）；
  // 光写「单位」是列名，不能当标注跳过
  var UNIT_LABEL = /^(单位|金额单位|人民币|单位人民币)?(元|万元)$/;

  /** 只有标签列允许带前缀的合计；无明细的行可在其余附属列识别独立合计标签。 */
  function isTotalRow(row, labelCols, hasDetails) {
    for (var i = 0; i < labelCols.length; i++) {
      if (labelCols[i] < 0) continue;
      var s = str(row[labelCols[i]]);
      if (s && isTotalName(s)) return true;
    }
    return !hasDetails && row.some(function (cell, col) {
      return col > 0 && /^(本页|本表|以上)?(合计|小计|总计|共计)$/.test(norm(str(cell).replace(/[（(][^）)]*[）)]/g, '')));
    });
  }

  function isTotalName(name) {
    // 括号必须在下 norm 之前剥掉：norm 会把括号当噪音删除，
    // 「合计（本币）」会变成「合计本币」，之后再也认不出
    var raw = norm(str(name).replace(/[（(][^）)]*[）)]/g, ''));
    if (!raw) return false;
    var s = raw
      .replace(/人民币元|人民币|美元|欧元|本位币|本币|原币|折算|含税|大写|单位|金额|数量|元/g, '')
      .replace(/[\s:：、,，.。]/g, '');
    if (!s) return false;
    // 一层层剥掉结尾的「数/额」：「合计数额」「合计累计数」都能归位
    var n = s;
    for (var ci = 0; ci < 4; ci++) {
      // 只看结尾：「合计贸易有限公司」是客户名，不是合计行
      if (/(合计|小计|总计|共计|累计|总额)$/.test(n)) return true;
      if (/^(合计|小计|总计|共计|累计|总额)(本页|本表|以上)?$/.test(n)) return true;
      var stripped = n.replace(/(数|额)$/, '');
      if (stripped === n) break;
      n = stripped;
    }
    return false;
  }
  /**
   * 一行能当表头吗？名称列和金额列必须是两列。
   * 标题行「往来单位期末余额表」里「单位」和「余额」在同一格，
   * 不这样排除就会把标题当表头，然后整张表读不出。
   */
  /* ---------- 列角色 ---------- */

  var NAME_STRONG = /单位名称|客户名称|供应商名称|往来单位|客户全称|单位全称/;
  var NAME_WEAK = /单位|客户|供应商|户名|公司名称|往来|名称/;
  var SUBJECT_WORDS = /科目名称|科目|项目名称|项目|类别|款项性质/;
  var CODE_WORDS = /编码|编号|代码|账号|卡号|账户/;
  var AMOUNT_WORDS = /余额|金额|发生额|数$/;
  var DIR_WORDS = /方向/;                       // 余额方向 / 借贷方向：是标识，不是金额
  var OPEN_WORDS = /期初|年初|上期|上月|上年年末/;  // 期初口径
  var CLOSE_WORDS = /期末|年末|本期期末/;          // 期末口径
  var PERIOD_WORDS = /本期|本月|本年|本季|累计/;     // 期间发生额
  // 只认真正标识「一笔交易」的列；「业务员」「业务类型」是人员/属性列，不是流水标志
  var FLOW_WORDS = /日期|凭证|摘要|单号|票号/;
  var UNIT_LABEL = /^(单位|金额单位|人民币|单位人民币)?(元|万元)$/;

  /**
   * 给一个表头单元格定角色。
   * side: 'D' 借方、'C' 贷方；period: 'open'|'close'|'period'|''；role: 见下
   */
  function roleOf(cell) {
    var t = norm(cell);
    if (!t) return null;
    if (UNIT_LABEL.test(t)) return { role: 'unit' };
    if (/^(最后|最近)(交易|业务|发生|往来)日期$/.test(t)) return { role: 'other' };
    if (FLOW_WORDS.test(t)) return { role: 'flow' };
    if (DIR_WORDS.test(t)) return { role: 'dir' };
    // 金蝶把往来单位叫「核算项目」，它就是函证对象；
    // 但「核算项目编码」「核算项目类别」是编码和分类，不能当名字
    if (/核算项目|辅助核算/.test(t)) {
      if (/编码|代码|编号/.test(t)) return { role: 'code' };
      if (/类别|类型|分类/.test(t)) return null;
      return { role: 'name', rank: 2 };
    }
    if (CODE_WORDS.test(t)) return { role: 'code' };
    if (/^(单位|客户|供应商|往来单位)(类别|类型|分类)$/.test(t)) return { role: 'other' };
    // 「科目名称」两重身份：既是科目，也可能是这张表里唯一的名字列（科目余额表）
    if (SUBJECT_WORDS.test(t)) {
      return /名称$/.test(t) ? { role: 'name', rank: 1, subject: true } : { role: 'subject' };
    }

    var side = /借方/.test(t) ? 'D' : (/贷方/.test(t) ? 'C' : '');
    var period = OPEN_WORDS.test(t) ? 'open'
      : (CLOSE_WORDS.test(t) ? 'close'
        : (PERIOD_WORDS.test(t) ? 'period' : ''));
    var isAmount = AMOUNT_WORDS.test(t) || side !== '' || period !== '';

    if (NAME_STRONG.test(t) && !CODE_WORDS.test(t)) {
      return { role: 'name', rank: 3 };
    }
    if (isAmount) {
      // 「发生额」「本期」是流量，不是余额
      // 判断依据只有三条：写着「发生额」=流水；写着「余额/期初/期末」=余额；
      // 带借贷方向又没有期间词的「金额」=流水（那是分录的两栏）
      var isBalanceWord = /余额/.test(t) || OPEN_WORDS.test(t) || CLOSE_WORDS.test(t);
      var kind = /发生额/.test(t) ? 'flow'
        : (isBalanceWord ? 'balance'
          : ((period === 'period' || side) ? 'flow' : 'balance'));
      return { role: 'amount', side: side, period: period, kind: kind, balWord: /余额/.test(t) };
    }
    if (NAME_WEAK.test(t)) return { role: 'name', rank: 2 };
    return { role: 'other' };
  }

  /** 一行能不能当表头：至少一个名称角色 + 一个金额角色，且必须是不同列 */
  function analyzeRow(row) {
    var cols = { name: [], amount: [], subject: [], code: [], dir: [], flow: [] };
    (row || []).forEach(function (cell, c) {
      var r = roleOf(cell);
      if (!r) return;
      if (r.role === 'name') {
        cols.name.push({ c: c, rank: r.rank });
        if (r.subject) cols.subject.push(c);
      }
      else if (r.role === 'amount') {
        cols.amount.push({ c: c, side: r.side, period: r.period, kind: r.kind, balWord: r.balWord, head: norm(cell) });
      }
      else if (r.role === 'subject') cols.subject.push(c);
      else if (r.role === 'code') cols.code.push(c);
      else if (r.role === 'dir') cols.dir.push(c);
      else if (r.role === 'flow') cols.flow.push(c);
    });
    var score = 0;
    if (cols.name.length && cols.amount.length) {
      score = cols.name.length * 3 + Math.min(cols.amount.length, 4) * 2
        + cols.subject.length + (cols.code.length ? 1 : 0);
      // 科目名称单独出现、又没有客户/单位字样时，更像科目余额表，分数压低
      var bestName = cols.name.slice().sort(function (a, b) { return b.rank - a.rank; })[0];
      if (bestName && bestName.rank < 2) score -= 2;
    }
    return { score: score, cols: cols };
  }

  /**
   * 两级表头：上一行是「期初余额 / 期末余额」这种分组，下一行是「借方 / 贷方」。
   * 合成 span=2，每个金额列的期间取自上一行、借贷方向取自下一行。
   */
  function analyzeTwoLevel(topRow, subRow, merges, rowIndex) {
    // 标题行 vs 两级表头：真正的两级表头里，名称列只在上一行出现一次；
    // 标题行则会在下一行再出现一个名称列（同一列）
    var nameRepeat = false;
    (topRow || []).forEach(function (cell, c) {
      var r = roleOf(cell);
      if (!r || r.role !== 'name') return;
      var r2 = roleOf((subRow || [])[c]);
      if (r2 && r2.role === 'name') nameRepeat = true;
    });
    if (nameRepeat) return { score: 0, cols: null };

    var groups = [];
    (merges || []).forEach(function (m) {
      if (m.s.r !== rowIndex || m.e.r !== rowIndex || m.s.c === m.e.c) return;
      for (var c = m.s.c; c <= m.e.c; c++) groups[c] = norm(topRow[m.s.c]);
    });
    var heads = [], grouped = 0, last = '', lastMerged = false;
    for (var c = 0; c < Math.max(topRow.length, subRow.length); c++) {
      var top = norm(topRow[c]), sub = norm(subRow[c]);
      if (top) { last = top; lastMerged = !!groups[c]; }
      // 有合并范围时不越过边界；没标范围的分组沿用左边的标题。
      var group = groups[c] || (lastMerged ? '' : last);
      var parent = roleOf(group);
      if (/^(借方|贷方)(金额|余额|发生额)?$|^(金额|余额|方向|余额方向)$/.test(sub) &&
          parent && parent.role === 'amount' && !parent.side) {
        grouped++;
        if (/^(借方|贷方)/.test(sub)) heads[c] = group + sub.slice(0, 2) + (/发生额$/.test(sub) ? '发生额' : '');
        else if (/方向$/.test(sub)) heads[c] = group + '方向';
        else heads[c] = group;
      } else {
        heads[c] = sub || top;
      }
    }
    if (grouped < 2) return { score: 0, cols: null };
    var result = analyzeRow(heads);
    if (result.score) result.score += 3;
    result.heads = heads;
    return result;
  }

  var PERIOD_ONLY = /^(期初余额|年初余额|期初金额|期初|年初|期末余额|年末余额|年末|余额|期末数|期末金额|金额|期末)$/;

  function amountScope(head) {
    return head.replace(/期初|年初|期末|年末|借方|贷方|余额|金额|人民币|本位币|本币|元$/g, '');
  }

  /** 从金额列里挑出要用的那一组：期末 > 未标 > 期间 > 期初 */
  function pickAmount(cols) {
    // 发生额不是余额：整张表只有发生额时，不能拿来发函
    var bal = cols.filter(function (a) { return a.kind === 'balance'; });
    if (!bal.length) return { flowOnly: true };
    cols = bal;
    var rankOf = function (p) {
      return p === 'close' ? 4 : (p === '' ? 3 : (p === 'period' ? 2 : 1));
    };
    var best = null;
    cols.forEach(function (a) {
      // 写着「余额」的列优先：
      // 「开票金额 1,800 / 已收 1,000 / 余额 800」不能因为余额排在第 3 列就选中 1,800
      var r = rankOf(a.period) * 10 + (a.kind === 'balance' ? 5 : 0) + (a.balWord ? 3 : 0);
      if (!best || r > best.r) best = { r: r, a: a };
    });
    if (!best) return null;
    var period = best.a.period;
    var candidates = cols.filter(function (a) { return a.period === period; });
    var generic = candidates.filter(function (a) {
      return !a.side && PERIOD_ONLY.test(a.head.replace(/(人民币|元)+$/, ''));
    });
    var net = generic.filter(function (a) { return a.balWord; });
    if (!net.length && period === 'close') net = generic;
    // 明示的整列余额优先；其余只有唯一口径时才读，不能把不同科目的借贷列配成一对。
    if (net.length === 1) return { debitCol: -1, creditCol: -1, amountCol: net[0].c, period: period };
    var debits = candidates.filter(function (a) { return a.side === 'D'; });
    var credits = candidates.filter(function (a) { return a.side === 'C'; });
    var D = debits[0], C = credits[0];
    var singles = candidates.filter(function (a) { return !a.side && (a.balWord || (!D && !C)); });
    if (debits.length > 1 || credits.length > 1 || singles.length > 1 ||
        (singles.length && (D || C)) || (D && C && amountScope(D.head) !== amountScope(C.head))) {
      return { wide: true };
    }
    if (D && C) return { debitCol: D.c, creditCol: C.c, amountCol: -1, period: period };
    if (D) return { debitCol: -1, creditCol: -1, amountCol: D.c, period: period, positive: true };
    if (C) return { debitCol: -1, creditCol: C.c, amountCol: -1, period: period };
    // 没有借贷列就用刚刚评出来的那一列——不能回头取「第一列」，
    // 否则「开票金额 / 已收金额 / 余额」会选中开票金额
    return { debitCol: -1, creditCol: -1, amountCol: best.a.c, period: period, kind: best.a.kind };
  }
  /**
   * 找表头。返回各列位置 + usable（能不能用来发函）+ problems（提示，不影响 usable）。
   */
  function detectHeader(rows, sheetName, merges) {
    var limit = Math.min(rows.length, 20);
    var best = { rowIndex: -1, score: 0 };

    for (var r = 0; r < limit; r++) {
      var one = analyzeRow(rows[r]);
      if (one.score > best.score) best = { rowIndex: r, score: one.score, span: 1, a: one };
      if (r + 1 < limit) {
        var two = analyzeTwoLevel(rows[r] || [], rows[r + 1] || [], merges, r);
        if (two.score > best.score) best = { rowIndex: r, score: two.score, span: 2, a: two };
      }
    }

    if (best.rowIndex < 0 || best.score < 4) {
      return {
        rowIndex: -1, span: 1, nameCol: -1, amountCol: -1, subjectCol: -1, codeCol: -1,
        debitCol: -1, creditCol: -1, dirCol: -1, usable: false, amountKind: '',
        problems: ['找不到能认的表头（需要一列单位/客户名称，一列余额或金额）']
      };
    }

    var a = best.a, cols = a.cols;
    var heads = a.heads || rows[best.rowIndex];
    var problems = [];
    var span = best.span;

    // 金额单位只认元。见到万元/千元/百万元（连同单位、金额、余额这类词）就拒绝：
    // 自动换算猜错就是一万倍的差错。页脚、列名后缀、注释里写的也算。
    // 金额单位只认元。全表任何格子（含工作表名）出现「万元/千元/亿元/百万元」
    // 就拒绝——不猜是标题、列名、页脚还是正文。宁可让人换算一次，不能差一万倍。
    var unitWord = '';
    var UNIT_TOKEN = /(百万元|万元|千元|亿元|万\s*元|千\s*元)/;
    var allText = [];
    for (var ur = 0; ur < rows.length; ur++) {
      var cells = rows[ur] || [];
      for (var uc = 0; uc < cells.length; uc++) {
        var us = str(cells[uc]);
        if (us) allText.push(us);
      }
    }
    if (typeof sheetName !== 'undefined' && sheetName) allText.push(String(sheetName));
    for (var ti = 0; ti < allText.length && !unitWord; ti++) {
      var tm = UNIT_TOKEN.exec(allText[ti]);
      if (tm) unitWord = tm[1].replace(/\s+/g, '');
    }
    if (!unitWord) {
      // 「单位：万」「金额（万）」这种简写
      for (var si = 0; si < allText.length && !unitWord; si++) {
        if (/(单位|金额|余额)\s*[:：]?\s*[（(]?\s*[万亿]\s*[）)]?\s*$/.test(allText[si])) unitWord = '万/亿';
      }
    }
    // 名称列：客户/单位优先，其次泛称，最后才是科目名称
    var nameCol = cols.name.slice().sort(function (x, y) {
      return y.rank - x.rank || x.c - y.c;
    })[0].c;
    var nameHead = norm(heads[nameCol]);
    var nameIsCounterparty = /单位|客户|供应商|户名|往来|核算项目/.test(nameHead);
    var partyCodeCol = cols.code.filter(function (c) {
      return /^(往来单位|客户|供应商|单位|核算项目|辅助核算)(编码|编号|代码)$/.test(norm(heads[c]));
    })[0];

    var picked = pickAmount(cols.amount);
    var flowOnly = !!(picked && picked.flowOnly);
    var isWide = !!(picked && picked.wide);
    var amountCol = picked && !flowOnly && !isWide ? picked.amountCol : -1;
    var debitCol = picked && !flowOnly && !isWide ? picked.debitCol : -1;
    var creditCol = picked && !flowOnly && !isWide ? picked.creditCol : -1;
    var subjectCol = cols.subject.length ? cols.subject[0]
      : (/科目名称|^科目$/.test(nameHead) ? nameCol : -1);
    var codeCol = partyCodeCol !== undefined ? partyCodeCol : (cols.code.length ? cols.code[0] : -1);
    var dirCol = (function () {
      if (picked && picked.positive) return -1;
      // 优先同期间方向，通用方向次之；期初或发生额的方向不能用于期末。
      var dirs = cols.dir.filter(function (c) {
        var head = norm(heads[c]);
        return !OPEN_WORDS.test(head) && (CLOSE_WORDS.test(head) || !PERIOD_WORDS.test(head));
      });
      var close = dirs.filter(function (c) { return CLOSE_WORDS.test(norm(heads[c])); })[0];
      return close !== undefined ? close : (dirs.length ? dirs[0] : -1);
    }());
    var labelCols = [nameCol, subjectCol, codeCol, dirCol];
    var firstRole = roleOf(heads[0]);
    if (norm(heads[0]) === '序号' || (firstRole && /^(name|subject|code|dir)$/.test(firstRole.role))) {
      if (labelCols.indexOf(0) < 0) labelCols.push(0);
    }

    // 流水账：有日期/凭证/摘要，且金额是「借/贷」两列 —— 每行是一笔交易，不是每个单位的余额
    // 流水账：有日期/凭证/摘要，且要么有多列金额（金额 + 余额 = 逐笔累计），
    // 要么金额列本身带借贷/发生额。
    // 只有「日期 + 期末余额」的一行一户表不是流水——那是带最后交易日的余额表。
    var hasSided = cols.amount.some(function (a) { return !!a.side; });
    var hasBal = cols.amount.some(function (a) { return a.kind === 'balance'; });
    // 借贷两栏且没有余额列，才是分录式流水
    var sidedOrFlowAmt = hasSided && !hasBal;
    // 「日期 + 期初余额 + 期末余额」是带日期的余额表；
    // 只有出现「没写期间的金额」或借贷/发生额列，才是流水
    var hasUnlabeledAmt = cols.amount.some(function (a) { return !a.balWord && !a.period; });
    var isFlow = cols.flow.length > 0 && (sidedOrFlowAmt || hasUnlabeledAmt);
    // 只有期初余额：函证要的是截止日余额，期初会误导
    var isOpening = picked && picked.period === 'open';
    // 只有发生额：同样不是余额
    var isPeriod = picked && picked.kind === 'flow';
    // 裸「余额」加交易列时，重名或完整的凭证信息都可能表明是逐笔累计余额。
    var dupNames = false, conflictingCodes = false;
    (function () {
      var seen = Object.create(null);
      var lastName = '';
      var start = best.rowIndex + (best.span === 2 ? 2 : 1);
      for (var dr = start; dr < rows.length; dr++) {
        var row = rows[dr] || [];
        var dn = norm(row[nameCol]);
        if (isTotalRow(row, labelCols, dn || str(row[subjectCol]).trim() || str(row[codeCol]).trim())) continue;
        if (!dn) {
          // 余额明细的空名称会沿用上一户。空行和只有备注的行不算一笔。
          if (lastName && amountCol >= 0 && toCents(row[amountCol]) !== null) dupNames = true;
          continue;
        }
        lastName = dn;
        var code = partyCodeCol === undefined ? '' : str(row[partyCodeCol]).trim();
        if (seen[dn] !== undefined) {
          dupNames = true;
          if (code && seen[dn] && seen[dn] !== code) conflictingCodes = true;
        }
        if (code || seen[dn] === undefined) seen[dn] = code;
      }
    }());

    var pickedHead = picked && picked.amountCol >= 0
      ? norm(heads[picked.amountCol]) : '';
    // 台账：余额列可能是「余额（元）」「本币余额」「累计余额」——先剥掉币种和修饰再判断
    var ledgerHead = pickedHead
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/人民币|本位币|本币|累计|元$/g, '');
    var flowHeads = cols.flow.map(function (c) { return norm(heads[c]); });
    var hasVoucherDetails = flowHeads.some(function (s) { return /日期$/.test(s); }) &&
      flowHeads.some(function (s) { return /^(凭证(字号|编号|号码|号)|单据(编号|号码|号))$/.test(s); }) &&
      flowHeads.some(function (s) { return s === '摘要'; });
    var isLedger = /^(余额|结余)$/.test(ledgerHead) && (hasVoucherDetails || (cols.flow.length > 0 && dupNames));

    var isSubjectTable = !nameIsCounterparty &&
      (/科目名称|项目名称|^科目$|^名称$/.test(nameHead) ||
        (cols.code.length && /科目|项目/.test(norm(heads[cols.code[0]]))));

    if (debitCol >= 0 && creditCol >= 0) problems.push('检测到借方、贷方两列，按 借−贷 合成净额');
    if (span === 2) problems.push('两级表头：期间取自上一行，借贷取自下一行');
    if (isFlow) problems.push('这张表看起来是流水账（有日期/凭证/摘要），每行是一笔交易，不是每个单位的余额——请换成往来余额表');
    if (isOpening) problems.push('用的是「期初余额」，函证要的是截止日（期末）余额——请确认这张表是不是期末数');
    if (isPeriod) problems.push('用的是「发生额」，不是余额——函证金额通常是余额');
    if (isSubjectTable) problems.push('这张表看起来是科目余额表（科目编码 + 科目名称），不是往来单位明细');
    if (unitWord) {
      problems.push('表的金额单位写着「' + unitWord + '」——本工具只认元。请先把金额乘成元再导入；自动换算猜错就是一万倍的差错，所以这里不做。');
    }

    if (isWide) {
      problems.push('这张表的余额列有多种口径，分不清该函哪一列——请只保留要函证的余额列，或加一列总的「期末余额」。');
    }
    if (flowOnly) problems.push('这张表只有「发生额」，没有余额——函证金额通常取余额，请换成余额表');
    if (conflictingCodes) problems.push('同名单位有不同的往来编码，无法确定能否合成一封函——请核对编码，同一家单位统一编码，不同单位用可区分的名称。');
    if (isLedger && !conflictingCodes) problems.push('这张表像是逐笔明细台账（有摘要/日期，只有一个「余额」），余额是逐笔累计的，按单位相加会翻倍——请换成按单位汇总的余额表');
    if (cols.dir.length && (debitCol >= 0 || creditCol >= 0)) {
      problems.push('同时有借贷列和方向列，已按借贷两列算净额，方向列不再重复取反');
    }

    var usable = nameCol >= 0 && (amountCol >= 0 || debitCol >= 0 || creditCol >= 0) &&
      !isSubjectTable && !isFlow && !flowOnly && !isOpening && !unitWord && !isWide && !isLedger && !conflictingCodes;

    var kind = '';
    if (debitCol >= 0 || creditCol >= 0) kind = '余额';
    else if (amountCol >= 0) kind = picked && picked.kind === 'flow' ? '发生额' : '余额';

    return {
      rowIndex: best.rowIndex, span: span,
      nameCol: nameCol, amountCol: amountCol,
      subjectCol: subjectCol, codeCol: codeCol, labelCols: labelCols,
      debitCol: debitCol, creditCol: creditCol, dirCol: dirCol,
      creditOnly: creditCol >= 0 && debitCol < 0,
      period: picked ? picked.period : '',
      usable: usable,
      amountKind: kind,
      unitScale: 1,
      problems: problems
    };
  }
  function parseRows(rows, header, opts) {
    opts = opts || {};
    var firstExcelRow = opts.firstExcelRow || 1;
    var entities = [];
    var skipped = [];
    var problems = (header.problems || []).slice();

    var useDebitCredit = header.debitCol >= 0 && header.creditCol >= 0;
    var creditOnly = !!header.creditOnly;
    if (header.rowIndex < 0 || header.nameCol < 0 ||
        (!useDebitCredit && !creditOnly && header.amountCol < 0)) {
      return { entities: [], skipped: [], problems: problems };
    }
    // 两级表头占两行，数据从再下一行开始；单级表头下一行就是数据
    var dataStart = header.rowIndex + (header.span === 2 ? 2 : 1);
    // 真实的名称合并范围可以证明空白行属于哪一家，不能按金额猜成合计。
    var mergedNames = [], mergedAmounts = [];
    (opts.merges || []).forEach(function (m) {
      var col = m.s.c;
      if (m.s.r < dataStart || col !== m.e.c || m.s.r === m.e.r) return;
      var first = rows[m.s.r] || [];
      for (var mr = m.s.r + 1; mr <= m.e.r && mr < rows.length; mr++) {
        if (col === header.nameCol) mergedNames[mr] = str(first[col]).trim();
        if (col !== header.amountCol && col !== header.debitCol && col !== header.creditCol) continue;
        var below = rows[mr] || [];
        if ((norm(below[header.nameCol]) && norm(below[header.nameCol]) !== norm(first[header.nameCol])) ||
            (norm(below[header.subjectCol]) && norm(below[header.subjectCol]) !== norm(first[header.subjectCol]))) {
          mergedAmounts.push(firstExcelRow + m.s.r);
          break;
        }
      }
    });
    var lastName = '';
    var runSum = 0;    // 已经读过的金额累计，用来认合计行
    var runRows = 0;   // 累计了几行
    var ambiguous = [];  // 分不清是合计行还是续行的行号
    var unmatchedNames = [];  // 无法归到上一户的行号
    var labelCols = header.labelCols || [header.nameCol, header.subjectCol, header.codeCol, header.dirCol];

    for (var r = dataStart; r < rows.length; r++) {
      var row = rows[r] || [];
      var excelRow = firstExcelRow + r;
      var rawName = str(row[header.nameCol]).trim();
      var name = rawName || mergedNames[r] || lastName;
      var subject = '', rawSubject = '';
      if (header.subjectCol >= 0) {
        // 科目不沿用：合并或留空时记成「未填科目」，比把钱记到上一行科目头上诚实
        subject = str(row[header.subjectCol]).trim();
        rawSubject = subject;
      }
      var code = header.codeCol >= 0 ? str(row[header.codeCol]).trim() : '';
      if (isTotalRow(row, labelCols, rawName || rawSubject || code)) {
        skipped.push({ srcRow: excelRow, reason: '合计行', name: name });
        continue;
      }
      if (rawName) lastName = rawName;

      var cents = null, rawAmount = '', how = '', unreadable = '';

      if (useDebitCredit) {
        var dRaw = row[header.debitCol], cRaw = row[header.creditCol];
        var d = toCents(dRaw), cr = toCents(cRaw);
        // 一格有内容却读不出（「待核实」「#REF!」）不能当 0
        if (str(dRaw).trim() !== '' && d === null) unreadable = '借方';
        else if (str(cRaw).trim() !== '' && cr === null) unreadable = '贷方';
        if (unreadable) cents = null;
        else if (d === null && cr === null) cents = null;
        else cents = (d || 0) - (cr || 0);
        rawAmount = str(dRaw) + '/' + str(cRaw);
        how = '借−贷';
      } else if (creditOnly) {
        rawAmount = row[header.creditCol];
        cents = toCents(rawAmount);
        // 只有「贷方余额」一列时，贷方余额是负数
        if (cents !== null) cents = -cents;
        how = '贷方余额';
      } else {
        rawAmount = row[header.amountCol];
        cents = toCents(rawAmount);
      }

      if (unreadable) {
        skipped.push({ srcRow: excelRow, reason: '金额读不出', name: name || '', raw: unreadable + '列：' + rawAmount });
        continue;
      }
      if (cents !== null && header.unitScale > 1) cents = cents * header.unitScale;

      // 方向列：写「贷」的当负数。借贷两列本身带符号，再取反会翻两次。
      if (cents !== null && header.dirCol >= 0 && !useDebitCredit && !creditOnly) {
        var dir = norm(row[header.dirCol]);
        if (/^贷/.test(dir) && cents > 0) cents = -cents;
        else if (/^借/.test(dir) && cents < 0) cents = -cents;
      }

      // 整行都空的才算空行——用原始值判断，不能用沿用后的名称
      var blank = !rawName && str(rawAmount).trim() === '' && !rawSubject && !code;
      if (useDebitCredit && !rawName && !rawSubject && !code &&
        str(row[header.debitCol]).trim() === '' && str(row[header.creditCol]).trim() === '') {
        blank = true;
      }
      if (blank) continue;

      // 同额或有几分尾差，都不足以证明没有标签的行是合计。
      if (!rawName && !rawSubject && !mergedNames[r] && cents !== null && cents !== 0) {
        var diff = Math.abs(cents - runSum);
        if ((diff === 0 && runRows >= 1) || (diff <= 100 && runRows >= 2)) {
          ambiguous.push(excelRow);
          continue;
        }
        if (name) {
          unmatchedNames.push(excelRow);
          continue;
        }
      }

      if (!name) {
        if (cents !== null && cents !== 0) {
          skipped.push({ srcRow: excelRow, reason: '没有单位名称', name: '', cents: cents });
        }
        continue;
      }
      if (cents === null) {
        skipped.push({ srcRow: excelRow, reason: '金额读不出', name: name, raw: rawAmount });
        continue;
      }

      runSum += cents;
      runRows++;
      entities.push({
        name: name, subject: subject, code: code,
        cents: cents, srcRow: excelRow, how: how
      });
    }

    var rejections = [];
    if (ambiguous.length) rejections.push('第 ' + ambiguous.join('、') + ' 行没有单位名称，金额又与上面明细合计相同或接近——' +
      '分不清是合计行还是同一户的又一行。请在原表里补上单位名称，或删掉合计行，再导入。');
    if (unmatchedNames.length) rejections.push('第 ' + unmatchedNames.join('、') +
      ' 行没有单位名称，金额也与上面的合计对不上。请在原表里核对并补上单位名称，再导入。');
    if (mergedAmounts.length) rejections.push('第 ' + mergedAmounts.join('、') + ' 行的合并金额跨单位或科目，无法分配余额——请拆分合并格并按单位、科目填写金额。');
    if (rejections.length) {
      header.usable = false;
      rejections.forEach(function (msg) {
        problems.push(msg);
        if (header.problems && header.problems.indexOf(msg) < 0) header.problems.push(msg);
      });
    }

    if (skipped.length) {
      var noName = skipped.filter(function (s) { return s.reason === '没有单位名称'; }).length;
      var badAmt = skipped.filter(function (s) { return s.reason === '金额读不出'; }).length;
      var totals = skipped.filter(function (s) { return s.reason === '合计行'; }).length;
      if (noName) problems.push(noName + ' 行有金额但没有单位名称，没有计入（请回原表核对）');
      if (badAmt) problems.push(badAmt + ' 行的金额读不出，没有计入');
      if (totals) problems.push('跳过 ' + totals + ' 行合计行');
    }
    return { entities: entities, skipped: skipped, problems: problems, ambiguous: ambiguous };
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
      if (mode === 'sample') { big = []; rest = pool.filter(function (e) { return e.cents !== 0; }); }
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
  /** 控制表/列表里的科目文字：没填科目的部分也要写出来，否则底稿上钱没有归属 */
  function subjectTextOf(s) {
    var list = (s.subjects || []).slice();
    if (s.noSubjectCents) list.push('未填科目');
    return list.join('、');
  }

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
        s.no, s.name, subjectTextOf(s),
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
      head.push(['读取情况（下面这些提示请逐条核对，涉及金额的已跳过、未参与函证）']);
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
