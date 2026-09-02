<?php
/**
 * مترجم نام‌ها — MatchRooz
 *
 * سرویس‌های داده نام تیم‌ها و لیگ‌ها را انگلیسی می‌دهند. این کلاس آن‌ها
 * را به فارسی برمی‌گرداند و در کنارش «هویت باشگاه» (رنگ‌ها و شناسه‌ی
 * کوتاه) را هم پیدا می‌کند تا وقتی لوگوی رسمی در دسترس نیست، نشان
 * جایگزینِ باکیفیت با رنگ‌های واقعی همان باشگاه ساخته شود.
 *
 * نکته‌ی مهم: تطبیق نام‌ها بر اساس شکل «نرمال‌شده» انجام می‌شود، چون
 * هر سرویس نام را جور دیگری می‌نویسد:
 *   "Manchester City"  /  "Man City"  /  "Manchester City FC"
 */
class Translator
{
    /** @var array نام نرمال‌شده‌ی انگلیسی => [فارسی, رنگ۱, رنگ۲] */
    private $teams;
    /** @var array */
    private $leagues;
    /** @var array */
    private $countries;
    /** @var array */
    private $nationalColors;

    /** @var array نام فارسیِ نرمال‌شده => ['colors'=>[..], 'slug'=>..] */
    private $byPersian = [];
    /** @var array املاهای جایگزین فارسی */
    private $persianAliases = [];

    /** @var bool آیا ترجمه فعال است */
    private $enabled;

    /**
     * کلمه‌هایی که در نام باشگاه‌ها تکرار می‌شوند و برای تطبیق حذف می‌شوند.
     * (مثلاً "AS Roma" و "Roma" باید به یک نتیجه برسند.)
     */
    private static $NOISE = [
        'fc', 'cf', 'ac', 'sc', 'ss', 'as', 'rc', 'cd', 'ud', 'sd', 'sv',
        'tsv', 'vfl', 'vfb', 'bsc', 'afc', 'cfc', 'ssc', 'acf', 'asd',
        'kv', 'kaa', 'rsc', 'ogc', 'us', 'if', 'bk', 'ff', 'sk', 'fk',
        'club', 'calcio', 'futbol', 'football', 'deportivo', 'real sporting',
        'cp', 'sad', 'ca', 'ec', 'se', 'cr', 'sl', 'scp', 'nk', 'hnk',
        // کلمات ربط که در نام رسمی باشگاه‌ها می‌آیند
        'de', 'da', 'do', 'del', 'di', 'of', 'the', 'und', 'and',
    ];

    /** جایگزینی حروف لاتین دارای علامت */
    private static $ACCENTS = [
        'á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a','ā'=>'a',
        'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','ē'=>'e',
        'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','ī'=>'i',
        'ó'=>'o','ò'=>'o','ô'=>'o','ö'=>'o','õ'=>'o','ø'=>'o','ō'=>'o',
        'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u','ū'=>'u',
        'ñ'=>'n','ç'=>'c','ß'=>'ss','ý'=>'y','ÿ'=>'y',
        'š'=>'s','ś'=>'s','ž'=>'z','ź'=>'z','ż'=>'z','č'=>'c','ć'=>'c',
        'ř'=>'r','ł'=>'l','ğ'=>'g','ı'=>'i','ş'=>'s','đ'=>'d','ď'=>'d',
        'ě'=>'e','ť'=>'t','ů'=>'u','ń'=>'n','ő'=>'o','ű'=>'u',
    ];

    public function __construct($enabled = true)
    {
        $this->enabled = (bool) $enabled;

        $this->teams   = require __DIR__ . '/data/teams.php';
        $misc          = require __DIR__ . '/data/misc.php';
        $this->leagues        = $misc['leagues'];
        $this->countries      = $misc['countries'];
        $this->nationalColors = $misc['national_colors'];
        $this->persianAliases = isset($misc['persian_aliases']) ? $misc['persian_aliases'] : [];

        $this->buildReverseIndex();
    }

    /**
     * نمایه‌ی معکوس: از نام فارسی به رنگ و شناسه.
     * حالت نمایشی نام‌ها را از ابتدا فارسی تولید می‌کند، پس برای پیدا
     * کردن رنگ باشگاه به این نمایه نیاز داریم.
     */
    private function buildReverseIndex()
    {
        foreach ($this->teams as $key => $row) {
            $fa = self::normalizePersian($row[0]);
            // اولین کلیدی که به این نام فارسی رسیده، مبنا می‌ماند
            if (!isset($this->byPersian[$fa])) {
                $this->byPersian[$fa] = [
                    'colors' => [$row[1], $row[2]],
                    'slug'   => str_replace(' ', '-', $key),
                ];
            }
        }

        // املاهای جایگزین به همان مدخل اصلی وصل می‌شوند
        foreach ($this->persianAliases as $variant => $canonical) {
            $v = self::normalizePersian($variant);
            $c = self::normalizePersian($canonical);
            if (!isset($this->byPersian[$v]) && isset($this->byPersian[$c])) {
                $this->byPersian[$v] = $this->byPersian[$c];
            }
        }

        foreach ($this->nationalColors as $key => $colors) {
            if (isset($this->countries[$key])) {
                $fa = self::normalizePersian($this->countries[$key]);
                if (!isset($this->byPersian[$fa])) {
                    $this->byPersian[$fa] = [
                        'colors' => $colors,
                        'slug'   => str_replace(' ', '-', $key),
                    ];
                }
            }
        }
    }

