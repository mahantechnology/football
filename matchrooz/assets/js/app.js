/* =========================================================================
   MatchRooz — منطق برنامه
   ========================================================================= */

(function () {
  'use strict';

  var API_URL      = 'api/index.php';
  var REFRESH_SEC  = 20;    // فاصله‌ی پیش‌فرض بازآوری (از تنظیمات خوانده می‌شود)
  var DAYS_BACK    = 3;     // ۳ روز گذشته در نوار تاریخ
  var DAYS_AHEAD   = 4;     // ۴ روز آینده در نوار تاریخ
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
    favorites: new Set(),   // بازی‌های دنبال‌شده
    favTeams:  new Set(),   // تیم‌های دنبال‌شده
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

  /** «۱۴۰۴/۰۵/۰۹» از رشته‌ی YYYY-MM-DD میلادی */
  function faDate(iso) {
    try {
      var j = FA.fromDate(FA.parseIso(iso));
      return fa(j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0'));
    } catch (e) {
      return iso;
    }
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

  /* ---------------------------------------------------------------------
     نشان تیم
     ---------------------------------------------------------------------
     ترتیب نمایش:
       ۱) لوگوی رسمی که سرویس داده فرستاده
       ۲) اگر آن لوگو بارگذاری نشد یا اصلاً نبود، یک «سپر» با رنگ‌های
          واقعی همان باشگاه کشیده می‌شود.
     پس هیچ‌وقت جای خالی یا مربع خاکستری دیده نمی‌شود.
     --------------------------------------------------------------------- */

  /** روشنایی نسبی یک رنگ، برای انتخاب رنگ متن رویش */
  function luminance(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var r = parseInt(h.slice(0, 2), 16) / 255;
    var g = parseInt(h.slice(2, 4), 16) / 255;
    var b = parseInt(h.slice(4, 6), 16) / 255;

    function ch(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  /** رنگ‌های جایگزین برای تیم‌های ناشناس (از روی نام ساخته می‌شود) */
  function fallbackColors(name) {
    var hue = teamHue(name);
    return ['hsl(' + hue + ',52%,40%)', 'hsl(' + ((hue + 45) % 360) + ',48%,26%)'];
  }

  function teamColors(team) {
    if (team && team.colors && team.colors.length === 2) return team.colors;
    return fallbackColors(team && team.name ? team.name : '');
  }

  /** سپرِ باشگاه: دو رنگ اصلی + حروف اول نام */
  function crestSvg(ini, c1, c2) {
    // رنگ متن بر اساس روشنایی زمینه انتخاب می‌شود تا همیشه خوانا بماند
    var lum;
    try {
      lum = (luminance(c1) + luminance(c2)) / 2;
    } catch (e) {
      lum = 0.3;
    }
    var fg     = lum > 0.55 ? '#10201A' : '#FFFFFF';
    var stroke = lum > 0.55 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)';

    // مسیر سپر: بالا صاف، پایین گرد
    var shield = 'M20 2 L37 7 v15 c0 10.5-7.6 17.4-17 20 C10.6 39.4 3 32.5 3 22 V7 Z';
    // نیمه‌ی راست همان سپر، برای رنگ دوم
    // (به‌جای clipPath رسم می‌شود، چون شناسه‌ی تکراری در صفحه‌ای پر از
    //  نشان‌ها باعث می‌شود همه به یک تعریف وصل شوند و شکننده است.)
    var right  = 'M20 2 L37 7 v15 c0 10.5-7.6 17.4-17 20 Z';

    return '<svg class="badge__crest" viewBox="0 0 40 44" aria-hidden="true">' +
             '<path d="' + shield + '" fill="' + esc(c1) + '"/>' +
             '<path d="' + right + '" fill="' + esc(c2) + '"/>' +
             '<path d="' + shield + '" fill="none" stroke="' + stroke + '" stroke-width="1.6"/>' +
             '<text x="20" y="27" text-anchor="middle" fill="' + fg + '" ' +
               'font-size="18" font-weight="700">' + esc(ini) + '</text>' +
           '</svg>';
  }

  /** نشان تیم — لوگوی رسمی با بازگشت خودکار به سپر باشگاه */
  function badge(team, cls) {
    var name = team && team.name ? team.name : '';
    var ini  = initials(name);
    var c    = teamColors(team);

    // این صفت‌ها اجازه می‌دهند اگر لوگو بارگذاری نشد، سپر دوباره ساخته شود
    var data = ' data-ini="' + esc(ini) + '" data-c1="' + esc(c[0]) + '" data-c2="' + esc(c[1]) + '"';

    if (team && team.logo) {
      return '<span class="badge ' + (cls || '') + '"' + data + '>' +
               '<img class="badge__img" src="' + esc(team.logo) + '" alt="" loading="lazy">' +
             '</span>';
    }

    return '<span class="badge ' + (cls || '') + '"' + data + '>' + crestSvg(ini, c[0], c[1]) + '</span>';
  }

  /**
   * اگر لوگوی رسمی بارگذاری نشد (آدرس خراب، فیلتر شبکه، نبود فایل)،
   * جای آن سپر باشگاه کشیده می‌شود.
   * رویداد error بالا نمی‌آید، پس در فاز capture گوش می‌دهیم.
   */
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.className !== 'badge__img') return;

    var box = img.parentNode;
    if (!box) return;

    box.innerHTML = crestSvg(
      box.getAttribute('data-ini') || '',
      box.getAttribute('data-c1') || '#2A3A33',
      box.getAttribute('data-c2') || '#1B2621'
    );
  }, true);

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
     تنظیمات کاربر
     --------------------------------------------------------------------- */

  var Settings = {
    defaults: {
      theme:    'light',   // پوسته‌ی پیش‌فرض: روز
      refresh:  20,      // ثانیه
      sound:    false,   // صدای گل
      notify:   false,   // اعلان مرورگر
      spoiler:  false,   // پنهان‌کردن نتایج تا وقتی روی آن بزنید
      compact:  false,   // نمایش فشرده
      onlyFav:  false    // فقط اعلان برای دنبال‌شده‌ها
    },

    data: {},

    load: function () {
      var saved = Store.get('settings', {});
      this.data = {};
      for (var k in this.defaults) {
        if (Object.prototype.hasOwnProperty.call(this.defaults, k)) {
          this.data[k] = (saved && saved[k] !== undefined) ? saved[k] : this.defaults[k];
        }
      }
      // پوسته پیش‌تر جداگانه ذخیره می‌شد
      var legacy = Store.get('theme', null);
      if (legacy && !saved.theme) this.data.theme = legacy;
    },

    get: function (k) { return this.data[k]; },

    set: function (k, v) {
      this.data[k] = v;
      Store.set('settings', this.data);
      this.apply();
    },

    /** اعمال تنظیماتی که روی ظاهر اثر دارند */
    apply: function () {
      document.body.classList.toggle('is-compact', !!this.data.compact);
      document.body.classList.toggle('is-spoiler', !!this.data.spoiler);
    }
  };

  /* ---------------------------------------------------------------------
     صدا و اعلان گل
     --------------------------------------------------------------------- */

  var Audio2 = {
    ctx: null,

    /** یک بوق کوتاه دو نتی — بدون نیاز به فایل صوتی */
    beep: function () {
      if (!Settings.get('sound')) return;

      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!this.ctx) this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        var t = this.ctx.currentTime;
        [880, 1320].forEach(function (freq, i) {
          var osc  = Audio2.ctx.createOscillator();
          var gain = Audio2.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t + i * 0.13);
          gain.gain.exponentialRampToValueAtTime(0.22, t + i * 0.13 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.2);
          osc.connect(gain).connect(Audio2.ctx.destination);
          osc.start(t + i * 0.13);
          osc.stop(t + i * 0.13 + 0.22);
        });
      } catch (e) { /* صدا حیاتی نیست */ }
    }
  };

  var Notify = {
    /** اجازه گرفتن از مرورگر */
    request: function () {
      if (!('Notification' in window)) {
        toast('مرورگر شما از اعلان پشتیبانی نمی‌کند', 'err');
        return Promise.resolve(false);
      }
      return Notification.requestPermission().then(function (p) {
        return p === 'granted';
      });
    },

    send: function (title, body) {
      if (!Settings.get('notify')) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      if (!document.hidden) return;   // وقتی کاربر روی صفحه است، توست کافی است

      try {
        new Notification(title, {
          body: body,
          icon: 'assets/img/icon-192.png',
          badge: 'assets/img/icon-96.png',
          tag: 'matchrooz-goal'
        });
      } catch (e) { /* بعضی مرورگرها محدودیت دارند */ }
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

    for (var i = -DAYS_BACK; i <= DAYS_AHEAD; i++) {
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
    var c = { all: State.matches.length, live: 0, started: 0, finished: 0, upcoming: 0, fav: 0 };
    State.matches.forEach(function (m) {
      if (m.status.live) c.live++;
      else if (m.status.finished) c.finished++;
      else c.upcoming++;

      // «شروع شده» یعنی سوت آغاز زده شده: چه در جریان، چه تمام‌شده
      if (m.status.live || m.status.finished) c.started++;
      if (isFollowed(m)) c.fav++;
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
      { key: 'started',  label: 'شروع شده',   n: c.started },
      { key: 'finished', label: 'پایان‌یافته', n: c.finished },
      { key: 'upcoming', label: 'شروع نشده',  n: c.upcoming },
      { key: 'fav',      label: 'دنبال‌شده',   n: c.fav }
    ];

    // با ۲۷ لیگ در یک صفحه، جمع‌کردن یک‌جای همه واقعاً به کار می‌آید
    var allCollapsed = State.collapsed.size > 0;

    box.innerHTML = defs.map(function (d) {
      return '<button class="chip' + (State.filter === d.key ? ' is-active' : '') +
             (d.live ? ' chip--live' : '') + '" data-filter="' + d.key + '" type="button">' +
             (d.live ? '<span class="chip__dot"></span>' : '') +
             esc(d.label) +
             '<span class="chip__count">' + fa(d.n) + '</span></button>';
    }).join('') +
    '<button class="chip chip--ghost" id="toggleAll" type="button">' +
      (allCollapsed ? '⤢ باز کردن همه' : '⤡ جمع کردن همه') + '</button>';
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
      if (State.filter === 'started'  && !(m.status.live || m.status.finished)) return false;
      if (State.filter === 'finished' && !m.status.finished) return false;
      if (State.filter === 'upcoming' && (m.status.live || m.status.finished)) return false;
      if (State.filter === 'fav' && !isFollowed(m)) return false;

      if (q) {
        var hay = (m.teams.home.name + ' ' + m.teams.away.name + ' ' + m.league.name).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /** آیا این بازی یا یکی از دو تیمش دنبال می‌شود؟ */
  function isFollowed(m) {
    return State.favorites.has(String(m.id)) ||
           State.favTeams.has(String(m.teams.home.id)) ||
           State.favTeams.has(String(m.teams.away.id));
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
      // در حالت «بدون لو رفتن نتیجه»، عدد تا وقتی روی آن نزنید پنهان است
      var hide = Settings.get('spoiler') ? ' is-hidden' : '';
      scoreCell = '<div class="match__score' + hide + '" data-score="' +
                  m.goals.home + ':' + m.goals.away + '">' +
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

    // بازی‌های دنبال‌شده در یک بخش جدا بالای صفحه می‌نشینند
    var pinned = '';
    if (State.filter === 'all' && !State.query) {
      var mine = list.filter(isFollowed);
      if (mine.length) {
        pinned = '<section class="league league--pinned">' +
                   '<div class="league__head league__head--static">' +
                     '<span class="league__flag">★</span>' +
                     '<span class="league__meta">' +
                       '<span class="league__name">دنبال‌شده‌های شما</span>' +
                       '<span class="league__country">بازی‌هایی که دنبال می‌کنید</span>' +
                     '</span>' +
                     '<span class="league__badge">' + fa(mine.length) + ' بازی</span>' +
                   '</div>' +
                   '<div class="league__list">' + mine.map(matchRow).join('') + '</div>' +
                 '</section>';
      }
    }

    box.innerHTML = pinned + groupByLeague(list).map(function (g, i) {
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
      started:  ['هنوز بازی‌ای شروع نشده', 'به‌محض شروع اولین بازی، همین‌جا دیده می‌شود.'],
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

      // اگر کاربر خواسته فقط برای دنبال‌شده‌ها خبر بگیرد
      var followed = State.favorites.has(String(m.id)) ||
                     State.favTeams.has(String(m.teams.home.id)) ||
                     State.favTeams.has(String(m.teams.away.id));

      if (Settings.get('onlyFav') && !followed) return;

      var line = m.teams.home.name + ' ' + m.goals.home + ' - ' + m.goals.away + ' ' + m.teams.away.name;

      toast('⚽ گل! <b>' + esc(scored) + '</b> &nbsp;' +
            esc(m.teams.home.name) + ' ' + fa(m.goals.home) + '-' + fa(m.goals.away) + ' ' +
            esc(m.teams.away.name), 'goal', 5000);

      Audio2.beep();
      Notify.send('⚽ گل — ' + scored, line);

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
        State.tickLeft = Settings.get('refresh') || REFRESH_SEC;
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

      // نوار پیشرفت بازی (فقط وقتی در جریان است)
      var progress = '';
      if (m.status.live && m.status.elapsed) {
        var pct = Math.max(2, Math.min(100, (m.status.elapsed / 90) * 100));
        progress = '<div class="sheet__progress" title="دقیقه ' + fa(m.status.elapsed) + '">' +
                     '<span style="width:' + pct.toFixed(1) + '%"></span>' +
                   '</div>';
      }

      $('#sheetHero').innerHTML =
        '<div class="sheet__league">' + esc(m.league.name) +
          (m.league.round ? ' • ' + fa(esc(m.league.round)) : '') +
          (m.venue ? ' • ' + esc(m.venue) : '') + '</div>' +
        '<div class="sheet__score">' +
          '<div class="sheet__side" data-team="' + esc(m.teams.home.id) + '" role="button" tabindex="0">' +
            badge(m.teams.home) + '<b>' + esc(m.teams.home.name) + '</b></div>' +
          '<div class="sheet__num">' + score +
            '<span class="' + pillCls + '">' + esc(pillTxt) + '</span></div>' +
          '<div class="sheet__side" data-team="' + esc(m.teams.away.id) + '" role="button" tabindex="0">' +
            badge(m.teams.away) + '<b>' + esc(m.teams.away.name) + '</b></div>' +
        '</div>' +
        progress +
        '<div class="sheet__actions">' +
          '<button class="ghost-btn" data-share="' + esc(m.id) + '" type="button">🔗 هم‌رسانی</button>' +
          '<button class="ghost-btn" data-fav="' + esc(m.id) + '" type="button">' +
            (State.favorites.has(String(m.id)) ? '★ دنبال می‌کنید' : '☆ دنبال کردن') + '</button>' +
        '</div>';

      // زبانه‌ها
      var tabs = [
        { key: 'events',  label: 'رویدادها' },
        { key: 'stats',   label: 'آمار' },
        { key: 'lineups', label: 'ترکیب' },
        { key: 'h2h',     label: 'رویارویی' }
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
      if (this.tab === 'h2h')     this.viewH2H(m);
    },

    /**
     * رویارویی‌های گذشته — جداگانه از سرور گرفته می‌شود چون همیشه
     * لازم نیست و نباید بارِ هر بار باز کردن بازی را زیاد کند.
     */
    viewH2H: function (m) {
      var body = $('#sheetBody');
      var id   = this.id;

      body.innerHTML = '<div style="padding:8px 0">' +
        '<div class="skeleton" style="height:14px;margin-bottom:9px"></div>'.repeat(5) + '</div>';

      request({ action: 'h2h', id: id })
        .then(function (json) {
          if (Sheet.id !== id || Sheet.tab !== 'h2h') return;

          var rows = json.data || [];
          if (!rows.length) {
            body.innerHTML = '<div class="empty"><div class="empty__icon">🔁</div>' +
              '<div class="empty__title">سابقه‌ای ثبت نشده</div>' +
              '<div class="empty__text">بین این دو تیم دیدار گذشته‌ای پیدا نشد.</div></div>';
            return;
          }

          // خلاصه‌ی برد و باخت از دید تیم میزبانِ بازی جاری
          var homeName = m.teams.home.name, w = 0, d = 0, l = 0;
          rows.forEach(function (r) {
            var mine  = (r.teams.home.name === homeName) ? r.goals.home : r.goals.away;
            var yours = (r.teams.home.name === homeName) ? r.goals.away : r.goals.home;
            if (mine > yours) w++; else if (mine === yours) d++; else l++;
          });

          var summary = '<div class="h2h-sum">' +
              '<div class="h2h-sum__cell"><b>' + fa(w) + '</b><span>برد ' + esc(homeName) + '</span></div>' +
              '<div class="h2h-sum__cell"><b>' + fa(d) + '</b><span>مساوی</span></div>' +
              '<div class="h2h-sum__cell"><b>' + fa(l) + '</b><span>برد ' + esc(m.teams.away.name) + '</span></div>' +
            '</div>';

          body.innerHTML = summary + rows.map(function (r) {
            return '<div class="h2h-row">' +
                     '<span class="h2h-row__date">' + esc(faDate(r.date)) + '</span>' +
                     '<span class="h2h-row__team">' + esc(r.teams.home.name) + '</span>' +
                     '<span class="h2h-row__score">' + fa(r.goals.home) + ' - ' + fa(r.goals.away) + '</span>' +
                     '<span class="h2h-row__team h2h-row__team--away">' + esc(r.teams.away.name) + '</span>' +
                   '</div>';
          }).join('');
        })
        .catch(function (err) {
          if (Sheet.id !== id) return;
          body.innerHTML = '<div class="empty"><div class="empty__icon">⚠️</div>' +
            '<div class="empty__title">در دسترس نیست</div>' +
            '<div class="empty__text">' + esc(err.message) + '</div></div>';
        });
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
     پنجره‌ی پروفایل تیم
     --------------------------------------------------------------------- */

  var TeamSheet = {
    id: null,

    open: function (id) {
      this.id = String(id);

      $('#sheet').classList.add('is-open');
      $('#backdrop').classList.add('is-open');
      document.body.classList.add('no-scroll');

      $('#sheetTabs').innerHTML = '';
      $('#sheetHero').innerHTML = '';
      $('#sheetBody').innerHTML = '<div style="padding:20px">' +
        '<div class="skeleton" style="height:16px;margin-bottom:10px"></div>'.repeat(4) + '</div>';

      var self = this;
      request({ action: 'team', id: this.id })
        .then(function (json) {
          if (self.id !== String(id)) return;
          self.data = json.data;
          self.render();
        })
        .catch(function (err) {
          if (self.id !== String(id)) return;
          $('#sheetBody').innerHTML = '<div class="empty"><div class="empty__icon">⚠️</div>' +
            '<div class="empty__title">اطلاعات تیم در دسترس نیست</div>' +
            '<div class="empty__text">' + esc(err.message) + '</div></div>';
        });
    },

    render: function () {
      var d = this.data;
      if (!d) return;

      var following = State.favTeams.has(String(d.team.id));

      $('#sheetHero').innerHTML =
        '<div class="team-hero">' +
          badge(d.team, 'badge--xl') +
          '<div class="team-hero__name">' + esc(d.team.name) + '</div>' +
          '<button class="follow-btn' + (following ? ' is-on' : '') +
            '" data-favteam="' + esc(d.team.id) + '" type="button">' +
            (following ? '★ دنبال می‌کنید' : '☆ دنبال کردن تیم') + '</button>' +
        '</div>';

      var section = function (title, list, emptyText) {
        if (!list.length) {
          return '<div class="lineup__sub">' + title + '</div>' +
                 '<div class="team-empty">' + emptyText + '</div>';
        }
        return '<div class="lineup__sub">' + title + '</div>' +
               list.map(function (m) {
                 var sc = (m.goals.home === null)
                   ? clock(m.kickoff)
                   : fa(m.goals.home) + ' - ' + fa(m.goals.away);
                 return '<div class="tm-row" data-id="' + esc(m.id) + '" role="button" tabindex="0">' +
                          '<span class="tm-row__date">' + esc(faDate(m.date)) + '</span>' +
                          '<span class="tm-row__team">' + esc(m.teams.home.name) + '</span>' +
                          '<span class="tm-row__score">' + sc + '</span>' +
                          '<span class="tm-row__team tm-row__team--away">' + esc(m.teams.away.name) + '</span>' +
                        '</div>';
               }).join('');
      };

      $('#sheetBody').innerHTML =
        section('بازی‌های اخیر', d.recent || [], 'بازی تمام‌شده‌ای ثبت نشده است.') +
        section('بازی‌های پیش‌رو', d.next || [], 'بازی پیش‌رویی اعلام نشده است.');
    }
  };

  /* ---------------------------------------------------------------------
     صفحه‌ی برترین گلزنان
     --------------------------------------------------------------------- */

  function loadScorers() {
    var box = $('#scorers');
    if (!box || !State.league) return;

    box.innerHTML = '<div class="table-wrap"><div style="padding:16px">' +
      '<div class="skeleton" style="height:15px;margin-bottom:9px"></div>'.repeat(8) + '</div></div>';

    request({ action: 'scorers', league: State.league })
      .then(function (json) {
        var rows = json.data || [];
        if (!rows.length) throw new Error('این منبع فهرست گلزنان ندارد');

        box.innerHTML = '<div class="table-wrap"><div class="table-scroll">' +
          '<table class="standings"><thead><tr>' +
            '<th>#</th><th style="text-align:start">بازیکن</th><th style="text-align:start">تیم</th>' +
            '<th>گل</th><th>پاس گل</th><th>پنالتی</th><th>بازی</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            var cls = r.rank === 1 ? ' st-rank--ucl' : '';
            return '<tr>' +
                     '<td><span class="st-rank' + cls + '">' + fa(r.rank) + '</span></td>' +
                     '<td style="text-align:start"><b>' + esc(r.player) + '</b></td>' +
                     '<td><div class="st-team">' + badge(r.team) +
                       '<span>' + esc(r.team.name) + '</span></div></td>' +
                     '<td class="st-pts">' + fa(r.goals) + '</td>' +
                     '<td>' + fa(r.assists) + '</td>' +
                     '<td>' + fa(r.penalty) + '</td>' +
                     '<td>' + fa(r.played) + '</td>' +
                   '</tr>';
          }).join('') +
          '</tbody></table></div></div>';
      })
      .catch(function (err) {
        box.innerHTML = '<div class="empty"><div class="empty__icon">👟</div>' +
          '<div class="empty__title">فهرست گلزنان در دسترس نیست</div>' +
          '<div class="empty__text">' + esc(err.message) + '</div></div>';
      });
  }

  /* ---------------------------------------------------------------------
     صفحه‌ی جدول رده‌بندی
     --------------------------------------------------------------------- */

  function loadLeagues() {
    return request({ action: 'leagues' }).then(function (json) {
      State.leagues = Array.isArray(json.data) ? json.data : [];
      if (!State.league && State.leagues.length) {
        State.league = State.leagues[0].id;
        // حالا که لیگ مشخص شد، نشانی هم باید همان را نشان بدهد
        if (State.page === 'standings' || State.page === 'scorers') Router.write();
      }
      renderLeaguePicker();
    }).catch(function () { /* بی‌صدا؛ صفحه‌ی اصلی مهم‌تر است */ });
  }

  function renderLeaguePicker() {
    var html = State.leagues.map(function (l) {
      return '<button class="chip' + (String(State.league) === String(l.id) ? ' is-active' : '') +
             '" data-standings="' + esc(l.id) + '" type="button">' +
             (l.flag ? esc(l.flag) + ' ' : '') + esc(l.name) + '</button>';
    }).join('');

    // هم صفحه‌ی جدول و هم صفحه‌ی گلزنان از همین انتخابگر استفاده می‌کنند
    $$('.league-picker').forEach(function (box) { box.innerHTML = html; });
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
     هم‌رسانی
     --------------------------------------------------------------------- */

  function shareMatch(id) {
    var m = null;
    State.matches.forEach(function (x) { if (String(x.id) === String(id)) m = x; });

    var url  = location.origin + location.pathname + '#match/' + id;
    var text = m ? (m.teams.home.name + ' — ' + m.teams.away.name + ' | مچ‌روز') : 'مچ‌روز';

    if (navigator.share) {
      navigator.share({ title: 'مچ‌روز', text: text, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        toast('نشانی بازی کپی شد 🔗');
      }).catch(function () {
        toast('کپی نشد', 'err');
      });
      return;
    }
    toast('مرورگر شما هم‌رسانی را پشتیبانی نمی‌کند', 'err');
  }

  /* ---------------------------------------------------------------------
     مسیریابی با #  — نشانی هر صفحه قابل اشتراک و بازگشت است
     --------------------------------------------------------------------- */

  var Router = {
    lock: false,   // جلوگیری از حلقه هنگام نوشتن خودمان

    /** نشانی فعلی را می‌خواند و برنامه را همان‌جا می‌برد */
    read: function () {
      var h = (location.hash || '').replace(/^#\/?/, '');
      var p = h.split('/');

      if (p[0] === 'match' && p[1]) {
        Sheet.open(decodeURIComponent(p[1]));
        return;
      }
      if (p[0] === 'team' && p[1]) {
        TeamSheet.open(decodeURIComponent(p[1]));
        return;
      }
      if (p[0] === 'standings' || p[0] === 'scorers') {
        if (p[1]) State.league = decodeURIComponent(p[1]);
        showPage(p[0], true);
        return;
      }
      if (p[0] === 'live') {
        if (p[1] && /^\d{4}-\d{2}-\d{2}$/.test(p[1])) State.date = p[1];
        showPage('live', true);
        return;
      }
      showPage('live', true);
    },

    /** نشانی را با وضعیت فعلی هماهنگ می‌کند */
    write: function () {
      var h;
      if (State.page === 'standings' || State.page === 'scorers') {
        h = '#' + State.page + (State.league ? '/' + State.league : '');
      } else {
        h = '#live/' + State.date;
      }
      if (location.hash === h) return;

      this.lock = true;
      location.hash = h;
      setTimeout(function () { Router.lock = false; }, 40);
    }
  };

  /* ---------------------------------------------------------------------
     جابه‌جایی بین صفحه‌ها
     --------------------------------------------------------------------- */

  function showPage(name, fromRouter) {
    State.page = name;

    // نوار تاریخ فقط در صفحه‌ی نتایج معنا دارد
    document.body.classList.toggle('on-live', name === 'live');

    $$('.page').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'page-' + name);
    });
    $$('.nav__btn').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.page === name);
    });

    if (name === 'standings' || name === 'scorers') {
      var run = (name === 'standings') ? loadStandings : loadScorers;
      if (!State.leagues.length) {
        loadLeagues().then(run);
      } else {
        renderLeaguePicker();
        run();
      }
    }

    if (!fromRouter) Router.write();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------------
     پنجره‌ی تنظیمات
     --------------------------------------------------------------------- */

  function renderSettings() {
    var box = $('#settingsBody');
    if (!box) return;

    var toggles = [
      { key: 'sound',   label: 'صدای گل',              hint: 'هنگام گل یک صدای کوتاه پخش شود' },
      { key: 'notify',  label: 'اعلان مرورگر',          hint: 'وقتی صفحه باز نیست هم خبر بدهد' },
      { key: 'onlyFav', label: 'فقط دنبال‌شده‌ها',      hint: 'اعلان فقط برای بازی و تیم‌های دنبال‌شده' },
      { key: 'spoiler', label: 'بدون لو رفتن نتیجه',    hint: 'نتیجه پنهان می‌ماند تا روی آن بزنید' },
      { key: 'compact', label: 'نمایش فشرده',           hint: 'بازی‌های بیشتر در یک صفحه' }
    ];

    var rows = toggles.map(function (t) {
      var on = !!Settings.get(t.key);
      return '<label class="setting">' +
               '<span class="setting__text">' +
                 '<b>' + t.label + '</b>' +
                 '<small>' + t.hint + '</small>' +
               '</span>' +
               '<span class="switch' + (on ? ' is-on' : '') + '" data-toggle="' + t.key + '" ' +
                 'role="switch" tabindex="0" aria-checked="' + (on ? 'true' : 'false') + '">' +
                 '<i></i></span>' +
             '</label>';
    }).join('');

    var intervals = [10, 20, 30, 60].map(function (n) {
      return '<button class="chip' + (Settings.get('refresh') === n ? ' is-active' : '') +
             '" data-refresh="' + n + '" type="button">' + fa(n) + ' ثانیه</button>';
    }).join('');

    box.innerHTML =
      rows +
      '<div class="setting setting--block">' +
        '<span class="setting__text"><b>فاصله‌ی به‌روزرسانی</b>' +
          '<small>هرچه کمتر، تازه‌تر — و مصرف اینترنت بیشتر</small></span>' +
        '<div class="setting__chips">' + intervals + '</div>' +
      '</div>' +
      '<div class="setting setting--block">' +
        '<span class="setting__text"><b>میان‌برهای صفحه‌کلید</b></span>' +
        '<div class="keys">' +
          '<span><kbd>R</kbd> به‌روزرسانی</span>' +
          '<span><kbd>/</kbd> جست‌وجو</span>' +
          '<span><kbd>L</kbd> فقط زنده</span>' +
          '<span><kbd>T</kbd> پوسته</span>' +
          '<span><kbd>←</kbd> <kbd>→</kbd> تغییر روز</span>' +
          '<span><kbd>Esc</kbd> بستن</span>' +
        '</div>' +
      '</div>';
  }

  function openSettings() {
    renderSettings();
    $('#settings').classList.add('is-open');
    $('#backdrop').classList.add('is-open');
    document.body.classList.add('no-scroll');
  }

  function closeSettings() {
    $('#settings').classList.remove('is-open');
    if (!$('#sheet').classList.contains('is-open')) {
      $('#backdrop').classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    }
  }

  /* ---------------------------------------------------------------------
     پوسته
     --------------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    Settings.set('theme', theme);

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

      var span = Settings.get('refresh') || REFRESH_SEC;

      var ring = $('#ring');
      if (ring) {
        var pct = 1 - (State.tickLeft / span);
        var c   = 2 * Math.PI * 17;
        ring.style.strokeDasharray  = c;
        ring.style.strokeDashoffset = c * (1 - pct);
      }

      if (State.tickLeft <= 0) {
        State.tickLeft = span;
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
        Router.write();
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

      // ستاره‌ی دنبال‌کردن بازی
      if ((t = e.target.closest('[data-fav]'))) {
        e.stopPropagation();
        var id = String(t.dataset.fav);
        var on;

        if (State.favorites.has(id)) {
          State.favorites.delete(id);
          t.classList.remove('is-on');
          on = false;
        } else {
          State.favorites.add(id);
          t.classList.add('is-on');
          toast('به دنبال‌شده‌ها اضافه شد ⭐');
          on = true;
        }
        // دکمه‌ی داخل پنجره متن دارد، ستاره‌ی فهرست فقط آیکون است
        if (t.classList.contains('ghost-btn')) {
          t.textContent = on ? '★ دنبال می‌کنید' : '☆ دنبال کردن';
        }
        Store.set('favorites', Array.from(State.favorites));
        renderFilters();
        renderList();
        return;
      }

      // دنبال‌کردن یک تیم
      if ((t = e.target.closest('[data-favteam]'))) {
        e.stopPropagation();
        var tid = String(t.dataset.favteam);

        if (State.favTeams.has(tid)) {
          State.favTeams.delete(tid);
          t.classList.remove('is-on');
          t.textContent = '☆ دنبال کردن تیم';
        } else {
          State.favTeams.add(tid);
          t.classList.add('is-on');
          t.textContent = '★ دنبال می‌کنید';
          toast('این تیم دنبال می‌شود ⭐');
        }
        Store.set('favTeams', Array.from(State.favTeams));
        renderFilters();
        renderList();
        return;
      }

      // باز کردن پروفایل تیم
      if ((t = e.target.closest('[data-team]'))) {
        e.stopPropagation();
        TeamSheet.open(t.dataset.team);
        return;
      }

      // هم‌رسانی بازی
      if ((t = e.target.closest('[data-share]'))) {
        e.stopPropagation();
        shareMatch(t.dataset.share);
        return;
      }

      // نمایش نتیجه‌ی پنهان‌شده
      if ((t = e.target.closest('.match__score.is-hidden'))) {
        e.stopPropagation();
        t.classList.remove('is-hidden');
        return;
      }

      // جمع‌کردن یا باز کردن همه‌ی لیگ‌ها
      if (e.target.closest('#toggleAll')) {
        if (State.collapsed.size > 0) {
          State.collapsed.clear();
        } else {
          // فقط لیگ‌هایی که همین حالا روی صفحه‌اند
          $$('.league__head[data-league]').forEach(function (h) {
            State.collapsed.add(h.dataset.league);
          });
        }
        Store.set('collapsed', Array.from(State.collapsed));
        renderFilters();
        renderList();
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
      if ((t = e.target.closest('.match, .tcard, .tm-row'))) {
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

      // انتخاب لیگ (هم برای جدول، هم برای گلزنان)
      if ((t = e.target.closest('[data-standings]'))) {
        State.league = t.dataset.standings;
        renderLeaguePicker();
        if (State.page === 'scorers') loadScorers(); else loadStandings();
        Router.write();
        return;
      }

      // ناوبری
      if ((t = e.target.closest('[data-page]'))) {
        showPage(t.dataset.page);
        return;
      }

      // کلیدهای تنظیمات
      if ((t = e.target.closest('[data-toggle]'))) {
        var key = t.dataset.toggle;
        var next = !Settings.get(key);

        if (key === 'notify' && next) {
          // اول باید مرورگر اجازه بدهد
          Notify.request().then(function (ok) {
            Settings.set('notify', ok);
            if (!ok) toast('اجازه‌ی اعلان داده نشد', 'err');
            renderSettings();
          });
          return;
        }

        Settings.set(key, next);
        if (key === 'sound' && next) Audio2.beep();
        renderSettings();
        if (key === 'spoiler' || key === 'compact') renderList();
        return;
      }

      if ((t = e.target.closest('[data-refresh]'))) {
        Settings.set('refresh', parseInt(t.dataset.refresh, 10));
        State.tickLeft = Settings.get('refresh');
        renderSettings();
        toast('فاصله‌ی به‌روزرسانی تغییر کرد');
        return;
      }

      if (e.target.closest('#settingsBtn')) {
        openSettings();
        return;
      }
      if (e.target.closest('#settingsClose')) {
        closeSettings();
        return;
      }

      // بستن پنجره
      if (e.target.closest('#sheetClose') || e.target.id === 'backdrop') {
        Sheet.close();
        closeSettings();
        return;
      }

      // تلاش دوباره
      if (e.target.id === 'retry') {
        loadMatches(false);
        return;
      }
    });

    // صفحه‌کلید: دسترسی‌پذیری و میان‌برها
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        Sheet.close();
        closeSettings();
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.matches && e.target.matches('.match, .tcard, .tm-row')) {
          e.preventDefault();
          Sheet.open(e.target.dataset.id);
          return;
        }
        if (e.target.matches && e.target.matches('[data-team], [data-toggle]')) {
          e.preventDefault();
          e.target.click();
          return;
        }
      }

      // میان‌برها فقط وقتی داخل کادر متنی نیستیم
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.ctrlKey || e.metaKey || e.altKey) return;

      var k = e.key.toLowerCase();

      if (k === 'r') { loadMatches(true); toast('در حال به‌روزرسانی…', null, 1200); }
      else if (k === 't') { applyTheme(Settings.get('theme') === 'light' ? 'dark' : 'light'); }
      else if (k === 's') { openSettings(); }
      else if (k === 'l') {
        State.filter = (State.filter === 'live') ? 'all' : 'live';
        renderFilters(); renderList();
      }
      else if (k === '/') {
        e.preventDefault();
        var sb = $('#search');
        if (sb) { sb.hidden = false; $('#searchInput').focus(); }
      }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // در چیدمان راست‌چین، فلش راست یعنی روز قبل
        if (State.page !== 'live') return;
        var step = (e.key === 'ArrowRight') ? -1 : 1;
        var d    = FA.addDays(FA.parseIso(State.date), step);
        var off  = FA.daysFromToday(d);
        if (off < -DAYS_BACK || off > DAYS_AHEAD) return;

        State.date = FA.isoDate(d);
        State.firstLoad = true;
        renderDatebar();
        Router.write();
        loadMatches(false);
      }
    });

    // تغییر نشانی (دکمه‌ی برگشت مرورگر یا لینک اشتراکی)
    window.addEventListener('hashchange', function () {
      if (Router.lock) return;
      Router.read();
    });

    /* ---- کشیدن به پایین برای تازه‌سازی (موبایل) ---- */
    var pullStart = 0, pulling = false;
    var pullEl = $('#pull');

    document.addEventListener('touchstart', function (e) {
      if (window.scrollY > 0 || State.page !== 'live') return;
      pullStart = e.touches[0].clientY;
      pulling   = true;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!pulling || !pullEl) return;

      var dist = e.touches[0].clientY - pullStart;
      if (dist <= 0) { pullEl.style.height = '0px'; return; }

      // مقاومت، تا کشیدن طبیعی حس شود
      var h = Math.min(70, dist * 0.45);
      pullEl.style.height = h + 'px';
      pullEl.classList.toggle('is-ready', h >= 55);
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (!pulling || !pullEl) return;
      pulling = false;

      if (pullEl.classList.contains('is-ready')) {
        loadMatches(true);
        toast('در حال به‌روزرسانی…', null, 1200);
      }
      pullEl.style.height = '0px';
      pullEl.classList.remove('is-ready');
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
        applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
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
    Settings.load();
    Settings.apply();
    applyTheme(Settings.get('theme'));

    State.favorites = new Set(Store.get('favorites', []));
    State.favTeams  = new Set(Store.get('favTeams', []));
    State.collapsed = new Set(Store.get('collapsed', []));
    State.tickLeft  = Settings.get('refresh') || REFRESH_SEC;

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

    document.body.classList.add('on-live');

    renderDatebar();
    renderFilters();
    bind();
    startTicker();

    // نشانی ممکن است مستقیم به یک بازی یا صفحه اشاره کند
    var deep = (location.hash || '').length > 1;

    loadMatches(false).then(function () {
      if (deep) Router.read();
    });

    if (!deep) Router.write();

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
