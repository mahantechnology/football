<?php
/**
 * MatchRooz — نقطه ورود API
 *
 * همه‌ی درخواست‌های فرانت‌اند از اینجا رد می‌شوند. وظیفه‌ی این فایل:
 *  ۱) پنهان نگه‌داشتن کلید API از مرورگر
 *  ۲) کش کردن پاسخ‌ها تا سهمیه‌ی سرویس هدر نرود
 *  ۳) یکسان‌سازی خروجی منابع مختلف
 */

// روی هاست اشتراکی خطاها نباید داخل JSON چاپ شوند
ini_set('display_errors', '0');
error_reporting(E_ALL);

require __DIR__ . '/lib/Cache.php';
require __DIR__ . '/lib/Http.php';
require __DIR__ . '/lib/Translator.php';
require __DIR__ . '/lib/Provider.php';
require __DIR__ . '/lib/DemoProvider.php';
require __DIR__ . '/lib/ApiFootballProvider.php';
require __DIR__ . '/lib/TheSportsDbProvider.php';

/** خطای قابل نمایش به کاربر */
class ApiException extends Exception {}

$config = require __DIR__ . '/config.php';

if (!empty($config['debug'])) {
    ini_set('display_errors', '1');
}

date_default_timezone_set(!empty($config['timezone']) ? $config['timezone'] : 'Asia/Tehran');

// ---------------------------------------------------------------
// هدرها
// ---------------------------------------------------------------
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, max-age=0');

$origins = isset($config['cors_origins']) ? $config['cors_origins'] : [];
if ($origins && isset($_SERVER['HTTP_ORIGIN']) && in_array($_SERVER['HTTP_ORIGIN'], $origins, true)) {
    header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    header('Vary: Origin');
}

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---------------------------------------------------------------
// کمکی‌ها
// ---------------------------------------------------------------

function respond(array $payload)
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ok($data, array $meta = [])
{
    respond([
        'ok'   => true,
        'data' => $data,
        'meta' => array_merge(['time' => time()], $meta),
    ]);
}

function fail($message, $data = null, array $meta = [])
{
    respond([
        'ok'    => false,
        'error' => $message,
        'data'  => $data,
        'meta'  => array_merge(['time' => time()], $meta),
    ]);
}

/** ورودی GET پاک‌سازی‌شده */
function q($name, $default = '')
{
    if (!isset($_GET[$name])) {
        return $default;
    }
    $v = $_GET[$name];
    if (!is_string($v)) {
        return $default;
    }
    return trim($v);
}

/** تاریخ معتبر YYYY-MM-DD یا امروز */
function safeDate($value)
{
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        $parts = explode('-', $value);
        if (checkdate((int) $parts[1], (int) $parts[2], (int) $parts[0])) {
            // محدودیت منطقی: یک سال عقب و جلو
            $ts = strtotime($value);
            if ($ts > strtotime('-1 year') && $ts < strtotime('+1 year')) {
                return $value;
            }
        }
    }
    return date('Y-m-d');
}

// ---------------------------------------------------------------
// راه‌اندازی منبع داده
// ---------------------------------------------------------------

$cache = new Cache($config['cache']['dir'], !empty($config['cache']['enabled']));
$cache->gc();

$providerName = isset($config['provider']) ? $config['provider'] : 'demo';
$fallbackNote = '';

switch ($providerName) {
    case 'apifootball':
        $provider = new ApiFootballProvider($config, $cache);
        // اگر کلید وارد نشده، به‌جای صفحه‌ی خالی، حالت نمایشی را نشان بده
        if (!$provider->isConfigured()) {
            $provider     = new DemoProvider($config, $cache);
            $providerName = 'demo';
            $fallbackNote = 'کلید API-Football وارد نشده؛ حالت نمایشی فعال است.';
        }
        break;
    case 'thesportsdb':
        $provider = new TheSportsDbProvider($config, $cache);
        break;
    case 'demo':
    default:
        $provider     = new DemoProvider($config, $cache);
        $providerName = 'demo';
        break;
}

$meta = ['provider' => $providerName];
if ($fallbackNote !== '') {
    $meta['note'] = $fallbackNote;
}

/**
 * اجرای یک عملیات با کش و بازگشت به نسخه‌ی قدیمی در صورت خطا.
 */
