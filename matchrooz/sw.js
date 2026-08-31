/* =========================================================================
   MatchRooz — سرویس‌ورکر
   پوسته‌ی برنامه را ذخیره می‌کند تا سایت در اتصال ضعیف یا قطع اینترنت
   هم باز شود. داده‌ی زنده هیچ‌وقت به‌صورت دائمی کش نمی‌شود.
   ========================================================================= */

var VERSION    = 'matchrooz-v1';
var SHELL      = VERSION + '-shell';
var RUNTIME    = VERSION + '-runtime';

/* فایل‌هایی که برای باز شدن اولیه‌ی سایت لازم‌اند */
var SHELL_FILES = [
  './',
  'index.html',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/jalali.js',
  'assets/img/logo.png',
  'assets/img/logo-256.png',
  'assets/img/icon-192.png',
  'assets/fonts/Vazirmatn-Regular.woff2',
  'assets/fonts/Vazirmatn-Medium.woff2',
  'assets/fonts/Vazirmatn-Bold.woff2',
  'manifest.webmanifest'
];

/* ---------------------------------------------------------------- نصب */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (cache) {
      // اگر یکی از فایل‌ها به هر دلیل نبود، کل نصب شکست نخورد
      return Promise.all(SHELL_FILES.map(function (url) {
        return cache.add(url).catch(function () { return null; });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* --------------------------------------------------------------- فعال */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        // نسخه‌های قدیمی را پاک کن
        if (key !== SHELL && key !== RUNTIME) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ------------------------------------------------------------ درخواست */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // فقط GET و فقط همین دامنه
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* داده‌ی زنده: اول شبکه، در نبود شبکه آخرین پاسخ موفق */
  if (url.pathname.indexOf('/api/') !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        // یک نسخه برای مواقع قطعی نگه دار
        var copy = res.clone();
        caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response(
            JSON.stringify({
              ok: false,
              error: 'اتصال اینترنت برقرار نیست.',
              data: null,
              meta: { offline: true }
            }),
            { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  /* درخواست صفحه: اول شبکه تا نسخه‌ی تازه بیاید، بعد کش */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* فایل‌های ثابت: اول کش (سریع‌تر)، بعد شبکه */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
