<?php
/**
 * منبع داده‌ی API-Football (نسخه ۳).
 *
 * هم با سرویس مستقیم (v3.football.api-sports.io) کار می‌کند و هم با
 * RapidAPI؛ تفاوت فقط در هدرهاست که خودکار تشخیص داده می‌شود.
 */
class ApiFootballProvider extends Provider
{
    private $key;
    private $host;
    private $tz;

    public function __construct(array $config, Cache $cache)
    {
        parent::__construct($config, $cache);
        $cfg        = isset($config['apifootball']) ? $config['apifootball'] : [];
        $this->key  = isset($cfg['key']) ? trim($cfg['key']) : '';
        $this->host = !empty($cfg['host']) ? $cfg['host'] : 'v3.football.api-sports.io';
        $this->tz   = !empty($cfg['timezone']) ? $cfg['timezone'] : 'Asia/Tehran';
    }

    public function name()
    {
        return 'apifootball';
    }

    public function isConfigured()
    {
        return $this->key !== '';
    }

    /**
     * درخواست به سرویس و بازگرداندن آرایه‌ی response.
     * در صورت خطا ApiException پرتاب می‌شود.
     */
    private function call($path, array $params)
    {
        if (!$this->isConfigured()) {
            throw new ApiException('کلید API-Football تنظیم نشده است. فایل api/config.php را ویرایش کنید.');
        }

        $url = 'https://' . $this->host . '/' . ltrim($path, '/') . '?' . http_build_query($params);

        // RapidAPI هدرهای متفاوتی می‌خواهد
        if (strpos($this->host, 'rapidapi.com') !== false) {
            $headers = [
                'x-rapidapi-key: ' . $this->key,
                'x-rapidapi-host: ' . $this->host,
            ];
        } else {
            $headers = ['x-apisports-key: ' . $this->key];
        }

        $res = Http::get($url, $headers);

        if ($res['status'] === 0) {
            throw new ApiException('اتصال به سرویس برقرار نشد: ' . $res['error']);
        }
        if ($res['status'] === 429) {
            throw new ApiException('سهمیه‌ی درخواست API تمام شده است. کمی بعد دوباره تلاش کنید.');
        }
        if ($res['status'] === 401 || $res['status'] === 403) {
            throw new ApiException('کلید API معتبر نیست یا دسترسی ندارد.');
        }
        if ($res['status'] < 200 || $res['status'] >= 300) {
            throw new ApiException('پاسخ نامعتبر از سرویس (کد ' . $res['status'] . ')');
        }

        $json = json_decode($res['body'], true);
        if (!is_array($json)) {
            throw new ApiException('پاسخ سرویس قابل خواندن نبود.');
        }

        // API-Football خطاها را داخل بدنه هم برمی‌گرداند
        if (!empty($json['errors']) && is_array($json['errors'])) {
            $first = reset($json['errors']);
            if (is_string($first) && $first !== '') {
                throw new ApiException('سرویس خطا داد: ' . $first);
            }
        }

        return isset($json['response']) && is_array($json['response']) ? $json['response'] : [];
    }

    // ---------------------------------------------------------------

    public function matches($date)
    {
        $rows = $this->call('fixtures', ['date' => $date, 'timezone' => $this->tz]);

        $out = [];
        foreach ($rows as $row) {
            $out[] = $this->mapFixture($row, $date);
        }
        self::sortMatches($out);
        return $out;
    }