function cached(Cache $cache, $key, $ttl, callable $fn, array $meta)
{
    $entry = $cache->stale($key);

    if ($entry !== null && isset($entry['_exp']) && $entry['_exp'] > time()) {
        $meta['cached'] = true;
        ok($entry['data'], $meta);
    }

    try {
        $data = $fn();
    } catch (ApiException $e) {
        // سرویس در دسترس نیست: اگر نسخه‌ی قدیمی داریم، همان را بده
        if ($entry !== null && array_key_exists('data', $entry)) {
            $meta['cached']  = true;
            $meta['stale']   = true;
            $meta['warning'] = $e->getMessage();
            ok($entry['data'], $meta);
        }
        fail($e->getMessage(), null, $meta);
        return;
    } catch (Exception $e) {
        if ($entry !== null && array_key_exists('data', $entry)) {
            $meta['cached'] = true;
            $meta['stale']  = true;
            ok($entry['data'], $meta);
        }
        fail('خطای غیرمنتظره در سرور رخ داد.', null, $meta);
        return;
    }

    $cache->put($key, ['_exp' => time() + $ttl, 'data' => $data]);
    $meta['cached'] = false;
    ok($data, $meta);
}

// ---------------------------------------------------------------
// مسیرها
// ---------------------------------------------------------------

$action = q('action', 'matches');

switch ($action) {

    case 'health':
        ok([
            'status'      => 'ok',
            'provider'    => $providerName,
            'php'         => PHP_VERSION,
            'curl'        => function_exists('curl_init'),
            'url_fopen'   => (bool) ini_get('allow_url_fopen'),
            'cache_write' => is_writable($config['cache']['dir']),
            'timezone'    => date_default_timezone_get(),
            'server_date' => date('Y-m-d H:i:s'),
        ], $meta);
        break;

    case 'matches':
        $date  = safeDate(q('date', date('Y-m-d')));
        $isNow = ($date === date('Y-m-d'));
        $ttl   = $isNow ? (int) $config['cache']['live'] : (int) $config['cache']['other'];

        cached($cache, "matches|$providerName|$date", $ttl, function () use ($provider, $date) {
            return $provider->matches($date);
        }, $meta + ['date' => $date]);
        break;

    case 'match':
        $id = q('id');
        if ($id === '' || strlen($id) > 64) {
            fail('شناسه‌ی بازی نامعتبر است.', null, $meta);
        }
        cached($cache, "match|$providerName|$id", (int) $config['cache']['match'], function () use ($provider, $id) {
            $m = $provider->matchDetail($id);
            if ($m === null) {
                throw new ApiException('این بازی پیدا نشد.');
            }
            return $m;
        }, $meta);
        break;

    case 'standings':
        $league = (int) q('league', '0');
        $season = (int) q('season', (string) $config['season']);
        if ($league <= 0) {
            fail('شناسه‌ی لیگ نامعتبر است.', null, $meta);
        }
        cached($cache, "standings|$providerName|$league|$season", (int) $config['cache']['standings'],
            function () use ($provider, $league, $season) {
                $s = $provider->standings($league, $season);
                if ($s === null) {
                    throw new ApiException('جدول این لیگ در دسترس نیست.');
                }
                return $s;
            }, $meta);
        break;

    case 'leagues':
        cached($cache, "leagues|$providerName", (int) $config['cache']['leagues'], function () use ($provider) {
            return $provider->leagues();
        }, $meta);
        break;

    case 'h2h':
        $id = q('id');
        if ($id === '' || strlen($id) > 64) {
            fail('شناسه‌ی بازی نامعتبر است.', null, $meta);
        }
        cached($cache, "h2h|$providerName|$id", (int) $config['cache']['standings'],
            function () use ($provider, $id) {
                return $provider->headToHead($id);
            }, $meta);
        break;

    case 'scorers':
        $league = (int) q('league', '0');
        $season = (int) q('season', (string) $config['season']);
        if ($league <= 0) {
            fail('شناسه‌ی لیگ نامعتبر است.', null, $meta);
        }
        cached($cache, "scorers|$providerName|$league|$season", (int) $config['cache']['standings'],
            function () use ($provider, $league, $season) {
                return $provider->scorers($league, $season);
            }, $meta);
        break;

    case 'team':
        $id = q('id');
        if ($id === '' || strlen($id) > 64) {
            fail('شناسه‌ی تیم نامعتبر است.', null, $meta);
        }
        cached($cache, "team|$providerName|$id", (int) $config['cache']['today'],
            function () use ($provider, $id) {
                $t = $provider->teamProfile($id);
                if ($t === null) {
                    throw new ApiException('اطلاعات این تیم در دسترس نیست.');
                }
                return $t;
            }, $meta);
        break;

    default:
        fail('درخواست نامعتبر است.', null, $meta);
}
