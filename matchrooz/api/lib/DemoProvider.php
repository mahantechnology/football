<?php
/**
 * منبع داده‌ی نمایشی.
 *
 * بازی‌ها را برای هر تاریخ به‌صورت «قطعی» (deterministic) می‌سازد: با
 * ورودی یکسان همیشه خروجی یکسان می‌دهد، اما دقیقه و نتیجه‌ی بازی‌های
 * امروز با گذشت زمان واقعی جلو می‌رود. بنابراین سایت بلافاصله پس از
 * نصب، بدون هیچ کلید API، «زنده» به نظر می‌رسد و قابل تست است.
 */
class DemoProvider extends Provider
{
    /** طول هر نیمه و استراحت بین دو نیمه، بر حسب دقیقه‌ی واقعی */
    const HALF     = 45;
    const BREAK    = 15;
    const FULL     = 105; // 45 + 15 + 45

    private $data;
    private $seed = 1;

    public function __construct(array $config, Cache $cache)
    {
        parent::__construct($config, $cache);
        $this->data = require __DIR__ . '/demo-data.php';
    }

    public function name()
    {
        return 'demo';
    }

    // ---------------------------------------------------------------
    // مولد عدد شبه‌تصادفی قطعی
    // ---------------------------------------------------------------

    private function srand($key)
    {
        $this->seed = crc32((string) $key) & 0x7FFFFFFF;
        if ($this->seed === 0) {
            $this->seed = 1;
        }
    }

    private function next()
    {
        $this->seed = ($this->seed * 1103515245 + 12345) & 0x7FFFFFFF;
        return $this->seed;
    }

    /** عدد تصادفی در بازه‌ی بسته */
    private function rnd($min, $max)
    {
        if ($max <= $min) {
            return $min;
        }
        return $min + ($this->next() % ($max - $min + 1));
    }

    /** یک عضو تصادفی از آرایه */
    private function pick(array $arr)
    {
        return $arr[$this->next() % count($arr)];
    }

    /** بُر زدن قطعی (Fisher–Yates با مولد خودمان) */
    private function shuffleDet(array $arr)
    {
        for ($i = count($arr) - 1; $i > 0; $i--) {
            $j = $this->next() % ($i + 1);
            $t = $arr[$i];
            $arr[$i] = $arr[$j];
            $arr[$j] = $t;
        }
        return $arr;
    }

    // ---------------------------------------------------------------
    // ساخت برنامه‌ی یک روز
    // ---------------------------------------------------------------

    /**
     * برنامه‌ی خام روز: آرایه‌ای از بازی‌ها بدون وضعیت زنده.
     */
    private function schedule($date)
    {
        $ts       = strtotime($date . ' 00:00:00');
        $dayKey   = date('Y-m-d', $ts);
        $fixtures = [];

        // مرحله ۱: تعیین اینکه هر لیگ چه بازی‌هایی دارد
        foreach ($this->data['leagues'] as $league) {
            $this->srand($dayKey . '|league|' . $league['id']);

            // همه‌ی لیگ‌ها هر روز برنامه دارند تا فهرست هیچ‌وقت خالی نباشد
            $teams = $this->shuffleDet($league['teams']);
            $max   = (int) floor(count($teams) / 2);
            $count = $max;

            for ($i = 0; $i < $count; $i++) {
                $fixtures[] = [
                    'id'     => 'd' . date('Ymd', $ts) . '-' . $league['id'] . '-' . $i,
                    'league' => $league,
                    'home'   => $teams[$i * 2],
                    'away'   => $teams[$i * 2 + 1],
                ];
            }
        }

        // مرحله ۲: پخش ساعت شروع در تمام شبانه‌روز
        //
        // از دنباله‌ی نسبت طلایی استفاده می‌شود چون بدون هیچ خوشه یا
        // حفره‌ای، نقاط را یکنواخت روی بازه پخش می‌کند. نتیجه این است
        // که کاربر در هر ساعتی سایت را باز کند، چند بازی زنده می‌بیند.
        // (در حالت واقعی، ساعت‌ها از خود سرویس می‌آید.)
        $n = count($fixtures);
        foreach ($fixtures as $i => &$fx) {
            $frac        = fmod(($i + 1) * 0.6180339887498949, 1.0);
            $minuteOfDay = (int) (floor(($frac * 1440) / 5) * 5);
            $fx['kickoff'] = $ts + $minuteOfDay * 60;
        }
        unset($fx);

        return $fixtures;
    }

