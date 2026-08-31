<?php
/**
 * کش فایل‌محور — روی هاست‌های اشتراکی cPanel بدون نیاز به دیتابیس کار می‌کند.
 */
class Cache
{
    private $dir;
    private $enabled;

    public function __construct($dir, $enabled = true)
    {
        $this->dir     = rtrim($dir, '/');
        $this->enabled = $enabled;

        if ($this->enabled && !is_dir($this->dir)) {
            @mkdir($this->dir, 0755, true);
        }
        // اگر پوشه قابل نوشتن نبود، کش را بی‌صدا غیرفعال کن
        if ($this->enabled && !is_writable($this->dir)) {
            $this->enabled = false;
        }
    }

    private function path($key)
    {
        return $this->dir . '/' . sha1($key) . '.json';
    }

    /** مقدار کش‌شده یا null */
    public function get($key, $ttl)
    {
        if (!$this->enabled || $ttl <= 0) {
            return null;
        }
        $file = $this->path($key);
        if (!is_file($file)) {
            return null;
        }
        if ((time() - filemtime($file)) > $ttl) {
            return null;
        }
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    public function put($key, array $value)
    {
        if (!$this->enabled) {
            return;
        }
        $file = $this->path($key);
        // نوشتن اتمیک تا درخواست هم‌زمان فایل نیمه‌کاره نخواند
        $tmp = $file . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, json_encode($value, JSON_UNESCAPED_UNICODE)) !== false) {
            @rename($tmp, $file);
        } else {
            @unlink($tmp);
        }
    }

    /**
     * آخرین نسخه‌ی کش‌شده بدون توجه به انقضا.
     * وقتی سرویس بیرونی از دسترس خارج می‌شود، سایت خالی نمی‌ماند.
     */
    public function stale($key)
    {
        if (!$this->enabled) {
            return null;
        }
        $file = $this->path($key);
        if (!is_file($file)) {
            return null;
        }
        $data = json_decode((string) @file_get_contents($file), true);
        return is_array($data) ? $data : null;
    }

    /** پاک‌سازی فایل‌های قدیمی‌تر از یک روز */
    public function gc($maxAge = 86400)
    {
        if (!$this->enabled) {
            return;
        }
        // فقط گاهی اجرا شود تا هر درخواست هزینه‌ی I/O ندهد
        if (mt_rand(1, 50) !== 1) {
            return;
        }
        foreach ((array) glob($this->dir . '/*.json') as $f) {
            if ((time() - filemtime($f)) > $maxAge) {
                @unlink($f);
            }
        }
    }
}
