// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// three views: the ranked board of pre-token protocols, one protocol's detail (its figures, the
// model's arithmetic for its implied value, and its farm plan exactly as the board carries it), the
// live-token protocols the radar sets aside, and the method. No network: every byte is in data.js.

(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('board');

  var state = {
    view: 'board', // board | detail | live | method
    slug: null,
    query: '',
    category: '',
    chain: '',
    watchlistOnly: false,
    minTvl: 0,
    sortKey: 'rank',
    sortDir: 1,
  };

  /* ---------------- formatting ---------------- */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }

  function fmtUsdFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (n === null || n === undefined) return '<span class="na">—</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function fmtMult(n) {
    return '×' + Number(n).toFixed(2);
  }

  function ratioOf(row) {
    return row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : 0;
  }

  function chainsText(chains, limit) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= limit) return chains.join(', ');
    return chains.slice(0, limit).join(', ') + ' +' + (chains.length - limit);
  }

  /* ---------------- shared chrome ---------------- */

  function masthead() {
    return (
      '<header class="masthead">' +
      '<p class="kicker">Token launch radar · model ' + esc(DATA.model_version) + '</p>' +
      '<h1>Protocols that have not launched a token yet, ranked by what one would be worth</h1>' +
      '<p class="lede">Every protocol in the snapshot that records no token is priced the way the market ' +
      'already prices its tokenized peers: <strong>TVL × its category&rsquo;s market-cap/TVL multiple</strong>, ' +
      'adjusted for seven-day growth and for how long it has run tokenless. The board is a model&rsquo;s claim, ' +
      'not a prediction that a token will come.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>found below the floor</span></div>' +
      '<div class="stat"><b class="amber">' + fmtUsd(DATA.rows.length ? DATA.rows[0].implied_value_usd : 0) + '</b><span>top implied value</span></div>' +
      '<div class="stat"><b>' + esc(DATA.as_of) + '</b><span>snapshot date</span></div>' +
      '</div>' +
      '</header>'
    );
  }

  function tabs() {
    function tab(view, label) {
      var selected = state.view === view || (view === 'board' && state.view === 'detail');
      return '<button class="tab" data-view="' + view + '" aria-selected="' + selected + '">' + label + '</button>';
    }
    return (
      '<nav class="tabs" role="tablist">' +
      tab('board', 'The board') +
      tab('live', 'Already tokenized (' + DATA.live_size + ')') +
      tab('method', 'How the model works') +
      '</nav>'
    );
  }

  function footer() {
    return (
      '<footer>Snapshot: ' + esc(DATA.source) + '. “Records no token” is what the snapshot says, not proof a ' +
      'protocol has none: a record can lag a launch. Implied values follow the stated model from the snapshot&rsquo;s ' +
      'own figures; farm plans are starting points, not advice — check the protocol&rsquo;s own pages before moving funds.</footer>'
    );
  }

  /* ---------------- the board ---------------- */

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function allChains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.query.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    var val = function (r) {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'ratio') return ratioOf(r);
      return r.rank;
    };
    rows.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function controls() {
    var catOptions = '<option value="">All categories</option>' + categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOptions = '<option value="">All chains</option>' + allChains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var tvlOptions = [[0, 'Any TVL'], [5e7, '$50M and up'], [1e8, '$100M and up'], [5e8, '$500M and up'], [1e9, '$1B and up']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.minTvl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return (
      '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="Name, category, chain…" value="' + esc(state.query) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat">' + catOptions + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + chainOptions + '</select></div>' +
      '<div class="field"><label for="mintvl">TVL floor</label><select id="mintvl">' + tvlOptions + '</select></div>' +
      '<label class="check"><input id="wl" type="checkbox"' + (state.watchlistOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '</div>'
    );
  }

  function th(key, label, num) {
    var active = state.sortKey === key;
    var arrow = active ? ' <span class="dir">' + (state.sortDir === 1 ? '▲' : '▼') + '</span>' : '';
    return '<th class="' + (num ? 'num' : '') + '"><button data-sort="' + key + '">' + label + arrow + '</button></th>';
  }

  function boardView() {
    var rows = filteredRows();
    var body = rows.map(function (r) {
      return (
        '<tr tabindex="0" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="pname">' + esc(r.name) + (r.watchlist ? '<span class="badge">Watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(chainsText(r.chains, 2)) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num value">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num ratio">' + ratioOf(r).toFixed(2) + '×</td>' +
        '</tr>'
      );
    }).join('');
    if (rows.length === 0) body = '<tr><td colspan="9"><div class="empty">No protocol matches those filters. Loosen one and the board comes back.</div></td></tr>';
    return (
      masthead() + tabs() + controls() +
      '<p class="count">Showing <b>' + rows.length + '</b> of ' + DATA.board_size + ' ranked protocols · click a row for its valuation and farm plan</p>' +
      '<div class="tablewrap"><table><thead><tr>' +
      th('rank', '#', true) + th('name', 'Protocol', false) + '<th>Category</th><th>Chains</th>' +
      th('tvl', 'TVL', true) + th('change', '7d', true) + th('age', 'Age', true) +
      th('implied', 'Implied value', true) + th('ratio', '× TVL', true) +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      footer()
    );
  }

  /* ---------------- one protocol ---------------- */

  function detailView() {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.slug) row = r; });
    if (row === null) return masthead() + tabs() + '<p class="count">That protocol is not on the board.</p>' + footer();

    var base = row.tvl_usd * row.category_multiple;
    var multipleNote = row.comps > 0
      ? 'median of ' + row.comps + ' tokenized ' + esc(row.category || 'protocol') + ' comp' + (row.comps === 1 ? '' : 's') + ', shrunk to the market'
      : 'the global median — no tokenized ' + esc(row.category || 'protocol') + ' comps in the snapshot';
    var growthNote = row.change_7d === null
      ? 'no 7-day figure recorded — neutral'
      : '7-day TVL change ' + (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%';
    var maturityNote = row.age_days === null
      ? 'listing date not recorded — 365 days assumed'
      : 'tracked for ' + row.age_days + ' days, tokenless throughout';

    var cards =
      '<div class="cards">' +
      '<div class="card"><span>Rank</span><b>#' + row.rank + ' of ' + DATA.board_size + '</b></div>' +
      '<div class="card"><span>Implied value</span><b class="amber">' + fmtUsdFull(row.implied_value_usd) + '</b></div>' +
      '<div class="card"><span>TVL</span><b>' + fmtUsdFull(row.tvl_usd) + '</b></div>' +
      '<div class="card"><span>Implied / TVL</span><b>' + ratioOf(row).toFixed(2) + '×</b></div>' +
      '<div class="card"><span>7-day TVL</span><b>' + (row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div class="card"><span>Tracked since</span><b>' + (row.listed_at || '—') + '</b></div>' +
      '</div>';

    var equation =
      '<div class="equation">' +
      '<div class="term"><span>TVL</span><b>' + fmtUsd(row.tvl_usd) + '</b><small>the snapshot&rsquo;s figure</small></div>' +
      '<div class="op">×</div>' +
      '<div class="term"><span>Category multiple</span><b>' + fmtMult(row.category_multiple) + '</b><small>' + multipleNote + '</small></div>' +
      '<div class="op">×</div>' +
      '<div class="term"><span>Growth</span><b>' + fmtMult(row.growth_multiplier) + '</b><small>' + growthNote + '</small></div>' +
      '<div class="op">×</div>' +
      '<div class="term"><span>Maturity</span><b>' + fmtMult(row.maturity_multiplier) + '</b><small>' + maturityNote + '</small></div>' +
      '<div class="op">=</div>' +
      '<div class="term result"><span>Implied value</span><b>' + fmtUsd(row.implied_value_usd) + '</b><small>base ' + fmtUsd(base) + ' before adjustments</small></div>' +
      '</div>';

    var steps = row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');

    return (
      masthead() + tabs() +
      '<button class="back" data-view="board">← Back to the board</button>' +
      '<div class="detail-head"><h2>' + esc(row.name) + (row.watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Uncategorised') + ' · ' + esc(chainsText(row.chains, 8)) + ' · records no token in the ' + esc(DATA.as_of) + ' snapshot</p></div>' +
      cards +
      '<section class="panel"><h3>Why it is worth ' + fmtUsd(row.implied_value_usd) + '</h3>' +
      '<p>The market already prices tokenized ' + esc(row.category || 'protocols') + ' at ' + fmtMult(row.category_multiple) + ' their TVL. ' +
      'Applied to ' + esc(row.name) + '&rsquo;s TVL and adjusted for its own growth and track record, the model lands here. ' +
      'It is the value of a token issued on today&rsquo;s record — not a forecast, and not a claim that one is coming.</p>' +
      equation + '</section>' +
      '<section class="panel"><h3>How to farm it</h3><ol class="steps">' + steps + '</ol></section>' +
      footer()
    );
  }

  /* ---------------- already tokenized ---------------- */

  function liveView() {
    var body = DATA.live.map(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—';
      return (
        '<tr>' +
        '<td class="pname">' + esc(r.name) + (r.symbol ? '<span class="badge live">' + esc(r.symbol) + '</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(chainsText(r.chains, 2)) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num value">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num ratio">' + ratio + '</td>' +
        '</tr>'
      );
    }).join('');
    return (
      masthead() + tabs() +
      '<p class="count">These protocols already have a token: the radar does not rank them. They are shown at the market&rsquo;s ' +
      'own values — and they are the comparables whose market-cap/TVL multiples price everything on the board.</p>' +
      '<div class="tablewrap"><table class="flat"><thead><tr><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">MCap / TVL</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      footer()
    );
  }

  /* ---------------- the method ---------------- */

  function methodView() {
    var m = DATA.model;
    var multRows = DATA.multiples.map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + fmtMult(x.multiple) + '</td><td class="num">' + x.comps + '</td></tr>';
    }).join('');
    return (
      masthead() + tabs() +
      '<section class="panel"><h3>The value model (' + esc(DATA.model_version) + ')</h3>' +
      '<p>An implied value is what a protocol&rsquo;s token would be worth if it were priced like the tokenized protocols ' +
      'in its own category are priced today, on its own record. Nothing is priced by hand and no name is special-cased: ' +
      'every figure below is computed from the snapshot at run time.</p>' +
      '<div class="formula">implied = TVL × multiple(category) × growth × maturity</div>' +
      '<p><strong>Multiple.</strong> For each category, the median market-cap/TVL of the snapshot&rsquo;s tokenized protocols in it, ' +
      'shrunk toward the global median (' + fmtMult(DATA.global_multiple) + ') by the comp count (' + m.shrink_k + ' pseudo-comps) and clamped to ' +
      fmtMult(m.multiple_floor) + '–' + fmtMult(m.multiple_cap) + '. A category with no tokenized comps takes the global median.</p>' +
      '<p><strong>Growth.</strong> 1 + (the 7-day TVL change, clamped to ' + m.growth_floor + '%…+' + m.growth_cap + '%) × ' + m.growth_weight + '. No recorded change is neutral.</p>' +
      '<p><strong>Maturity.</strong> ' + m.maturity_floor + ' + (days tracked tokenless, capped at ' + m.maturity_days + ') × ' + m.maturity_range + '. ' +
      'A protocol with no listing date is scored as ' + m.unknown_age_days + ' days old.</p>' +
      '</section>' +
      '<section class="panel"><h3>Who gets ranked</h3>' +
      '<p>Every watchlist protocol, always — the watchlist is the floor. Beyond it, every protocol that records no token and is a ' +
      'launch candidate in its own right. Set aside, on the watchlist&rsquo;s own principles: exchange house products, versioned pools of ' +
      'another protocol, canonical bridges, and wrapped or staked products of a token that already trades. Protocols whose token already ' +
      'trades are never ranked; they are the comparables, listed under “Already tokenized”.</p>' +
      '<p class="note">A record is not proof. The snapshot can lag a launch, so the board says a protocol <em>records</em> no token — ' +
      'never that it has none — and a row&rsquo;s farm plan starts from the protocol&rsquo;s own pages for that reason.</p>' +
      '</section>' +
      '<section class="panel"><h3>Category multiples, as computed from this snapshot</h3>' +
      '<div class="tablewrap"><table class="mult-table"><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Tokenized comps</th></tr></thead>' +
      '<tbody>' + multRows + '</tbody></table></div>' +
      '<p>The global median across every tokenized protocol in the snapshot is ' + fmtMult(DATA.global_multiple) + '.</p>' +
      '</section>' +
      footer()
    );
  }

  /* ---------------- wiring ---------------- */

  function render() {
    if (state.view === 'detail') main.innerHTML = detailView();
    else if (state.view === 'live') main.innerHTML = liveView();
    else if (state.view === 'method') main.innerHTML = methodView();
    else main.innerHTML = boardView();
    main.setAttribute('aria-busy', 'false');
    wire();
  }

  function wire() {
    var tabsEls = main.querySelectorAll('[data-view]');
    Array.prototype.forEach.call(tabsEls, function (el) {
      el.addEventListener('click', function () {
        state.view = el.getAttribute('data-view');
        render();
        window.scrollTo(0, 0);
      });
    });

    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function () {
        state.query = q.value;
        var pos = q.selectionStart;
        render();
        var q2 = document.getElementById('q');
        q2.focus();
        q2.setSelectionRange(pos, pos);
      });
    }
    var cat = document.getElementById('cat');
    if (cat) cat.addEventListener('change', function () { state.category = cat.value; render(); });
    var chain = document.getElementById('chain');
    if (chain) chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var mintvl = document.getElementById('mintvl');
    if (mintvl) mintvl.addEventListener('change', function () { state.minTvl = Number(mintvl.value); render(); });
    var wl = document.getElementById('wl');
    if (wl) wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; render(); });

    Array.prototype.forEach.call(main.querySelectorAll('[data-sort]'), function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 1 ? -1 : 1;
        else { state.sortKey = key; state.sortDir = key === 'rank' || key === 'name' ? 1 : -1; }
        render();
      });
    });

    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (el) {
      function open() {
        state.slug = el.getAttribute('data-slug');
        state.view = 'detail';
        render();
        window.scrollTo(0, 0);
      }
      el.addEventListener('click', open);
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    });
  }

  render();
})();