    /**
     * سناریوی رویدادهای یک بازی: گل‌ها، کارت‌ها و تعویض‌ها با دقیقه‌ی مشخص.
     */
    private function script(array $fx)
    {
        $this->srand($fx['id'] . '|script');

        $events = [];

        // قدرت نسبی دو تیم، برای اینکه نتایج منطقی به نظر برسد
        $homeGoals = $this->rnd(0, 100) < 12 ? $this->rnd(4, 5) : $this->rnd(0, 3);
        $awayGoals = $this->rnd(0, 100) < 8  ? $this->rnd(4, 5) : $this->rnd(0, 3);

        $minutes = [];
        for ($i = 0; $i < $homeGoals + $awayGoals; $i++) {
            $minutes[] = $this->rnd(2, 90);
        }
        sort($minutes);

        $idx = 0;
        foreach (['home' => $homeGoals, 'away' => $awayGoals] as $side => $n) {
            for ($i = 0; $i < $n; $i++) {
                $events[] = [
                    'minute' => $minutes[$idx++],
                    'type'   => 'goal',
                    'side'   => $side,
                    'player' => $this->pick($this->data['players']),
                    'detail' => $this->rnd(1, 100) > 84 ? 'پنالتی' : 'گل',
                ];
            }
        }

        // کارت‌ها
        $cards = $this->rnd(1, 6);
        for ($i = 0; $i < $cards; $i++) {
            $events[] = [
                'minute' => $this->rnd(10, 90),
                'type'   => $this->rnd(1, 100) > 92 ? 'red' : 'yellow',
                'side'   => $this->rnd(0, 1) ? 'home' : 'away',
                'player' => $this->pick($this->data['players']),
                'detail' => 'خطا',
            ];
        }

        // تعویض‌ها
        $subs = $this->rnd(2, 6);
        for ($i = 0; $i < $subs; $i++) {
            $events[] = [
                'minute' => $this->rnd(46, 90),
                'type'   => 'subst',
                'side'   => $this->rnd(0, 1) ? 'home' : 'away',
                'player' => $this->pick($this->data['players']),
                'detail' => 'تعویض',
            ];
        }

        usort($events, function ($a, $b) {
            return $a['minute'] - $b['minute'];
        });

        return $events;
    }

    /**
     * وضعیت زنده‌ی بازی را از روی ساعت واقعی حساب می‌کند.
     *
     * @return array{status:array, elapsed:int|null, cut:int}
     *         cut = دقیقه‌ای که رویدادها تا آن لحظه رخ داده‌اند
     */
    private function liveState($kickoff)
    {
        $diff = (int) floor((time() - $kickoff) / 60); // دقیقه از زمان شروع

        if ($diff < 0) {
            return ['status' => self::makeStatus('NS', null), 'cut' => -1];
        }
        if ($diff < self::HALF) {
            return ['status' => self::makeStatus('1H', max(1, $diff)), 'cut' => $diff];
        }
        if ($diff < self::HALF + self::BREAK) {
            return ['status' => self::makeStatus('HT', 45), 'cut' => 45];
        }
        if ($diff < self::FULL) {
            $elapsed = 45 + ($diff - self::HALF - self::BREAK);
            return ['status' => self::makeStatus('2H', $elapsed), 'cut' => $elapsed];
        }
        return ['status' => self::makeStatus('FT', 90), 'cut' => 999];
    }

