<?php
/**
 * قرارداد مشترک همه‌ی منابع داده.
 *
 * هر منبع، خروجی خود را به «قالب یکسان MatchRooz» تبدیل می‌کند تا
 * سمت فرانت‌اند فرقی نکند داده از کجا آمده است.
 *
 * قالب یک بازی:
 * [
 *   'id'      => string,
 *   'date'    => 'YYYY-MM-DD'      (به وقت محلی سایت)
 *   'kickoff' => timestamp یونیکس
 *   'status'  => ['short'=>'1H','label'=>'نیمه اول','elapsed'=>34,'live'=>true,'finished'=>false]
 *   'league'  => ['id'=>..,'name'=>..,'country'=>..,'logo'=>..,'round'=>..,'priority'=>int]
 *   'teams'   => ['home'=>['id'=>..,'name'=>..,'logo'=>..], 'away'=>[...]]
 *   'goals'   => ['home'=>int|null,'away'=>int|null]
 *   'halftime'=> ['home'=>int|null,'away'=>int|null]
 *   'venue'   => string
 * ]
 */
abstract class Provider
{
    /** @var array */
    protected $config;
    /** @var Cache */
    protected $cache;
    /** @var Translator */
    protected $tr;

    public function __construct(array $config, Cache $cache)
    {
        $this->config = $config;
        $this->cache  = $cache;

        $localize = !isset($config['localize']) || !empty($config['localize']);
        $this->tr = new Translator($localize);
    }

    // ---------------------------------------------------------------
    // ساخت بلوک تیم و لیگ (مشترک بین همه‌ی منابع)
    // ---------------------------------------------------------------

    /**
     * بلوک استاندارد یک تیم: نام فارسی‌شده، لوگو و رنگ‌های باشگاه.
     *
     * @param string $name نام خام از سرویس داده
     * @param mixed  $id   شناسه‌ی تیم در آن سرویس
     * @param string $logo آدرس لوگو اگر سرویس داده باشد
     */
    protected function makeTeam($name, $id = 0, $logo = '')
    {
        $meta = $this->tr->team($name);

        return [
            'id'     => is_numeric($id) ? (int) $id : (string) $id,
            'name'   => $meta['name'],
            'logo'   => $this->logoFor($logo, $meta['slug']),
            'slug'   => $meta['slug'],
            'colors' => $meta['colors'],
        ];
    }

    /**
     * تصمیم می‌گیرد کدام لوگو نمایش داده شود.
     *
     * ترتیب: لوگوی خود سرویس ← فایل محلی (اگر فعال باشد) ← هیچ‌کدام
     * (در حالت آخر، سمت مرورگر یک نشان با رنگ‌های باشگاه کشیده می‌شود.)
     */
    protected function logoFor($providerLogo, $slug)
    {
        $cfg  = isset($this->config['logos']) ? $this->config['logos'] : [];
        $mode = isset($cfg['mode']) ? $cfg['mode'] : 'auto';

        if ($mode === 'off') {
            return '';
        }

        if ($providerLogo !== '' && $providerLogo !== null && $mode !== 'local') {
            return $providerLogo;
        }

        // فایل محلی: کاربر می‌تواند لوگوهای خودش را در این پوشه بگذارد
        if (($mode === 'local' || $mode === 'auto') && !empty($cfg['local']) && $slug !== '') {
            $pattern = !empty($cfg['local_pattern']) ? $cfg['local_pattern'] : 'assets/img/teams/{slug}.png';
            return str_replace('{slug}', $slug, $pattern);
        }

        return $providerLogo === null ? '' : (string) $providerLogo;
    }

    /**
     * بلوک استاندارد یک لیگ، با نام و کشورِ فارسی‌شده.
     */
    protected function makeLeague($id, $name, $country = '', $logo = '', $round = '', $flag = '')
    {
        return [
            'id'       => is_numeric($id) ? (int) $id : (string) $id,
            'name'     => $this->tr->league($name),
            'country'  => $this->tr->country($country),
            'flag'     => $flag,
            'logo'     => $logo,
            'round'    => $this->localizeRound($round),
            'priority' => $this->leaguePriority($id),
        ];
    }

    /** «Regular Season - 12» را به «هفته ۱۲» تبدیل می‌کند */
    protected function localizeRound($round)
    {
        $r = trim((string) $round);
        if ($r === '') {
            return '';
        }
        if (preg_match('/[\x{0600}-\x{06FF}]/u', $r)) {
            return $r; // از قبل فارسی است
        }

        if (preg_match('/regular season\s*-?\s*(\d+)/i', $r, $m)) {
            return 'هفته ' . $m[1];
        }

        $map = [
            'final'          => 'فینال',
            'semi finals'    => 'نیمه‌نهایی',
            'semi final'     => 'نیمه‌نهایی',
            'quarter finals' => 'یک‌چهارم نهایی',
            'quarter final'  => 'یک‌چهارم نهایی',
            'round of 16'    => 'یک‌هشتم نهایی',
            '8th finals'     => 'یک‌هشتم نهایی',
            'group stage'    => 'مرحله گروهی',
            'league stage'   => 'مرحله لیگی',
            'play offs'      => 'پلی‌آف',
            '3rd place final'=> 'رده‌بندی',
        ];
        $key = strtolower(trim(preg_replace('/[^a-zA-Z0-9 ]+/', ' ', $r)));
        $key = preg_replace('/\s+/', ' ', $key);
        if (isset($map[$key])) {
            return $map[$key];
        }
        if (preg_match('/group\s+([a-h])/i', $r, $m)) {
            return 'گروه ' . strtoupper($m[1]);
        }

        return $r;
    }