    private function mapFixture(array $row, $date = null)
    {
        $fx     = isset($row['fixture']) ? $row['fixture'] : [];
        $lg     = isset($row['league']) ? $row['league'] : [];
        $teams  = isset($row['teams']) ? $row['teams'] : [];
        $goals  = isset($row['goals']) ? $row['goals'] : [];
        $score  = isset($row['score']) ? $row['score'] : [];

        $short   = isset($fx['status']['short']) ? $fx['status']['short'] : 'NS';
        $elapsed = isset($fx['status']['elapsed']) ? $fx['status']['elapsed'] : null;
        $ts      = isset($fx['timestamp']) ? (int) $fx['timestamp'] : strtotime(isset($fx['date']) ? $fx['date'] : 'now');

        return [
            'id'       => (string) (isset($fx['id']) ? $fx['id'] : ''),
            'date'     => $date !== null ? $date : date('Y-m-d', $ts),
            'kickoff'  => $ts,
            'status'   => self::makeStatus($short, $elapsed),
            'league'   => [
                'id'       => isset($lg['id']) ? (int) $lg['id'] : 0,
                'name'     => isset($lg['name']) ? $lg['name'] : '',
                'country'  => isset($lg['country']) ? $lg['country'] : '',
                'flag'     => isset($lg['flag']) ? $lg['flag'] : '',
                'logo'     => isset($lg['logo']) ? $lg['logo'] : '',
                'round'    => isset($lg['round']) ? $lg['round'] : '',
                'priority' => $this->leaguePriority(isset($lg['id']) ? $lg['id'] : 0),
            ],
            'teams'    => [
                'home' => $this->mapTeam(isset($teams['home']) ? $teams['home'] : []),
                'away' => $this->mapTeam(isset($teams['away']) ? $teams['away'] : []),
            ],
            'goals'    => [
                'home' => isset($goals['home']) ? $goals['home'] : null,
                'away' => isset($goals['away']) ? $goals['away'] : null,
            ],
            'halftime' => [
                'home' => isset($score['halftime']['home']) ? $score['halftime']['home'] : null,
                'away' => isset($score['halftime']['away']) ? $score['halftime']['away'] : null,
            ],
            'venue'    => isset($fx['venue']['name']) ? $fx['venue']['name'] : '',
        ];
    }

    private function mapTeam(array $t)
    {
        return [
            'id'   => isset($t['id']) ? (int) $t['id'] : 0,
            'name' => isset($t['name']) ? $t['name'] : '',
            'logo' => isset($t['logo']) ? $t['logo'] : '',
        ];
    }

    public function matchDetail($id)
    {
        $rows = $this->call('fixtures', ['id' => $id, 'timezone' => $this->tz]);
        if (empty($rows[0])) {
            return null;
        }
        $row   = $rows[0];
        $match = $this->mapFixture($row);

        $homeId = $match['teams']['home']['id'];

        // رویدادها
        $events = [];
        foreach ((isset($row['events']) ? $row['events'] : []) as $e) {
            $type = strtolower(isset($e['type']) ? $e['type'] : '');
            $det  = isset($e['detail']) ? $e['detail'] : '';

            if ($type === 'card') {
                $kind = stripos($det, 'red') !== false ? 'red' : 'yellow';
            } elseif ($type === 'subst') {
                $kind = 'subst';
            } elseif ($type === 'goal') {
                $kind = 'goal';
            } else {
                $kind = 'var';
            }

            $events[] = [
                'minute' => isset($e['time']['elapsed']) ? (int) $e['time']['elapsed'] : 0,
                'type'   => $kind,
                'side'   => (isset($e['team']['id']) && (int) $e['team']['id'] === $homeId) ? 'home' : 'away',
                'player' => isset($e['player']['name']) ? $e['player']['name'] : '',
                'detail' => $det,
            ];
        }
        $match['events'] = array_reverse($events);

        // آمار
        $stats = [];
        $raw   = isset($row['statistics']) ? $row['statistics'] : [];
        if (count($raw) >= 2) {
            $labels = [
                'Ball Possession'      => 'مالکیت توپ',
                'Total Shots'          => 'شوت‌ها',
                'Shots on Goal'        => 'شوت در چارچوب',
                'Corner Kicks'         => 'کرنر',
                'Fouls'                => 'خطا',
                'Offsides'             => 'آفساید',
                'Yellow Cards'         => 'کارت زرد',
                'Red Cards'            => 'کارت قرمز',
                'Passes %'             => 'پاس دقیق',
                'Total passes'         => 'کل پاس‌ها',
                'Goalkeeper Saves'     => 'مهار دروازه‌بان',
            ];
            $homeStats = $raw[0]['statistics'];
            $awayStats = $raw[1]['statistics'];

            foreach ($homeStats as $i => $s) {
                $type = isset($s['type']) ? $s['type'] : '';
                if (!isset($labels[$type])) {
                    continue;
                }
                $stats[] = [
                    'label' => $labels[$type],
                    'home'  => $s['value'] === null ? '0' : (string) $s['value'],
                    'away'  => (isset($awayStats[$i]['value']) && $awayStats[$i]['value'] !== null)
                                ? (string) $awayStats[$i]['value'] : '0',
                ];
            }
        }
        $match['stats'] = $stats;

        // ترکیب
        $lineups = [];
        $raw     = isset($row['lineups']) ? $row['lineups'] : [];
        foreach ($raw as $i => $l) {
            $side  = (isset($l['team']['id']) && (int) $l['team']['id'] === $homeId) ? 'home' : 'away';
            $start = [];
            foreach ((isset($l['startXI']) ? $l['startXI'] : []) as $p) {
                $start[] = [
                    'number' => isset($p['player']['number']) ? $p['player']['number'] : '',
                    'name'   => isset($p['player']['name']) ? $p['player']['name'] : '',
                ];
            }
            $bench = [];
            foreach ((isset($l['substitutes']) ? $l['substitutes'] : []) as $p) {
                $bench[] = [
                    'number' => isset($p['player']['number']) ? $p['player']['number'] : '',
                    'name'   => isset($p['player']['name']) ? $p['player']['name'] : '',
                ];
            }
            $lineups[$side] = [
                'team'      => isset($l['team']['name']) ? $l['team']['name'] : '',
                'formation' => isset($l['formation']) ? $l['formation'] : '',
                'coach'     => isset($l['coach']['name']) ? $l['coach']['name'] : '',
                'start'     => $start,
                'bench'     => $bench,
            ];
        }
        $match['lineups'] = $lineups;
        $match['referee'] = isset($row['fixture']['referee']) ? $row['fixture']['referee'] : '';

        return $match;
    }

