/* =========================================================================
   MatchRooz — تقویم شمسی
   تبدیل تاریخ میلادی به هجری شمسی و ابزارهای نمایش تاریخ.
   ========================================================================= */

window.Jalali = (function () {
  'use strict';

  var MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  /* روزهای هفته به ترتیب getDay() جاوااسکریپت: یکشنبه = ۰ */
  var WEEKDAYS      = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
  var WEEKDAYS_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];

  /* تعداد روزهای سپری‌شده تا ابتدای هر ماه میلادی */
  var G_MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

  var PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  function intDiv(a, b) {
    return Math.floor(a / b);
  }

  /**
   * تبدیل تاریخ میلادی به شمسی.
   * @returns {{jy:number, jm:number, jd:number}}
   */
  function toJalali(gy, gm, gd) {
    var jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;

    // سال میلادیِ مبنا برای شمارش روزهای کبیسه
    var gy2 = (gm > 2) ? (gy + 1) : gy;

    var days = (365 * gy)
             + intDiv(gy2 + 3, 4)
             - intDiv(gy2 + 99, 100)
             + intDiv(gy2 + 399, 400)
             - 80
             + gd
             + G_MONTH_DAYS[gm - 1];

    // هر ۳۳ سال شمسی برابر ۱۲۰۵۳ روز است
    jy += 33 * intDiv(days, 12053);
    days %= 12053;

    jy += 4 * intDiv(days, 1461);
    days %= 1461;

    if (days > 365) {
      jy += intDiv(days - 1, 365);
      days = (days - 1) % 365;
    }

    var jm, jd;
    if (days < 186) {
      // شش ماه اول، هر کدام ۳۱ روز
      jm = 1 + intDiv(days, 31);
      jd = 1 + (days % 31);
    } else {
      // شش ماه دوم، هر کدام ۳۰ روز
      jm = 7 + intDiv(days - 186, 30);
      jd = 1 + ((days - 186) % 30);
    }

    return { jy: jy, jm: jm, jd: jd };
  }

  /** تبدیل شیء Date به شمسی */
  function fromDate(date) {
    return toJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  /** ارقام لاتین را به فارسی تبدیل می‌کند */
  function digits(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[0-9]/g, function (d) {
      return PERSIAN_DIGITS[+d];
    });
  }

  /** «۹ شهریور ۱۴۰۵» */
  function longDate(date) {
    var j = fromDate(date);
    return digits(j.jd) + ' ' + MONTHS[j.jm - 1] + ' ' + digits(j.jy);
  }

  /** نام روز هفته */
  function weekday(date) {
    return WEEKDAYS[date.getDay()];
  }

  function weekdayShort(date) {
    return WEEKDAYS_SHORT[date.getDay()];
  }

  /** برچسب نسبی: دیروز / امروز / فردا، وگرنه نام روز */
  function relativeLabel(date) {
    var diff = daysFromToday(date);
    if (diff === 0)  return 'امروز';
    if (diff === -1) return 'دیروز';
    if (diff === 1)  return 'فردا';
    return WEEKDAYS[date.getDay()];
  }

  /** اختلاف روز نسبت به امروز (بدون در نظر گرفتن ساعت) */
  function daysFromToday(date) {
    var a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var n = new Date();
    var b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((a - b) / 86400000);
  }

  /** YYYY-MM-DD به وقت محلی (نه UTC) */
  function isoDate(date) {
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + m + '-' + d;
  }

  /** ساخت Date از رشته‌ی YYYY-MM-DD */
  function parseIso(iso) {
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  return {
    months: MONTHS,
    toJalali: toJalali,
    fromDate: fromDate,
    digits: digits,
    longDate: longDate,
    weekday: weekday,
    weekdayShort: weekdayShort,
    relativeLabel: relativeLabel,
    daysFromToday: daysFromToday,
    isoDate: isoDate,
    parseIso: parseIso,
    addDays: addDays
  };
})();