    /**
     * تبدیل یک fixture خام به قالب استاندارد MatchRooz.
     */
    private function build(array $fx, $date)
    {
        $events = $this->script($fx);
        $state  = $this->liveState($fx['kickoff']);
        $cut    = $state['cut'];

        $goals = ['home' => null, 'away' => null];
        $ht    = ['home' => null, 'away' => null];

        if ($cut >= 0) {
            $goals = ['home' => 0, 'away' => 0];
            $ht    = ['home' => 0, 'away' => 0];
            foreach ($events as $e) {
                if ($e['type'] !== 'goal') {
                    continue;
                }
                if ($e['minute'] <= $cut) {
                    $goals[$e['side']]++;
                }
                if ($e['minute'] <= 45) {
                    $ht[$e['side']]++;
                }
            }
            if ($cut < 45) {
                // هنوز نیمه اول تمام نشده؛ نتیجه‌ی نیمه اول معنا ندارد
                $ht = ['home' => null, 'away' => null];
            }
        }

        $this->srand($fx['id'] . '|meta');

        return [
            'id'       => $fx['id'],
            'date'     => $date,
            'kickoff'  => $fx['kickoff'],
            'status'   => $state['status'],
            'league'   => $this->makeLeague(
                $fx['league']['id'],
                $fx['league']['name'],
                $fx['league']['country'],
                '',
                'هفته ' . $this->rnd(1, 30),
                $fx['league']['flag']
            ),
            'teams'    => [
                'home' => $this->makeTeam($fx['home'], crc32($fx['home']) % 9000),
                'away' => $this->makeTeam($fx['away'], crc32($fx['away']) % 9000),
            ],
            'goals'    => $goals,
            'halftime' => $ht,
            'venue'    => $this->pick($this->data['venues']),
        ];
    }

    // ---------------------------------------------------------------
    // پیاده‌سازی قرارداد Provider
    // ---------------------------------------------------------------

    public function matches($date)
    {
        $out = [];
        foreach ($this->schedule($date) as $fx) {
            $out[] = $this->build($fx, $date);
        }
        self::sortMatches($out);
        return $out;
    }

    public function matchDetail($id)
    {
        // بازی را در برنامه‌ی روزِ نهفته در شناسه پیدا کن
        if (!preg_match('/^d(\d{4})(\d{2})(\d{2})-/', $id, $m)) {
            return null;
        }
        $date = "$m[1]-$m[2]-$m[3]";

        $target = null;
        foreach ($this->schedule($date) as $fx) {
            if ($fx['id'] === $id) {
                $target = $fx;
                break;
            }
        }
        if ($target === null) {
            return null;
        }

        $match  = $this->build($target, $date);
        $events = $this->script($target);
        $state  = $this->liveState($target['kickoff']);
        $cut    = $state['cut'];

        // فقط رویدادهایی که تا این لحظه رخ داده‌اند
        $visible = [];
        foreach ($events as $e) {
            if ($e['minute'] <= $cut) {
                $visible[] = $e;
            }
        }
        $visible = array_reverse($visible); // جدیدترین بالا

        $match['events']   = $visible;
        $match['stats']    = $this->stats($target, $cut);
        $match['lineups']  = $this->lineups($target);
        $this->srand($target['id'] . '|ref');
        $match['referee']  = $this->pick($this->data['referees']);

        return $match;
    }

    /** آمار بازی، متناسب با دقیقه‌ی جاری */
    private function stats(array $fx, $cut)
    {
        $this->srand($fx['id'] . '|stats');
        $played = $cut < 0 ? 0 : min(90, max(1, $cut));
        $factor = $played / 90;

        $possHome = $this->rnd(35, 65);

        $mk = function ($label, $h, $a, $suffix = '') {
            return ['label' => $label, 'home' => $h . $suffix, 'away' => $a . $suffix];
        };

        return [
            $mk('مالکیت توپ', $possHome, 100 - $possHome, '٪'),
            $mk('شوت‌ها', (int) round($this->rnd(6, 20) * $factor), (int) round($this->rnd(5, 18) * $factor)),
            $mk('شوت در چارچوب', (int) round($this->rnd(2, 9) * $factor), (int) round($this->rnd(1, 8) * $factor)),
            $mk('کرنر', (int) round($this->rnd(2, 11) * $factor), (int) round($this->rnd(1, 10) * $factor)),
            $mk('خطا', (int) round($this->rnd(6, 18) * $factor), (int) round($this->rnd(6, 18) * $factor)),
            $mk('آفساید', (int) round($this->rnd(0, 5) * $factor), (int) round($this->rnd(0, 5) * $factor)),
            $mk('پاس دقیق', $this->rnd(72, 92), $this->rnd(70, 91), '٪'),
        ];
    }

