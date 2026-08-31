<?php
/**
 * کلاینت HTTP کوچک — اول cURL، در نبودش file_get_contents.
 * روی هاست‌هایی که allow_url_fopen بسته است هم کار می‌کند و بالعکس.
 */
class Http
{
    /**
     * @return array{status:int, body:string, error:string}
     */
    public static function get($url, array $headers = [], $timeout = 12)
    {
        if (function_exists('curl_init')) {
            return self::viaCurl($url, $headers, $timeout);
        }
        if (ini_get('allow_url_fopen')) {
            return self::viaStream($url, $headers, $timeout);
        }
        return ['status' => 0, 'body' => '', 'error' => 'روی این سرور نه cURL فعال است و نه allow_url_fopen'];
    }

    private static function viaCurl($url, array $headers, $timeout)
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_USERAGENT      => 'MatchRooz/1.0',
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING       => '',
        ]);
        $body   = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error  = curl_error($ch);
        curl_close($ch);

        return ['status' => $status, 'body' => (string) $body, 'error' => $error];
    }

    private static function viaStream($url, array $headers, $timeout)
    {
        $ctx = stream_context_create([
            'http' => [
                'method'        => 'GET',
                'header'        => implode("\r\n", array_merge($headers, ['User-Agent: MatchRooz/1.0'])),
                'timeout'       => $timeout,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);

        $body   = @file_get_contents($url, false, $ctx);
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }
        return [
            'status' => $status,
            'body'   => (string) $body,
            'error'  => $body === false ? 'درخواست ناموفق بود' : '',
        ];
    }
}
