/* =========================================================================
   MatchRooz — منطق برنامه
   ========================================================================= */

(function () {
  'use strict';

  var API_URL      = 'api/index.php';
  var REFRESH_SEC  = 20;    // فاصله‌ی بازآوری خودکار
  var DATE_RANGE   = 7;     // تعداد روز قبل/بعد در نوار تاریخ
  var FA           = window.Jalali;

  /* ---------------------------------------------------------------------
     وضعیت برنامه
     --------------------------------------------------------------------- */

  var State = {
    page:      'live',
    date:      FA.isoDate(new Date()),
    filter:    'all',
    query:     '',
    matches:   [],
    leagues:   [],
    favorites: new Set(),
    collapsed: new Set(),
    scores:    {},          // برای تشخیص گل
    league:    null,        // لیگ انتخاب‌شده در صفحه‌ی جدول
    loading:   false,
    firstLoad: true,
    tickLeft:  REFRESH_SEC
  };

  /* ---------------------------------------------------------------------
     ابزارهای کوتاه
     --------------------------------------------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** فرار دادن متن برای درج امن در HTML (داده از سرویس بیرونی می‌آید) */
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** ارقام فارسی */
  function fa(n) { return FA.digits(n); }

  /** ساعت به وقت محلی از timestamp ثانیه‌ای */
  function clock(ts) {
    var d = new Date(ts * 1000);
    return fa(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  /** رنگ ثابت برای هر تیم از روی نامش */
  function teamHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) {
      h = (h * 31 + name.charCodeAt(i)) % 360;
    }
    return h;
  }

  /** حرف اول نام تیم برای نشان جایگزین */
  function initials(name) {
    var parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0].charAt(0) + parts[1].charAt(0);
  }

  /** نشان تیم: لوگو اگر هست، وگرنه مونوگرام رنگی */
  function badge(team, cls) {
    var name = team && team.name ? team.name : '';
    if (team && team.logo) {
      return '<span class="badge ' + (cls || '') + '">' +
             '<img src="' + esc(team.logo) + '" alt="" loading="lazy" ' +
             'onerror="this.parentNode.innerHTML=\'' + esc(initials(name)) + '\'">' +
             '</span>';
    }
    var hue = teamHue(name);
    return '<span class="badge ' + (cls || '') + '" style="background:linear-gradient(140deg,hsl(' +
           hue + ',48%,42%),hsl(' + ((hue + 40) % 360) + ',46%,30%))">' +
           esc(initials(name)) + '</span>';
  }

  /* ---------------------------------------------------------------------
     ذخیره‌سازی محلی
     --------------------------------------------------------------------- */

  var Store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem('matchrooz.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('matchrooz.' + key, JSON.stringify(value)); } catch (e) {}
    }
  };

  /* ---------------------------------------------------------------------
     ارتباط با سرور
     --------------------------------------------------------------------- */

  function request(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);

    return fetch(API_URL + '?' + qs, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('پاسخ سرور: ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.ok !== true) {
        throw new Error(json && json.error ? json.error : 'خطای نامشخص');
      }
      return json;
    });
  }

  /* ---------------------------------------------------------------------
     اعلان‌ها
     --------------------------------------------------------------------- */

  function toast(message, kind, ms) {
    var area = $('#toasts');
    if (!area) return;

    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.innerHTML = message;
    area.appendChild(el);

    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 320);
    }, ms || 3600);
  }

  /* ---------------------------------------------------------------------
     نوار تاریخ
     --------------------------------------------------------------------- */

  function renderDatebar() {
    var strip = $('#datestrip');
    if (!strip) return;

    var today = new Date();
    var html  = '';

    for (var i = -DATE_RANGE; i <= DATE_RANGE; i++) {
      var d   = FA.addDays(today, i);
      var iso = FA.isoDate(d);
      var j   = FA.fromDate(d);

      var classes = 'dchip';
      if (iso === State.date) classes += ' is-active';
      if (i === 0) classes += ' is-today';

      html += '<button class="' + classes + '" data-date="' + iso + '" type="button">' +
                '<span class="dchip__day">' + esc(FA.relativeLabel(d)) + '</span>' +
                '<span class="dchip__num">' + fa(j.jd) + '</span>' +
                '<span class="dchip__mon">' + esc(FA.months[j.jm - 1]) + '</span>' +
              '</button>';
    }

    strip.innerHTML = html;

    // روز فعال را وسط نوار بیاور
    var active = $('.dchip.is-active', strip);
    if (active) {
      strip.scrollLeft = active.offsetLeft - (strip.clientWidth / 2) + (active.clientWidth / 2);
    }
  }

  /* ---------------------------------------------------------------------
     فیلترها
     --------------------------------------------------------------------- */

  function counts() {
    var c = { all: State.matches.length, live: 0, finished: 0, upcoming: 0, fav: 0 };
    State.matches.forEach(function (m) {
      if (m.status.live) c.live++;
      else if (m.status.finished) c.finished++;
      else c.upcoming++;
      if (State.favorites.has(String(m.id))) c.fav++;
    });
    return c;
  }

  function renderFilters() {
    var box = $('#filters');
    if (!box) return;

    var c = counts();
    var defs = [
      { key: 'all',      label: 'همه',        n: c.all },
      { key: 'live',     label: 'زنده',       n: c.live, live: true },
      { key: 'finished', label: 'پایان‌یافته', n: c.finished },
      { key: 'upcoming', label: 'شروع نشده',  n: c.upcoming },
      { key: 'fav',      label: 'دنبال‌شده',   n: c.fav }
    ];

    box.innerHTML = defs.map(function (d) {
      return '<button class="chip' + (State.filter === d.key ? ' is-active' : '') +
             (d.live ? ' chip--live' : '') + '" data-filter="' + d.key + '" type="button">' +
             (d.live ? '<span class="chip__dot"></span>' : '') +
             esc(d.label) +
             '<span class="chip__count">' + fa(d.n) + '</span></button>';
    }).join('');
  }

  /* ---------------------------------------------------------------------
     نوار بازی‌های زنده
     --------------------------------------------------------------------- */

  function renderTicker() {
    var box = $('#ticker');
    if (!box) return;

    var live = State.matches.filter(function (m) { return m.status.live; });

    if (!live.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;

    box.innerHTML = live.map(function (m) {
      var min = m.status.elapsed ? fa(m.status.elapsed) + '′' : esc(m.status.label);
      return '<div class="tcard" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
               '<div class="tcard__min"><span></span>' + min + '</div>' +
               '<div class="tcard__row"><span>' + esc(m.teams.home.name) + '</span><b>' + fa(m.goals.home) + '</b></div>' +
               '<div class="tcard__row"><span>' + esc(m.teams.away.name) + '</span><b>' + fa(m.goals.away) + '</b></div>' +
             '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------------------
     فهرست بازی‌ها
     --------------------------------------------------------------------- */

  function visibleMatches() {
    var q = State.query.trim().toLowerCase();

    return State.matches.filter(function (m) {
      if (State.filter === 'live'     && !m.status.live) return false;
      if (State.filter === 'finished' && !m.status.finished) return false;
      if (State.filter === 'upcoming' && (m.status.live || m.status.finished)) return false;
      if (State.filter === 'fav'      && !State.favorites.has(String(m.id))) return false;

      if (q) {
        var hay = (m.teams.home.name + ' ' + m.teams.away.name + ' ' + m.league.name).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /** گروه‌بندی بر اساس لیگ، با حفظ ترتیب سرور */
  function groupByLeague(list) {
    var order = [];
    var map   = {};

    list.forEach(function (m) {
      var key = String(m.league.id) + '|' + m.league.name;
      if (!map[key]) {
        map[key] = { league: m.league, matches: [] };
        order.push(key);
      }
      map[key].matches.push(m);
    });

    return order.map(function (k) { return map[k]; });
  }

  function matchRow(m) {
    var isLive = m.status.live;
    var isFt   = m.status.finished;
    var fav    = State.favorites.has(String(m.id));

    // ستون زمان: دقیقه‌ی زنده، «پایان» یا ساعت شروع
    var timeCell;
    if (isLive) {
      timeCell = m.status.elapsed
        ? '<strong>' + fa(m.status.elapsed) + '</strong>'
        : '<strong>' + esc(m.status.label) + '</strong>';
      if (m.status.short === 'HT') timeCell = '<strong>' + esc('نیمه') + '</strong>';
    } else if (isFt) {
      timeCell = esc(m.status.short === 'FT' ? 'پایان' : m.status.label);
    } else {
      timeCell = clock(m.kickoff);
    }

    // نتیجه
    var scoreCell;
    if (m.goals.home === null || m.goals.away === null) {
      scoreCell = '<div class="match__score match__score--vs" data-score="">-</div>';
    } else {
      scoreCell = '<div class="match__score" data-score="' + m.goals.home + ':' + m.goals.away + '">' +
                  fa(m.goals.home) + '<i>-</i>' + fa(m.goals.away) + '</div>';
    }

    // برنده/بازنده در بازی تمام‌شده کم‌رنگ می‌شود
    var homeLose = isFt && m.goals.home < m.goals.away ? ' is-loser' : '';
    var awayLose = isFt && m.goals.away < m.goals.home ? ' is-loser' : '';

    return '<div class="match' + (isLive ? ' is-live' : '') + (isFt ? ' is-finished' : '') +
             '" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
             '<div class="match__time">' + timeCell + '</div>' +
             '<div class="match__team">' + badge(m.teams.home) +
               '<span class="match__name' + homeLose + '">' + esc(m.teams.home.name) + '</span></div>' +
             scoreCell +
             '<div class="match__team match__team--away">' + badge(m.teams.away) +
               '<span class="match__name' + awayLose + '">' + esc(m.teams.away.name) + '</span></div>' +
             '<button class="star' + (fav ? ' is-on' : '') + '" data-fav="' + esc(m.id) +
               '" type="button" aria-label="دنبال کردن">' +
               '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
               '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>' +
             '</button>' +
           '</div>';
  }

  function renderList() {
    var box = $('#list');
    if (!box) return;

    var list = visibleMatches();

    if (!list.length) {
      box.innerHTML = emptyState();
      return;
    }

    box.innerHTML = groupByLeague(list).map(function (g, i) {
      var key       = String(g.league.id);
      var collapsed = State.collapsed.has(key);

      var flag = g.league.logo
        ? '<span class="league__flag"><img src="' + esc(g.league.logo) + '" alt=""></span>'
        : '<span class="league__flag">' + esc(g.league.flag || '⚽') + '</span>';

      return '<section class="league' + (collapsed ? ' is-collapsed' : '') +
               '" style="animation-delay:' + Math.min(i * 45, 400) + 'ms">' +
               '<button class="league__head" data-league="' + esc(key) + '" type="button">' +
                 flag +
                 '<span class="league__meta">' +
                   '<span class="league__name">' + esc(g.league.name) + '</span>' +
                   '<span class="league__country">' + esc(g.league.country || '') +
                     (g.league.round ? ' • ' + fa(esc(g.league.round)) : '') + '</span>' +
                 '</span>' +
                 '<span class="league__badge">' + fa(g.matches.length) + ' بازی</span>' +
                 '<svg class="league__caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                   '<path d="M6 9l6 6 6-6"/></svg>' +
               '</button>' +
               '<div class="league__list">' + g.matches.map(matchRow).join('') + '</div>' +
             '</section>';
    }).join('');
  }

  function emptyState() {
    var msg = {
      live:     ['هیچ بازی زنده‌ای نیست', 'وقتی بازی‌ای شروع شود، همین‌جا زنده نمایش داده می‌شود.'],
      fav:      ['هنوز بازی‌ای دنبال نمی‌کنید', 'روی ستاره‌ی کنار هر بازی بزنید تا اینجا جمع شود.'],
      finished: ['بازی تمام‌شده‌ای نیست', 'برای این روز هنوز نتیجه‌ای ثبت نشده است.'],
      upcoming: ['بازی پیش‌رویی نیست', 'برنامه‌ی این روز خالی است.'],
      all:      ['بازی‌ای برای این روز نیست', 'تاریخ دیگری را از نوار بالا انتخاب کنید.']
    }[State.filter] || ['موردی پیدا نشد', ''];

    if (State.query) {
      msg = ['نتیجه‌ای پیدا نشد', 'عبارت «' + esc(State.query) + '» در بازی‌های امروز نبود.'];
    }

    return '<div class="empty">' +
             '<div class="empty__icon">⚽</div>' +
             '<div class="empty__title">' + msg[0] + '</div>' +
             '<div class="empty__text">' + msg[1] + '</div>' +
             (State.filter !== 'all'
               ? '<button class="empty__btn" data-filter="all" type="button">نمایش همه‌ی بازی‌ها</button>'
               : '') +
           '</div>';
  }

  function skeleton(n) {
    var rows = '';
    for (var i = 0; i < (n || 6); i++) {
      rows += '<div class="sk-row">' +
                '<div class="skeleton"></div><div class="skeleton"></div>' +
                '<div class="skeleton"></div><div class="skeleton"></div>' +
                '<div class="skeleton" style="width:20px"></div>' +
              '</div>';
    }
    return '<section class="league"><div class="league__list">' + rows + '</div></section>';
  }

  /* ---------------------------------------------------------------------
     تشخیص گل و درخشش نتیجه
     --------------------------------------------------------------------- */

  function detectGoals(fresh) {
    if (State.firstLoad) return;

    fresh.forEach(function (m) {
      var prev = State.scores[m.id];
      if (!prev || m.goals.home === null) return;

      var now = m.goals.home + ':' + m.goals.away;
      if (prev === now) return;

      var pg     = prev.split(':');
      var scored = (+m.goals.home > +pg[0]) ? m.teams.home.name : m.teams.away.name;

      toast('⚽ گل! <b>' + esc(scored) + '</b> &nbsp;' +
            esc(m.teams.home.name) + ' ' + fa(m.goals.home) + '-' + fa(m.goals.away) + ' ' +
            esc(m.teams.away.name), 'goal', 5000);

      // ردیف مربوطه را برجسته کن
      setTimeout(function () {
        var cell = $('.match[data-id="' + m.id + '"] .match__score');
        if (cell) {
          cell.classList.add('did-change');
          setTimeout(function () { cell.classList.remove('did-change'); }, 950);
        }
      }, 60);
    });
  }

  function snapshot(list) {
    var map = {};
    list.forEach(function (m) {
      if (m.goals.home !== null) map[m.id] = m.goals.home + ':' + m.goals.away;
    });
    State.scores = map;
  }

  /* ---------------------------------------------------------------------
     بارگذاری بازی‌ها
     --------------------------------------------------------------------- */

  function loadMatches(silent) {
    if (State.loading) return Promise.resolve();
    State.loading = true;

    var btn = $('#refresh');
    if (btn) btn.classList.add('is-loading');

    if (!silent) {
      var box = $('#list');
      if (box) box.innerHTML = skeleton(6);
    }

    return request({ action: 'matches', date: State.date })
      .then(function (json) {
        var list = Array.isArray(json.data) ? json.data : [];

        detectGoals(list);
        State.matches = list;
        snapshot(list);

        renderFilters();
        renderTicker();
        renderList();
        setStatus('ok', json.meta);

        State.firstLoad = false;
      })
      .catch(function (err) {
        setStatus('err', null, err.message);
        if (!silent) {
          var box = $('#list');
          if (box) {
            box.innerHTML = '<div class="empty">' +
              '<div class="empty__icon">📡</div>' +
              '<div class="empty__title">اتصال برقرار نشد</div>' +
              '<div class="empty__text">' + esc(err.message) + '</div>' +
              '<button class="empty__btn" id="retry" type="button">تلاش دوباره</button></div>';
          }
        } else {
          toast('به‌روزرسانی ناموفق بود', 'err');
        }
      })
      .then(function () {
        State.loading = false;
        State.tickLeft = REFRESH_SEC;
        if (btn) btn.classList.remove('is-loading');
      });
  }

  function setStatus(kind, meta, message) {
    var bar = $('#status');
    if (!bar) return;

    bar.className = 'status-bar' + (kind === 'err' ? ' is-err' : (meta && meta.stale ? ' is-off' : ''));

    var text;
    if (kind === 'err') {
      text = message || 'ارتباط قطع است';
    } else if (meta && meta.stale) {
      text = 'نمایش آخرین داده‌ی ذخیره‌شده';
    } else {
      var d = new Date();
      text = 'به‌روزرسانی: ' + fa(String(d.getHours()).padStart(2, '0') + ':' +
             String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'));
      if (meta && meta.provider === 'demo') text += ' • حالت نمایشی';
    }

    bar.innerHTML = '<span class="status-bar__dot"></span><span>' + esc(text) + '</span>';
  }

  /* ---------------------------------------------------------------------
     پنجره‌ی جزئیات بازی
     --------------------------------------------------------------------- */

  var Sheet = {
    id: null,
    tab: 'events',

    open: function (id) {
      this.id  = id;
      this.tab = 'events';

      $('#sheet').classList.add('is-open');
      $('#backdrop').classList.add('is-open');
      document.body.classList.add('no-scroll');

      $('#sheetBody').innerHTML = '<div style="padding:20px">' +
        '<div class="skeleton" style="height:16px;margin-bottom:10px"></div>' +
        '<div class="skeleton" style="height:16px;width:70%;margin-bottom:10px"></div>' +
        '<div class="skeleton" style="height:16px;width:85%"></div></div>';

      this.load();
    },

    close: function () {
      this.id = null;
      $('#sheet').classList.remove('is-open');
      $('#backdrop').classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    },

    load: function () {
      var id = this.id;
      var self = this;

      request({ action: 'match', id: id })
        .then(function (json) {
          if (self.id !== id) return;   // کاربر پنجره را بسته یا عوض کرده
          self.data = json.data;
          self.render();
        })
        .catch(function (err) {
          if (self.id !== id) return;
          $('#sheetBody').innerHTML = '<div class="empty"><div class="empty__icon">⚠️</div>' +
            '<div class="empty__title">جزئیات در دسترس نیست</div>' +
            '<div class="empty__text">' + esc(err.message) + '</div></div>';
        });
    },

    render: function () {
      var m = this.data;
      if (!m) return;

      // سربرگ
      var score = (m.goals.home === null)
        ? '<strong>' + clock(m.kickoff) + '</strong>'
        : '<strong>' + fa(m.goals.home) + ' - ' + fa(m.goals.away) + '</strong>';

      var pillCls = m.status.live ? 'pill pill--live' : (m.status.finished ? 'pill pill--ft' : 'pill');
      var pillTxt = m.status.live && m.status.elapsed
        ? fa(m.status.elapsed) + '′'
        : m.status.label;

      $('#sheetHero').innerHTML =
        '<div class="sheet__league">' + esc(m.league.name) +
          (m.league.round ? ' • ' + fa(esc(m.league.round)) : '') +
          (m.venue ? ' • ' + esc(m.venue) : '') + '</div>' +
        '<div class="sheet__score">' +
          '<div class="sheet__side">' + badge(m.teams.home) + '<b>' + esc(m.teams.home.name) + '</b></div>' +
          '<div class="sheet__num">' + score +
            '<span class="' + pillCls + '">' + esc(pillTxt) + '</span></div>' +
          '<div class="sheet__side">' + badge(m.teams.away) + '<b>' + esc(m.teams.away.name) + '</b></div>' +
        '</div>';

      // زبانه‌ها
      var tabs = [
        { key: 'events',  label: 'رویدادها' },
        { key: 'stats',   label: 'آمار' },
        { key: 'lineups', label: 'ترکیب' }
      ];
      $('#sheetTabs').innerHTML = tabs.map(function (t) {
        return '<button class="tab' + (Sheet.tab === t.key ? ' is-active' : '') +
               '" data-tab="' + t.key + '" type="button">' + t.label + '</button>';
      }).join('');

      this.renderTab();
    },

    renderTab: function () {
      var m = this.data;
      var body = $('#sheetBody');
      if (!m || !body) return;

      if (this.tab === 'events')  body.innerHTML = this.viewEvents(m);
      if (this.tab === 'stats')   body.innerHTML = this.viewStats(m);
      if (this.tab === 'lineups') body.innerHTML = this.viewLineups(m);
    },

    viewEvents: function (m) {
      var list = m.events || [];
      if (!list.length) {
        return '<div class="empty"><div class="empty__icon">⏱</div>' +
               '<div class="empty__title">هنوز رویدادی ثبت نشده</div>' +
               '<div class="empty__text">رویدادهای بازی به‌محض وقوع اینجا می‌آید.</div></div>';
      }

      var icons = { goal: '⚽', yellow: '🟨', red: '🟥', subst: '🔄', var: '📺' };

      return list.map(function (e, i) {
        return '<div class="event event--' + esc(e.side) + '" style="animation-delay:' +
                 Math.min(i * 35, 300) + 'ms">' +
                 '<span class="event__min">' + fa(e.minute) + '′</span>' +
                 '<span class="event__icon">' + (icons[e.type] || '•') + '</span>' +
                 '<div class="event__body">' +
                   '<div class="event__player">' + esc(e.player) + '</div>' +
                   '<div class="event__detail">' + esc(e.detail) + '</div>' +
                 '</div>' +
               '</div>';
      }).join('');
    },

    viewStats: function (m) {
      var list = m.stats || [];
      if (!list.length) {
        return '<div class="empty"><div class="empty__icon">📊</div>' +
               '<div class="empty__title">آماری در دسترس نیست</div>' +
               '<div class="empty__text">این منبع برای این بازی آمار ارائه نکرده است.</div></div>';
      }

      return list.map(function (s) {
        // درصدها و اعداد را برای عرض نوار به عدد تبدیل کن
        var h = parseFloat(String(s.home).replace(/[^0-9.]/g, '')) || 0;
        var a = parseFloat(String(s.away).replace(/[^0-9.]/g, '')) || 0;
        var sum = h + a;
        var hp  = sum ? (h / sum * 100) : 50;

        return '<div class="stat">' +
                 '<div class="stat__top">' +
                   '<b>' + fa(s.home) + '</b>' +
                   '<span class="stat__label">' + esc(s.label) + '</span>' +
                   '<b>' + fa(s.away) + '</b>' +
                 '</div>' +
                 '<div class="stat__bar">' +
                   '<span class="stat__fill stat__fill--home" style="width:' + hp.toFixed(1) + '%"></span>' +
                   '<span class="stat__fill stat__fill--away" style="width:' + (100 - hp).toFixed(1) + '%"></span>' +
                 '</div>' +
               '</div>';
      }).join('');
    },

    viewLineups: function (m) {
      var lu = m.lineups || {};
      if (!lu.home && !lu.away) {
        return '<div class="empty"><div class="empty__icon">👥</div>' +
               '<div class="empty__title">ترکیب هنوز اعلام نشده</div>' +
               '<div class="empty__text">معمولاً یک ساعت پیش از شروع منتشر می‌شود.</div></div>';
      }

      return ['home', 'away'].map(function (side) {
        var l = lu[side];
        if (!l) return '';

        var teamName = typeof l.team === 'string' ? l.team : (m.teams[side].name);

        var players = (l.start || []).map(function (p) {
          return '<div class="player"><span class="player__num">' + fa(p.number) + '</span>' +
                 '<span>' + esc(p.name) + '</span></div>';
        }).join('');

        var bench = (l.bench || []).map(function (p) {
          return '<div class="player"><span class="player__num">' + fa(p.number) + '</span>' +
                 '<span>' + esc(p.name) + '</span></div>';
        }).join('');

        return '<div class="lineup">' +
                 '<div class="lineup__head">' +
                   '<span class="lineup__team">' + esc(teamName) + '</span>' +
                   (l.formation ? '<span class="lineup__form">' + esc(l.formation) + '</span>' : '') +
                 '</div>' +
                 '<div class="lineup__grid">' + players + '</div>' +
                 (bench ? '<div class="lineup__sub">نیمکت</div><div class="lineup__grid">' + bench + '</div>' : '') +
                 (l.coach ? '<div class="lineup__sub">سرمربی: ' + esc(l.coach) + '</div>' : '') +
               '</div>';
      }).join('');
    }
  };

  /* ---------------------------------------------------------------------
     صفحه‌ی جدول رده‌بندی
     --------------------------------------------------------------------- */

  function loadLeagues() {
    return request({ action: 'leagues' }).then(function (json) {
      State.leagues = Array.isArray(json.data) ? json.data : [];
      if (!State.league && State.leagues.length) {
        State.league = State.leagues[0].id;
      }
      renderLeaguePicker();
    }).catch(function () { /* بی‌صدا؛ صفحه‌ی اصلی مهم‌تر است */ });
  }

  function renderLeaguePicker() {
    var box = $('#leaguePicker');
    if (!box) return;

    box.innerHTML = State.leagues.map(function (l) {
      return '<button class="chip' + (String(State.league) === String(l.id) ? ' is-active' : '') +
             '" data-standings="' + esc(l.id) + '" type="button">' +
             (l.flag ? esc(l.flag) + ' ' : '') + esc(l.name) + '</button>';
    }).join('');
  }

  function loadStandings() {
    var box = $('#standings');
    if (!box || !State.league) return;

    box.innerHTML = '<div class="table-wrap"><div style="padding:16px">' +
      '<div class="skeleton" style="height:15px;margin-bottom:9px"></div>'.repeat(8) + '</div></div>';

    request({ action: 'standings', league: State.league })
      .then(function (json) {
        var d = json.data;
        if (!d || !d.rows || !d.rows.length) throw new Error('جدولی برای این لیگ نیست');
        box.innerHTML = standingsTable(d);
      })
      .catch(function (err) {
        box.innerHTML = '<div class="empty"><div class="empty__icon">📋</div>' +
          '<div class="empty__title">جدول در دسترس نیست</div>' +
          '<div class="empty__text">' + esc(err.message) + '</div></div>';
      });
  }

  function standingsTable(d) {
    var total = d.rows.length;

    var rows = d.rows.map(function (r) {
      // رنگ رتبه: سهمیه‌ی اروپا / سقوط
      var rankCls = 'st-rank';
      if (r.rank <= 4) rankCls += ' st-rank--ucl';
      else if (r.rank <= 6) rankCls += ' st-rank--uel';
      else if (r.rank > total - 3) rankCls += ' st-rank--rel';

      var form = (r.form || '').slice(-5).split('').map(function (ch) {
        var c = ch === 'W' ? 'form-w' : (ch === 'D' ? 'form-d' : 'form-l');
        var t = ch === 'W' ? 'ب' : (ch === 'D' ? 'م' : 'ش');
        return '<i class="' + c + '">' + t + '</i>';
      }).join('');

      return '<tr>' +
               '<td><span class="' + rankCls + '">' + fa(r.rank) + '</span></td>' +
               '<td><div class="st-team">' + badge(r.team) + '<span>' + esc(r.team.name) + '</span></div></td>' +
               '<td>' + fa(r.played) + '</td>' +
               '<td>' + fa(r.win) + '</td>' +
               '<td>' + fa(r.draw) + '</td>' +
               '<td>' + fa(r.lose) + '</td>' +
               '<td class="ltr">' + fa(r.gf) + ':' + fa(r.ga) + '</td>' +
               '<td>' + (r.gd > 0 ? '+' : '') + fa(r.gd) + '</td>' +
               '<td class="st-pts">' + fa(r.points) + '</td>' +
               '<td>' + (form ? '<span class="form-strip">' + form + '</span>' : '—') + '</td>' +
             '</tr>';
    }).join('');

    return '<div class="table-wrap"><div class="table-scroll"><table class="standings">' +
             '<thead><tr>' +
               '<th>#</th><th style="text-align:start">تیم</th><th>بازی</th><th>برد</th>' +
               '<th>مساوی</th><th>باخت</th><th>گل</th><th>تفاضل</th><th>امتیاز</th><th>۵ بازی اخیر</th>' +
             '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
             '<div class="legend">' +
               '<span><i style="background:var(--brand)"></i> سهمیه لیگ قهرمانان</span>' +
               '<span><i style="background:#3B6FD4"></i> سهمیه لیگ اروپا</span>' +
               '<span><i style="background:#C0392B"></i> منطقه سقوط</span>' +
             '</div></div>';
  }

  /* ---------------------------------------------------------------------
     جابه‌جایی بین صفحه‌ها
     --------------------------------------------------------------------- */

  function showPage(name) {
    State.page = name;

    $$('.page').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'page-' + name);
    });
    $$('.nav__btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.page === name);
    });

    if (name === 'standings') {
      if (!State.leagues.length) {
        loadLeagues().then(loadStandings);
      } else {
        loadStandings();
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------------
     پوسته
     --------------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Store.set('theme', theme);

    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#EFF3F0' : '#0A100E');

    var icon = $('#themeIcon');
    if (icon) {
      icon.innerHTML = theme === 'light'
        ? '<path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>'
        : '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>';
    }
  }

  /* ---------------------------------------------------------------------
     بازآوری خودکار
     --------------------------------------------------------------------- */

  function startTicker() {
    setInterval(function () {
      // وقتی تب پنهان است یا صفحه‌ی جدول باز است، درخواست نفرست
      if (document.hidden || State.page !== 'live') return;

      State.tickLeft--;

      var ring = $('#ring');
      if (ring) {
        var pct = 1 - (State.tickLeft / REFRESH_SEC);
        var c   = 2 * Math.PI * 17;
        ring.style.strokeDasharray  = c;
        ring.style.strokeDashoffset = c * (1 - pct);
      }

      if (State.tickLeft <= 0) {
        State.tickLeft = REFRESH_SEC;
        loadMatches(true);
      }
    }, 1000);

    // با برگشتن به تب، بلافاصله تازه کن
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && State.page === 'live') loadMatches(true);
    });
  }

  /* ---------------------------------------------------------------------
     رویدادها
     --------------------------------------------------------------------- */

  function bind() {

    // یک شنونده برای کل صفحه (کارآمدتر از شنونده به‌ازای هر ردیف)
    document.addEventListener('click', function (e) {

      var t;

      // انتخاب تاریخ
      if ((t = e.target.closest('.dchip'))) {
        State.date = t.dataset.date;
        State.firstLoad = true;
        renderDatebar();
        loadMatches(false);
        return;
      }

      // فیلتر
      if ((t = e.target.closest('[data-filter]'))) {
        State.filter = t.dataset.filter;
        renderFilters();
        renderList();
        return;
      }

      // ستاره‌ی دنبال‌کردن
      if ((t = e.target.closest('[data-fav]'))) {
        e.stopPropagation();
        var id = String(t.dataset.fav);

        if (State.favorites.has(id)) {
          State.favorites.delete(id);
          t.classList.remove('is-on');
        } else {
          State.favorites.add(id);
          t.classList.add('is-on');
          toast('به دنبال‌شده‌ها اضافه شد ⭐');
        }
        Store.set('favorites', Array.from(State.favorites));
        renderFilters();
        if (State.filter === 'fav') renderList();
        return;
      }

      // باز/بسته کردن لیگ
      if ((t = e.target.closest('[data-league]'))) {
        var key = t.dataset.league;
        if (State.collapsed.has(key)) State.collapsed.delete(key);
        else State.collapsed.add(key);
        t.parentNode.classList.toggle('is-collapsed');
        Store.set('collapsed', Array.from(State.collapsed));
        return;
      }

      // باز کردن جزئیات
      if ((t = e.target.closest('.match, .tcard'))) {
        Sheet.open(t.dataset.id);
        return;
      }

      // زبانه‌های پنجره
      if ((t = e.target.closest('[data-tab]'))) {
        Sheet.tab = t.dataset.tab;
        $$('#sheetTabs .tab').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.tab === Sheet.tab);
        });
        Sheet.renderTab();
        return;
      }

      // انتخاب لیگ در صفحه‌ی جدول
      if ((t = e.target.closest('[data-standings]'))) {
        State.league = t.dataset.standings;
        renderLeaguePicker();
        loadStandings();
        return;
      }

      // ناوبری
      if ((t = e.target.closest('[data-page]'))) {
        showPage(t.dataset.page);
        return;
      }

      // بستن پنجره
      if (e.target.closest('#sheetClose') || e.target.id === 'backdrop') {
        Sheet.close();
        return;
      }

      // تلاش دوباره
      if (e.target.id === 'retry') {
        loadMatches(false);
        return;
      }
    });

    // دسترسی با صفحه‌کلید روی ردیف‌ها
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') Sheet.close();

      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.match, .tcard')) {
        e.preventDefault();
        Sheet.open(e.target.dataset.id);
      }
    });

    // بازآوری دستی
    var refresh = $('#refresh');
    if (refresh) {
      refresh.addEventListener('click', function () {
        loadMatches(true);
        toast('در حال به‌روزرسانی…', null, 1500);
      });
    }

    // پوسته
    var themeBtn = $('#theme');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
      });
    }

    // نمایش/پنهان‌کردن جست‌وجو
    var searchBtn = $('#searchBtn');
    var searchBox = $('#search');
    if (searchBtn && searchBox) {
      searchBtn.addEventListener('click', function () {
        searchBox.hidden = !searchBox.hidden;
        if (!searchBox.hidden) $('#searchInput').focus();
        else {
          State.query = '';
          $('#searchInput').value = '';
          renderList();
        }
      });
    }

    // جست‌وجوی زنده با کمی تأخیر
    var input = $('#searchInput');
    if (input) {
      var timer;
      input.addEventListener('input', function () {
        clearTimeout(timer);
        var value = input.value;
        timer = setTimeout(function () {
          State.query = value;
          renderList();
        }, 220);
      });
    }

    // آنلاین/آفلاین
    window.addEventListener('online', function () {
      toast('اتصال برقرار شد', null, 2000);
      loadMatches(true);
    });
    window.addEventListener('offline', function () {
      toast('اینترنت قطع شد — آخرین داده نمایش داده می‌شود', 'err', 4000);
    });
  }

  /* ---------------------------------------------------------------------
     راه‌اندازی
     --------------------------------------------------------------------- */

  function init() {
    // بازیابی تنظیمات ذخیره‌شده
    applyTheme(Store.get('theme', 'dark'));
    State.favorites = new Set(Store.get('favorites', []));
    State.collapsed = new Set(Store.get('collapsed', []));

    // تاریخ امروز به شمسی در هدر
    var now = new Date();
    var todayLabel = $('#todayLabel');
    if (todayLabel) {
      todayLabel.textContent = FA.weekday(now) + ' ' + FA.longDate(now);
    }
    var sideDate = $('#sideDate');
    if (sideDate) {
      sideDate.textContent = FA.weekday(now) + '، ' + FA.longDate(now);
    }

    renderDatebar();
    renderFilters();
    bind();
    startTicker();

    loadMatches(false);

    // ثبت سرویس‌ورکر برای کارکرد آفلاین
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* اختیاری است */ });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