    /**
     * نام را به شکل قابل تطبیق درمی‌آورد.
     */
    public static function normalize($name)
    {
        $s = trim((string) $name);
        if ($s === '') {
            return '';
        }

        // حروف کوچک (با پشتیبانی یونیکد در صورت وجود mbstring)
        $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);

        // حذف علامت‌های روی حروف لاتین
        $s = strtr($s, self::$ACCENTS);

        // تبدیل هر چیزی جز حرف و رقم به فاصله
        $s = preg_replace('/[^a-z0-9\x{0600}-\x{06FF}]+/u', ' ', $s);
        $s = trim(preg_replace('/\s+/', ' ', $s));

        // حذف کلمات پرتکرارِ بی‌اثر
        $parts = explode(' ', $s);
        $keep  = [];
        foreach ($parts as $p) {
            if ($p === '') {
                continue;
            }
            if (in_array($p, self::$NOISE, true)) {
                continue;
            }
            $keep[] = $p;
        }

        // اگر همه‌چیز حذف شد، به نسخه‌ی قبلی برگرد
        return $keep ? implode(' ', $keep) : $s;
    }

    /** نسخه‌ی بدون رقم، برای نام‌هایی مثل "Mainz 05" یا "Schalke 04" */
    private static function stripDigits($norm)
    {
        $s = trim(preg_replace('/\s*\d+\s*/', ' ', $norm));
        return preg_replace('/\s+/', ' ', $s);
    }

    /**
     * هویت یک تیم: نام فارسی، رنگ‌ها و شناسه‌ی کوتاه.
     *
     * @return array{name:string, colors:array|null, slug:string}
     */
    public function team($name)
    {
        $original = (string) $name;

        // نام از قبل فارسی است (حالت نمایشی)
        if ($this->isPersian($original)) {
            $key  = self::normalizePersian($original);
            $meta = isset($this->byPersian[$key]) ? $this->byPersian[$key] : null;
            return [
                'name'   => $original,
                'colors' => $meta ? $meta['colors'] : null,
                'slug'   => $meta ? $meta['slug'] : '',
            ];
        }

        $norm = self::normalize($original);
        $row  = null;

        if (isset($this->teams[$norm])) {
            $row = $this->teams[$norm];
            $key = $norm;
        } else {
            $alt = self::stripDigits($norm);
            if ($alt !== $norm && isset($this->teams[$alt])) {
                $row = $this->teams[$alt];
                $key = $alt;
            }
        }

        if ($row === null) {
            // تیم ملی؟
            if (isset($this->countries[$norm])) {
                $colors = isset($this->nationalColors[$norm]) ? $this->nationalColors[$norm] : null;
                return [
                    'name'   => $this->enabled ? $this->countries[$norm] : $original,
                    'colors' => $colors,
                    'slug'   => str_replace(' ', '-', $norm),
                ];
            }

            // پیدا نشد: نام اصلی حفظ می‌شود
            return ['name' => $original, 'colors' => null, 'slug' => str_replace(' ', '-', $norm)];
        }

        return [
            'name'   => $this->enabled ? $row[0] : $original,
            'colors' => [$row[1], $row[2]],
            'slug'   => str_replace(' ', '-', $key),
        ];
    }

    /** نام لیگ */
    public function league($name)
    {
        $original = (string) $name;
        if (!$this->enabled || $this->isPersian($original)) {
            return $original;
        }

        $norm = self::normalize($original);
        if (isset($this->leagues[$norm])) {
            return $this->leagues[$norm];
        }

        $alt = self::stripDigits($norm);
        if (isset($this->leagues[$alt])) {
            return $this->leagues[$alt];
        }

        return $original;
    }

    /** نام کشور */
    public function country($name)
    {
        $original = (string) $name;
        if (!$this->enabled || $this->isPersian($original)) {
            return $original;
        }

        $norm = self::normalize($original);
        return isset($this->countries[$norm]) ? $this->countries[$norm] : $original;
    }

    /**
     * یکسان‌سازی متن فارسی برای تطبیق.
     *
     * یک نام ممکن است با «ی» و «ک» عربی نوشته شود، یا نیم‌فاصله داشته
     * باشد یا نداشته باشد. بدون این پاک‌سازی، «گل‌گهر» و «گل گهر» دو
     * چیز متفاوت به حساب می‌آیند.
     */
    public static function normalizePersian($s)
    {
        $s = (string) $s;

        $s = strtr($s, [
            "\xD9\x8A" => "\xDB\x8C", // ي عربی  => ی فارسی
            "\xD9\x83" => "\xDA\xA9", // ك عربی  => ک فارسی
            "\xD8\xA9" => "\xD9\x87", // ة       => ه
            "\xE2\x80\x8C" => ' ',     // نیم‌فاصله => فاصله
            "\xE2\x80\x8F" => '',      // نشانه‌ی جهت
            "\xC2\xA0"      => ' ',     // فاصله‌ی سخت
        ]);

        // حذف اعراب
        $s = preg_replace('/[\x{064B}-\x{0652}\x{0640}]/u', '', $s);

        return trim(preg_replace('/\s+/u', ' ', $s));
    }

    /** آیا رشته حرف فارسی/عربی دارد */
    private function isPersian($s)
    {
        return (bool) preg_match('/[\x{0600}-\x{06FF}]/u', (string) $s);
    }
}
