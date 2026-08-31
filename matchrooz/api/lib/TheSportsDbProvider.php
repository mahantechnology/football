<?php
/**
 * منبع داده‌ی TheSportsDB.
 *
 * گزینه‌ی جایگزین و ارزان‌قیمت. توجه: نسخه‌ی رایگان جزئیات کاملی
 * (ترکیب و آمار دقیق) ندارد؛ برای نتایج زنده و جدول مناسب است.
 */
class TheSportsDbProvider extends Provider
{
    private $key;

    public function __construct(array $config, Cache $cache)
    {
        parent::__construct($config, $cache);
        $cfg       = isset($config['thesportsdb']) ? $config['thesportsdb'] : [];
        $this->key = !empty($cfg['key']) ? trim($cfg['key']) : '3';
    }

    public function name()
    {
        return 'thesportsdb';
    }

    private function call($path, array $params)
    {
        $url = 'https://www.thesportsdb.com/api/v1/json/' . rawurlencode($this->key)
             . '/' . ltrim($path, '/') . '?' . http_build_query($params);

        $res = Http::get($url);

        if ($res['status'] === 0) {
            throw new ApiException('اتصال به TheSportsDB برقرار نشد: ' . $res['error']);
        }
        if ($res['status'] === 429) {
            throw new ApiException('سهمیه‌ی درخواست تمام شده است.');
        }
        if ($res['status'] < 200 || $res['status'] >= 300) {
            throw new ApiException('پاسخ نامعتبر از TheSportsDB (کد ' . $res['status'] . ')');
        }

        $json = json_decode($res['body'], true);
        return is_array($json) ? $json : [];
    }

    /**
     * وضعیت متنی TheSportsDB را به کد استاندارد تبدیل می‌کند.
     */
    private function normalizeStatus($status, $progress, $kickoff)
    {
        $s = strtoupper(trim((string) $status));

        if ($s === 'FT' || strpos($s, 'FINISH') !== false) {
            return ['FT', 90];
        }
        if ($s === 'AET') {
            return ['AET', 120];
        }
        if ($s === 'PEN') {
            return ['PEN', 120];
        }
        if ($s === 'HT' || strpos($s, 'HALF') !== false) {
            return ['HT', 45];
        }
        if (strpos($s, 'POSTP') !== false) {
            return ['PST', null];
        }
        if (strpos($s, 'CANC') !== false) {
            return ['CANC', null];
        }

        $min = is_numeric($progress) ? (int) $progress : null;
        if ($min !== null && $min > 0) {
            return [$min > 45 ? '2H' : '1H', $min];
        }
        if ($s === '1H' || $s === '2H') {
            return [$s, $min];
        }

        // بدون وضعیت مشخص: از روی ساعت شروع حدس بزن
        if ($kickoff && time() > $kickoff && time() < $kickoff + 7200) {
            return ['LIVE', null];
        }
        return ['NS', null];
    }

    private function mapEvent(array $e, $date = null)
    {
        $kickoff = 0;
        if (!empty($e['strTimestamp'])) {
            $kickoff = strtotime($e['strTimestamp'] . ' UTC');
        } elseif (!empty($e['dateEvent'])) {
            $kickoff = strtotime($e['dateEvent'] . ' ' . (!empty($e['strTime']) ? $e['strTime'] : '00:00:00') . ' UTC');
        }
        $kickoff = $kickoff ?: time();

        list($short, $elapsed) = $this->normalizeStatus(
            isset($e['strStatus']) ? $e['strStatus'] : '',
            isset($e['strProgress']) ? $e['strProgress'] : '',
            $kickoff
        );

        $leagueId = isset($e['idLeague']) ? (int) $e['idLeague'] : 0;

        $num = function ($v) {
            return ($v === null || $v === '') ? null : (int) $v;
        };

        return [
            'id'       => (string) (isset($e['idEvent']) ? $e['idEvent'] : ''),
            'date'     => $date !== null ? $date : date('Y-m-d', $kickoff),
            'kickoff'  => $kickoff,
            'status'   => self::makeStatus($short, $elapsed),
            'league'   => [
                'id'       => $leagueId,
                'name'     => isset($e['strLeague']) ? $e['strLeague'] : '',
                'country'  => isset($e['strCountry']) ? $e['strCountry'] : '',
                'flag'     => '',
                'logo'     => isset($e['strLeagueBadge']) ? $e['strLeagueBadge'] : '',
                'round'    => !empty($e['intRound']) ? 'هفته ' . $e['intRound'] : '',
                'priority' => $this->leaguePriority($leagueId),
            ],
            'teams'    => [
                'home' => [
                    'id'   => isset($e['idHomeTeam']) ? (int) $e['idHomeTeam'] : 0,
                    'name' => isset($e['strHomeTeam']) ? $e['strHomeTeam'] : '',
                    'logo' => isset($e['strHomeTeamBadge']) ? $e['strHomeTeamBadge'] : '',
                ],
                'away' => [
                    'id'   => isset($e['idAwayTeam']) ? (int) $e['idAwayTeam'] : 0,
                    'name' => isset($e['strAwayTeam']) ? $e['strAwayTeam'] : '',
                    'logo' => isset($e['strAwayTeamBadge']) ? $e['strAwayTeamBadge'] : '',
                ],
            ],
            'goals'    => [
                'home' => $num(isset($e['intHomeScore']) ? $e['intHomeScore'] : null),
                'away' => $num(isset($e['intAwayScore']) ? $e['intAwayScore'] : null),
            ],
            'halftime' => ['home' => null, 'away' => null],
            'venue'    => isset($e['strVenue']) ? $e['strVenue'] : '',
        ];
    }

