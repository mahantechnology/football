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

    public function __construct(array $config, Cache $cache)
    {
        $this->config = $config;
        $this->cache  = $cache;
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