    public function standings($leagueId, $season)
    {
        $rows = $this->call('standings', ['league' => $leagueId, 'season' => $season]);
        if (empty($rows[0]['league'])) {
            return null;
        }
        $lg = $rows[0]['league'];

        // ساختار standings تو در تو است (گروه‌ها)؛ گروه اول را می‌گیریم
        $table = isset($lg['standings'][0]) ? $lg['standings'][0] : [];

        $out = [];
        foreach ($table as $r) {
            $all = isset($r['all']) ? $r['all'] : [];
            $out[] = [
                'rank'   => isset($r['rank']) ? (int) $r['rank'] : 0,
                'team'   => $this->mapTeam(isset($r['team']) ? $r['team'] : []),
                'played' => isset($all['played']) ? (int) $all['played'] : 0,
                'win'    => isset($all['win']) ? (int) $all['win'] : 0,
                'draw'   => isset($all['draw']) ? (int) $all['draw'] : 0,
                'lose'   => isset($all['lose']) ? (int) $all['lose'] : 0,
                'gf'     => isset($all['goals']['for']) ? (int) $all['goals']['for'] : 0,
                'ga'     => isset($all['goals']['against']) ? (int) $all['goals']['against'] : 0,
                'gd'     => isset($r['goalsDiff']) ? (int) $r['goalsDiff'] : 0,
                'points' => isset($r['points']) ? (int) $r['points'] : 0,
                'form'   => isset($r['form']) ? $r['form'] : '',
            ];
        }

        return [
            'league' => [
                'id'      => isset($lg['id']) ? (int) $lg['id'] : 0,
                'name'    => isset($lg['name']) ? $lg['name'] : '',
                'country' => isset($lg['country']) ? $lg['country'] : '',
                'flag'    => isset($lg['flag']) ? $lg['flag'] : '',
                'logo'    => isset($lg['logo']) ? $lg['logo'] : '',
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
            $rows = $this->call('leagues', ['id' => $id]);
            if (empty($rows[0]['league'])) {
                continue;
            }
            $lg = $rows[0]['league'];
            $co = isset($rows[0]['country']) ? $rows[0]['country'] : [];
            $out[] = [
                'id'       => (int) $lg['id'],
                'name'     => isset($lg['name']) ? $lg['name'] : '',
                'country'  => isset($co['name']) ? $co['name'] : '',
                'flag'     => isset($co['flag']) ? $co['flag'] : '',
                'logo'     => isset($lg['logo']) ? $lg['logo'] : '',
                'priority' => $this->leaguePriority($lg['id']),
            ];
        }
        return $out;
    }
}