    /** ترکیب دو تیم */
    private function lineups(array $fx)
    {
        $out = [];
        foreach (['home', 'away'] as $side) {
            $this->srand($fx['id'] . '|lineup|' . $side);
            $formation = $this->pick(['4-3-3', '4-2-3-1', '3-5-2', '4-4-2', '3-4-3']);
            $pool      = $this->shuffleDet($this->data['players']);

            $start = [];
            for ($i = 0; $i < 11; $i++) {
                $start[] = ['number' => $i === 0 ? 1 : $this->rnd(2, 30), 'name' => $pool[$i]];
            }
            $bench = [];
            for ($i = 11; $i < 18 && $i < count($pool); $i++) {
                $bench[] = ['number' => $this->rnd(12, 40), 'name' => $pool[$i]];
            }

            $out[$side] = [
                'team'      => $fx[$side],
                'formation' => $formation,
                'coach'     => $this->pick($this->data['players']),
                'start'     => $start,
                'bench'     => $bench,
            ];
        }
        return $out;
    }

    public function standings($leagueId, $season)
    {
        $league = null;
        foreach ($this->data['leagues'] as $l) {
            if ((int) $l['id'] === (int) $leagueId) {
                $league = $l;
                break;
            }
        }
        if ($league === null) {
            return null;
        }

        $rows = [];
        foreach ($league['teams'] as $team) {
            $this->srand($season . '|' . $leagueId . '|' . $team);
            $played = $this->rnd(18, 26);
            $win    = $this->rnd(2, $played - 4);
            $draw   = $this->rnd(0, $played - $win);
            $lose   = $played - $win - $draw;
            $gf     = $win * 2 + $draw + $this->rnd(0, 12);
            $ga     = $lose * 2 + $draw + $this->rnd(0, 10);

            $rows[] = [
                'team'   => $this->makeTeam($team, crc32($team) % 9000),
                'played' => $played,
                'win'    => $win,
                'draw'   => $draw,
                'lose'   => $lose,
                'gf'     => $gf,
                'ga'     => $ga,
                'gd'     => $gf - $ga,
                'points' => $win * 3 + $draw,
                'form'   => $this->formString(),
            ];
        }

        usort($rows, function ($a, $b) {
            if ($a['points'] !== $b['points']) {
                return $b['points'] - $a['points'];
            }
            if ($a['gd'] !== $b['gd']) {
                return $b['gd'] - $a['gd'];
            }
            return $b['gf'] - $a['gf'];
        });

        foreach ($rows as $i => &$r) {
            $r['rank'] = $i + 1;
        }
        unset($r);

        $lg           = $this->makeLeague($league['id'], $league['name'], $league['country'], '', '', $league['flag']);
        $lg['season'] = (int) $season;

        return ['league' => $lg, 'rows' => $rows];
    }

    private function formString()
    {
        $s = '';
        for ($i = 0; $i < 5; $i++) {
            $r = $this->rnd(1, 3);
            $s .= $r === 1 ? 'W' : ($r === 2 ? 'D' : 'L');
        }
        return $s;
    }

    // ---------------------------------------------------------------
    // قابلیت‌های تکمیلی
    // ---------------------------------------------------------------

    /** فیکسچر خام یک بازی را از روی شناسه پیدا می‌کند */
    private function findFixture($id)
    {
        if (!preg_match('/^d(\d{4})(\d{2})(\d{2})-/', $id, $m)) {
            return null;
        }
        foreach ($this->schedule("$m[1]-$m[2]-$m[3]") as $fx) {
            if ($fx['id'] === $id) {
                return $fx;
            }
        }
        return null;
    }

    /**
     * رویارویی‌های گذشته‌ی دو تیم.
     * بذر از روی نام دو تیم (مرتب‌شده) ساخته می‌شود تا نتیجه‌ی یکسانی
     * برای هر دو جهتِ بازی بدهد.
     */
    public function headToHead($matchId)
    {
        $fx = $this->findFixture($matchId);
        if ($fx === null) {
            return [];
        }

        $pair = [$fx['home'], $fx['away']];
        sort($pair);
        $this->srand('h2h|' . implode('|', $pair));

        $out   = [];
        $count = $this->rnd(4, 7);
        $ts    = strtotime('today');

        for ($i = 0; $i < $count; $i++) {
            // هر بازی چند ماه عقب‌تر از قبلی
            $ts -= $this->rnd(90, 260) * 86400;

            // میزبانی بین دو تیم جابه‌جا می‌شود
            $swap = ($i % 2) === 1;
            $home = $swap ? $fx['away'] : $fx['home'];
            $away = $swap ? $fx['home'] : $fx['away'];

            $hg = $this->rnd(0, 4);
            $ag = $this->rnd(0, 3);

            $out[] = [
                'date'    => date('Y-m-d', $ts),
                'league'  => $fx['league']['name'],
                'teams'   => [
                    'home' => $this->makeTeam($home, crc32($home) % 9000),
                    'away' => $this->makeTeam($away, crc32($away) % 9000),
                ],
                'goals'   => ['home' => $hg, 'away' => $ag],
                'swapped' => $swap,
            ];
        }

        return $out;
    }