    /** فهرست بازی‌های یک روز (YYYY-MM-DD) */
    abstract public function matches($date);

    /** جزئیات یک بازی: رویدادها، آمار، ترکیب */
    abstract public function matchDetail($id);

    /** جدول رده‌بندی یک لیگ */
    abstract public function standings($leagueId, $season);

    /** فهرست لیگ‌های قابل نمایش */
    abstract public function leagues();

    /** نام منبع برای نمایش در پاسخ */
    abstract public function name();

    // ---------------------------------------------------------------
    // قابلیت‌های اختیاری
    //
    // هر منبعی این‌ها را ندارد (مثلاً نسخه‌ی رایگان TheSportsDB).
    // پیاده‌سازی پیش‌فرض خالی برمی‌گرداند تا سایت خطا ندهد و فقط آن
    // بخش را «در دسترس نیست» نشان دهد.
    // ---------------------------------------------------------------

    /** رویارویی‌های گذشته‌ی دو تیم یک بازی */
    public function headToHead($matchId)
    {
        return [];
    }

    /** برترین گلزنان یک لیگ */
    public function scorers($leagueId, $season)
    {
        return [];
    }

    /** پروفایل یک تیم: بازی‌های اخیر و پیش‌رو */
    public function teamProfile($teamId)
    {
        return null;
    }

    // ---------------------------------------------------------------
    // کمکی‌های مشترک
    // ---------------------------------------------------------------

    /**
     * وضعیت را به برچسب فارسی تبدیل می‌کند.
     */
    protected static function statusLabel($short, $elapsed = null)
    {
        $map = [
            'TBD' => 'زمان نامشخص',
            'NS'  => 'شروع نشده',
            '1H'  => 'نیمه اول',
            'HT'  => 'بین دو نیمه',
            '2H'  => 'نیمه دوم',
            'ET'  => 'وقت اضافه',
            'BT'  => 'استراحت وقت اضافه',
            'P'   => 'ضربات پنالتی',
            'SUSP'=> 'متوقف شده',
            'INT' => 'قطع موقت',
            'FT'  => 'پایان',
            'AET' => 'پایان (وقت اضافه)',
            'PEN' => 'پایان (پنالتی)',
            'PST' => 'به تعویق افتاد',
            'CANC'=> 'لغو شد',
            'ABD' => 'نیمه‌کاره',
            'AWD' => 'حکم فنی',
            'WO'  => 'انصراف',
            'LIVE'=> 'در حال انجام',
        ];
        return isset($map[$short]) ? $map[$short] : $short;
    }

    protected static function isLive($short)
    {
        return in_array($short, ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'], true);
    }

    protected static function isFinished($short)
    {
        return in_array($short, ['FT', 'AET', 'PEN', 'AWD', 'WO'], true);
    }

    /**
     * ساخت بلوک وضعیت استاندارد.
     */
    protected static function makeStatus($short, $elapsed = null)
    {
        return [
            'short'    => $short,
            'label'    => self::statusLabel($short),
            'elapsed'  => $elapsed,
            'live'     => self::isLive($short),
            'finished' => self::isFinished($short),
        ];
    }

    /**
     * اولویت نمایش لیگ بر اساس فهرست منتخب در config.
     * لیگ‌های منتخب بالاتر می‌آیند.
     */
    protected function leaguePriority($leagueId)
    {
        $featured = isset($this->config['featured_leagues']) ? $this->config['featured_leagues'] : [];
        $idx      = array_search((int) $leagueId, $featured, true);
        return $idx === false ? 900 + ((int) $leagueId % 100) : $idx;
    }

    /**
     * مرتب‌سازی بازی‌ها: زنده‌ها اول، بعد اولویت لیگ، بعد ساعت شروع.
     */
    protected static function sortMatches(array &$matches)
    {
        usort($matches, function ($a, $b) {
            $liveA = !empty($a['status']['live']) ? 0 : 1;
            $liveB = !empty($b['status']['live']) ? 0 : 1;
            if ($liveA !== $liveB) {
                return $liveA - $liveB;
            }
            $pa = isset($a['league']['priority']) ? $a['league']['priority'] : 999;
            $pb = isset($b['league']['priority']) ? $b['league']['priority'] : 999;
            if ($pa !== $pb) {
                return $pa - $pb;
            }
            return $a['kickoff'] - $b['kickoff'];
        });
    }
}