    public function matches($date)
    {
        $json = $this->call('eventsday.php', ['d' => $date, 's' => 'Soccer']);
        $rows = isset($json['events']) && is_array($json['events']) ? $json['events'] : [];

        $out = [];
        foreach ($rows as $e) {
            $out[] = $this->mapEvent($e, $date);
        }
        self::sortMatches($out);
        return $out;
    }

    public function matchDetail($id)
    {
        $json = $this->call('lookupevent.php', ['id' => $id]);
        $rows = isset($json['events']) && is_array($json['events']) ? $json['events'] : [];
        if (empty($rows[0])) {
            return null;
        }

        $match            = $this->mapEvent($rows[0]);
        $match['events']  = [];   // نسخه‌ی رایگان رویداد لحظه‌ای نمی‌دهد
        $match['stats']   = [];
        $match['lineups'] = [];
        $match['referee'] = '';

        return $match;
    }

    public function standings($leagueId, $season)
    {
        // TheSportsDB فصل را به شکل 2024-2025 می‌خواهد
        $seasonStr = $season . '-' . ($season + 1);
        $json      = $this->call('lookuptable.php', ['l' => $leagueId, 's' => $seasonStr]);
        $rows      = isset($json['table']) && is_array($json['table']) ? $json['table'] : [];

        if (!$rows) {
            return null;
        }

        $out = [];
        foreach ($rows as $i => $r) {
            $gf = isset($r['intGoalsFor']) ? (int) $r['intGoalsFor'] : 0;
            $ga = isset($r['intGoalsAgainst']) ? (int) $r['intGoalsAgainst'] : 0;
            $out[] = [
                'rank'   => isset($r['intRank']) ? (int) $r['intRank'] : $i + 1,
                'team'   => [
                    'id'   => isset($r['idTeam']) ? (int) $r['idTeam'] : 0,
                    'name' => isset($r['strTeam']) ? $r['strTeam'] : '',
                    'logo' => isset($r['strBadge']) ? $r['strBadge'] : '',
                ],
                'played' => isset($r['intPlayed']) ? (int) $r['intPlayed'] : 0,
                'win'    => isset($r['intWin']) ? (int) $r['intWin'] : 0,
                'draw'   => isset($r['intDraw']) ? (int) $r['intDraw'] : 0,
                'lose'   => isset($r['intLoss']) ? (int) $r['intLoss'] : 0,
                'gf'     => $gf,
                'ga'     => $ga,
                'gd'     => $gf - $ga,
                'points' => isset($r['intPoints']) ? (int) $r['intPoints'] : 0,
                'form'   => '',
            ];
        }

        return [
            'league' => [
                'id'      => (int) $leagueId,
                'name'    => isset($rows[0]['strLeague']) ? $rows[0]['strLeague'] : '',
                'country' => '',
                'flag'    => '',
                'logo'    => '',
                'season'  => (int) $season,
            ],
            'rows' => $out,
        ];
    }

    public function leagues()
    {
        $featured = isset($this->config['featured_leagues']) ? $this->config['featured_leagues'] : [];
        $out      = [];
        foreach ($featured as $id) {
            $json = $this->call('lookupleague.php', ['id' => $id]);
            $rows = isset($json['leagues']) && is_array($json['leagues']) ? $json['leagues'] : [];
            if (empty($rows[0])) {
                continue;
            }
            $l = $rows[0];
            $out[] = [
                'id'       => (int) $id,
                'name'     => isset($l['strLeague']) ? $l['strLeague'] : '',
                'country'  => isset($l['strCountry']) ? $l['strCountry'] : '',
                'flag'     => '',
                'logo'     => isset($l['strBadge']) ? $l['strBadge'] : '',
                'priority' => $this->leaguePriority($id),
            ];
        }
        return $out;
    }
}