    /** برترین گلزنان یک لیگ */
    public function scorers($leagueId, $season)
    {
        $league = null;
        foreach ($this->data['leagues'] as $l) {
            if ((int) $l['id'] === (int) $leagueId) {
                $league = $l;
                break;
            }
        }
        if ($league === null) {
            return [];
        }

        // یک استخر نام مخصوص همین لیگ، تا نام تکراری در جدول نیفتد
        $this->srand($season . '|pool|' . $leagueId);
        $pool = $this->shuffleDet($this->data['players']);
        $p    = 0;

        $rows = [];
        foreach ($league['teams'] as $ti => $team) {
            // از هر تیم دو بازیکن وارد فهرست می‌شود
            for ($i = 0; $i < 2; $i++) {
                if ($p >= count($pool)) {
                    break 2; // استخر نام تمام شد
                }
                $this->srand($season . '|scorer|' . $leagueId . '|' . $team . '|' . $i);

                // آقای گل‌ها کم‌اند و بقیه دنباله‌ای نزولی می‌سازند،
                // تا جدول شبیه یک فصل واقعی به نظر برسد
                $base  = (int) round(26 * exp(-0.16 * ($ti * 2 + $i)));
                $goals = max(1, $base + $this->rnd(-2, 2));

                $rows[] = [
                    'player'  => $pool[$p++],
                    'team'    => $this->makeTeam($team, crc32($team) % 9000),
                    'goals'   => $goals,
                    'assists' => $this->rnd(0, max(1, (int) round($goals / 2))),
                    'penalty' => $this->rnd(0, max(1, (int) round($goals / 5))),
                    'played'  => $this->rnd(14, 26),
                ];
            }
        }

        usort($rows, function ($a, $b) {
            if ($a['goals'] !== $b['goals']) {
                return $b['goals'] - $a['goals'];
            }
            return $b['assists'] - $a['assists'];
        });

        $rows = array_slice($rows, 0, 20);
        foreach ($rows as $i => &$r) {
            $r['rank'] = $i + 1;
        }
        unset($r);

        return $rows;
    }

    /**
     * پروفایل تیم: بازی‌های اخیر و پیش‌رو.
     * برنامه‌ی روزهای اطراف ساخته و بازی‌های این تیم جدا می‌شود.
     */
    public function teamProfile($teamId)
    {
        // پیدا کردن تیم از روی شناسه
        $name = null;
        foreach ($this->data['leagues'] as $l) {
            foreach ($l['teams'] as $t) {
                if ((string) (crc32($t) % 9000) === (string) $teamId) {
                    $name = $t;
                    break 2;
                }
            }
        }
        if ($name === null) {
            return null;
        }

        $past   = [];
        $future = [];

        for ($d = -10; $d <= 10; $d++) {
            $date = date('Y-m-d', strtotime("$d days"));

            foreach ($this->schedule($date) as $fx) {
                if ($fx['home'] !== $name && $fx['away'] !== $name) {
                    continue;
                }
                $m = $this->build($fx, $date);

                if ($m['status']['finished']) {
                    $past[] = $m;
                } elseif (!$m['status']['live']) {
                    $future[] = $m;
                } else {
                    // بازی در حال انجام، بالای فهرست اخیر می‌نشیند
                    array_unshift($past, $m);
                }
            }
        }

        // اخیرترین‌ها اول
        usort($past, function ($a, $b) { return $b['kickoff'] - $a['kickoff']; });
        usort($future, function ($a, $b) { return $a['kickoff'] - $b['kickoff']; });

        return [
            'team'   => $this->makeTeam($name, crc32($name) % 9000),
            'recent' => array_slice($past, 0, 6),
            'next'   => array_slice($future, 0, 6),
        ];
    }

    public function leagues()
    {
        $out = [];
        foreach ($this->data['leagues'] as $l) {
            $out[] = $this->makeLeague($l['id'], $l['name'], $l['country'], '', '', $l['flag']);
        }
        usort($out, function ($a, $b) {
            return $a['priority'] - $b['priority'];
        });
        return $out;
    }
}
