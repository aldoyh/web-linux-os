<?php
/**
 * ============================================================================
 *  Desktopy OS — Single-file PHP Backend
 * ============================================================================
 *  One PHP file powering every file-system / persistence feature of the OS:
 *
 *    • State persistence  — the entire desktop state (theme, language, open
 *      windows, window positions/sizes, minimized/maximized, z-order, notes,
 *      terminal history) survives reloads via `data/state.json`.
 *    • Sandboxed file system — `ls`, `read`, `write`, `mkdir`, `rm`, `mv`
 *      scoped to `data/` (the OS "disk"). The Files app and Terminal use it.
 *    • Disk stats — used by the desktop widgets.
 *
 *  Runs anywhere PHP runs:
 *    • `php -S localhost:3000 -t public`   (PHP built-in server — preferred)
 *    • `php-cgi`                           (classic CGI)
 *    • CLI mode — invoked by `serve.mjs`, which passes a JSON envelope as
 *      argv[1] ({ method, query, body }). Keeps the Node static server able
 *      to serve the whole app with a real PHP backend behind it.
 *
 *  Every response is JSON: { "ok": true|false, ... }.
 * ============================================================================
 */

declare(strict_types=1);

/* --------------------------------------------------------------------------
 * Bootstrap — detect how we were invoked and normalize request input.
 * ------------------------------------------------------------------------ */
if (PHP_SAPI === 'cli') {
    // Node (serve.mjs) hands us: argv[1] = JSON { method, query, body }
    $env = json_decode($_SERVER['argv'][1] ?? '{}', true);
    if (!is_array($env)) {
        $env = [];
    }
    $_SERVER['REQUEST_METHOD'] = strtoupper((string)($env['method'] ?? 'GET'));
    parse_str((string)($env['query'] ?? ''), $_GET);
    $GLOBALS['__RAW_BODY'] = (string)($env['body'] ?? '');
} else {
    // php -S / php-cgi: standard superglobals
    $GLOBALS['__RAW_BODY'] = (string)file_get_contents('php://input');
}

/**
 * Decoded JSON request body (POST).
 */
function request_body(): array
{
    $raw = $GLOBALS['__RAW_BODY'] ?? '';
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Send a JSON response and stop.
 */
function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400): void
{
    respond(['ok' => false, 'error' => $message], $status);
}

/* --------------------------------------------------------------------------
 * Paths & sandbox
 * ------------------------------------------------------------------------ */
$DATA_DIR = __DIR__ . '/data';
$STATE_FILE = $DATA_DIR . '/state.json';
$ROOT      = $DATA_DIR;          // sandbox root = the OS "disk"
$HOME      = $DATA_DIR . '/home'; // default working directory

/**
 * Resolve a user-supplied relative path inside the sandbox root.
 * Returns the absolute path or null when the path escapes the sandbox.
 */
function resolve_safe(string $relative): ?string
{
    global $ROOT;
    $relative = str_replace('\\', '/', $relative);
    $relative = trim($relative, '/');
    if ($relative === '') {
        $relative = 'home';
    }
    $candidate = $ROOT . '/' . $relative;

    // Real-path check: the resolved target must live inside the root.
    $realRoot = realpath($ROOT);
    $real = realpath($candidate);
    if ($real !== false) {
        if ($realRoot !== false && strpos($real, $realRoot . DIRECTORY_SEPARATOR) !== 0 && $real !== $realRoot) {
            return null;
        }
        return $real;
    }

    // Path doesn't exist yet (e.g. creating a file): walk up to the nearest
    // existing ancestor to validate it stays inside the sandbox.
    $ancestor = $candidate;
    while (!file_exists($ancestor) && dirname($ancestor) !== $ancestor) {
        $ancestor = dirname($ancestor);
    }
    $realAncestor = realpath($ancestor);
    if ($realRoot !== false && $realAncestor !== false
        && strpos($realAncestor, $realRoot . DIRECTORY_SEPARATOR) !== 0
        && $realAncestor !== $realRoot
    ) {
        return null;
    }
    if (strpos($relative, '..') !== false) {
        return null;
    }
    return $candidate;
}

/**
 * Relative path (for JSON responses) of an absolute path inside the root.
 */
function rel_path(string $absolute): string
{
    global $ROOT;
    $abs = str_replace(DIRECTORY_SEPARATOR, '/', realpath($absolute) ?: $absolute);
    $root = str_replace(DIRECTORY_SEPARATOR, '/', realpath($ROOT) ?: $ROOT);
    return ltrim(str_replace($root, '', $abs), '/');
}

/* --------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------ */
function default_state(): array
{
    return [
        'theme'    => 'dark',
        'lang'     => 'ar',
        'accent'   => 'indigo',
        'launcher' => false,
        'notes'    => '',
        'history'  => [],
        'zIndex'   => 100,
        'windows'  => [],
    ];
}

function load_state(): array
{
    global $STATE_FILE;
    if (!file_exists($STATE_FILE)) {
        return default_state();
    }
    $raw = file_get_contents($STATE_FILE);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) {
        return default_state();
    }
    return array_replace(default_state(), $data);
}

function save_state(array $data): bool
{
    global $STATE_FILE, $DATA_DIR;
    if (!is_dir($DATA_DIR) && !@mkdir($DATA_DIR, 0775, true)) {
        return false;
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    $tmp = $STATE_FILE . '.tmp';
    if (file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }
    return rename($tmp, $STATE_FILE);
}

/* --------------------------------------------------------------------------
 * First-run seed — a small starter home so the Files app demos nicely.
 * ------------------------------------------------------------------------ */
function seed_home(): void
{
    global $HOME;
    if (is_dir($HOME)) {
        return;
    }
    $seed = [
        'Documents/welcome.txt' => "مرحباً بك في Desktopy OS!\n\nهذه بيئة سطح مكتب تعمل في المتصفح،\nوملفاتك محفوظة عبر خلفية PHP الحقيقية.\n\nجرب: افتح تطبيق الملفات واستكشف مجلداتك.\n",
        'Documents/readme.txt'  => "Welcome to Desktopy OS!\n\nA browser-based desktop where every window,\nfile and setting persists through a single PHP backend.\n\nTry: open the Files app and explore your folders.\n",
        'Notes/ideas.txt'       => "Ideas\n-----\n- Build a web desktop\n- Persist windows through PHP ✓\n- Take screenshots for the README ✓\n",
        'hello.txt'             => "Hello! You are reading this through the PHP file-system backend.\n\nTry `cat hello.txt` in the Terminal, then edit and save from the Files app.\n",
    ];
    foreach ($seed as $rel => $content) {
        $abs = $HOME . '/' . $rel;
        if (!is_dir(dirname($abs))) {
            @mkdir(dirname($abs), 0775, true);
        }
        if (!file_exists($abs)) {
            @file_put_contents($abs, $content);
        }
    }
}

/* --------------------------------------------------------------------------
 * Router
 * ------------------------------------------------------------------------ */
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    respond(['ok' => true]);
}

$action = (string)($_GET['action'] ?? '');
if ($action === '') {
    respond([
        'ok'     => true,
        'service' => 'Desktopy OS PHP Backend',
        'version' => '1.0.0',
        'php'     => PHP_VERSION,
        'actions' => ['ping', 'state', 'reset', 'ls', 'read', 'write', 'mkdir', 'rm', 'mv', 'disk'],
    ]);
}

try {
    switch ($action) {
        /* -------------------------------------------------- ping --- */
        case 'ping':
            respond(['ok' => true, 'service' => 'Desktopy PHP Backend', 'php' => PHP_VERSION]);
            break;

        /* -------------------------------------------------- state --- */
        case 'state':
            if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
                $body = request_body();
                $incoming = $body['data'] ?? null;
                if (!is_array($incoming)) {
                    fail('Missing "data" object in POST body.');
                }
                $current = load_state();
                // The frontend always sends the complete desktop snapshot, so
                // replace whole keys — including the windows map, which lets an
                // empty windows:{} actually persist as "nothing open".
                $merged = array_replace($current, $incoming);
                if (!save_state($merged)) {
                    fail('Could not write state file.', 500);
                }
                respond(['ok' => true, 'data' => $merged]);
            }
            $fresh = !file_exists($STATE_FILE);
            respond(['ok' => true, 'fresh' => $fresh, 'data' => load_state()]);
            break;

        /* -------------------------------------------------- reset --- */
        case 'reset':
            // Wipe persisted state -> next boot is a "fresh" first run.
            if (file_exists($STATE_FILE)) {
                @unlink($STATE_FILE);
            }
            respond(['ok' => true, 'fresh' => true, 'data' => default_state()]);
            break;

        /* -------------------------------------------------- disk ---- */
        case 'disk':
            seed_home();
            $total = 0;
            $files = 0;
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($ROOT, FilesystemIterator::SKIP_DOTS)
            );
            foreach ($it as $f) {
                if ($f->isFile()) {
                    $total += $f->getSize();
                    $files++;
                }
            }
            respond([
                'ok'     => true,
                'total'  => $total,
                'files'  => $files,
                'root'   => rel_path($ROOT),
                'home'   => 'home',
            ]);
            break;

        /* -------------------------------------------------- ls ------ */
        case 'ls':
            seed_home();
            $path = (string)($_GET['path'] ?? 'home');
            $abs = resolve_safe($path);
            if ($abs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            if (!is_dir($abs)) {
                fail("Not a directory: {$path}", 404);
            }
            $entries = [];
            foreach (scandir($abs) ?: [] as $name) {
                if ($name === '.' || $name === '..') {
                    continue;
                }
                $full = $abs . '/' . $name;
                $isDir = is_dir($full);
                $entries[] = [
                    'name'  => $name,
                    'path'  => rel_path($full),
                    'type'  => $isDir ? 'dir' : 'file',
                    'size'  => $isDir ? null : (int)filesize($full),
                    'mtime' => filemtime($full) ?: null,
                ];
            }
            usort($entries, function ($a, $b) {
                if ($a['type'] !== $b['type']) {
                    return $a['type'] === 'dir' ? -1 : 1;
                }
                return strcasecmp($a['name'], $b['name']);
            });
            respond(['ok' => true, 'path' => rel_path($abs), 'entries' => $entries]);
            break;

        /* -------------------------------------------------- read ---- */
        case 'read':
            seed_home();
            $path = (string)($_GET['path'] ?? '');
            if ($path === '') {
                fail('Missing "path".');
            }
            $abs = resolve_safe($path);
            if ($abs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            if (!is_file($abs)) {
                fail("Not a file: {$path}", 404);
            }
            if (filesize($abs) > 2 * 1024 * 1024) {
                fail('File is too large to read (limit 2 MB).', 413);
            }
            respond(['ok' => true, 'path' => rel_path($abs), 'content' => (string)file_get_contents($abs)]);
            break;

        /* -------------------------------------------------- write --- */
        case 'write':
            $body = request_body();
            $path = (string)($body['path'] ?? $_GET['path'] ?? '');
            $content = (string)($body['content'] ?? '');
            if ($path === '') {
                fail('Missing "path".');
            }
            if ($path === 'state' || $path === 'state.json') {
                fail('state.json is managed by the state API.', 403);
            }
            $abs = resolve_safe($path);
            if ($abs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            $parent = dirname($abs);
            if (!is_dir($parent) && !@mkdir($parent, 0775, true)) {
                fail('Could not create parent directory.', 500);
            }
            if (strlen($content) > 2 * 1024 * 1024) {
                fail('Content too large (limit 2 MB).', 413);
            }
            if (file_put_contents($abs, $content, LOCK_EX) === false) {
                fail('Could not write file.', 500);
            }
            respond(['ok' => true, 'path' => rel_path($abs)]);
            break;

        /* -------------------------------------------------- mkdir --- */
        case 'mkdir':
            $body = request_body();
            $path = (string)($body['path'] ?? $_GET['path'] ?? '');
            if ($path === '') {
                fail('Missing "path".');
            }
            $abs = resolve_safe($path);
            if ($abs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            if (is_dir($abs)) {
                fail('Directory already exists.', 409);
            }
            if (!@mkdir($abs, 0775, true)) {
                fail('Could not create directory.', 500);
            }
            respond(['ok' => true, 'path' => rel_path($abs)]);
            break;

        /* -------------------------------------------------- rm ------ */
        case 'rm':
            $body = request_body();
            $path = (string)($body['path'] ?? $_GET['path'] ?? '');
            if ($path === '' || $path === 'home' || $path === '.' || $path === '/') {
                fail('Refusing to remove the home directory.');
            }
            if ($path === 'state' || $path === 'state.json') {
                fail('state.json is managed by the state API.', 403);
            }
            $abs = resolve_safe($path);
            if ($abs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            if (is_file($abs)) {
                if (!@unlink($abs)) {
                    fail('Could not delete file.', 500);
                }
                respond(['ok' => true]);
            }
            if (is_dir($abs)) {
                $items = array_diff(scandir($abs) ?: [], ['.', '..']);
                if ($items) {
                    fail('Directory is not empty.', 409);
                }
                if (!@rmdir($abs)) {
                    fail('Could not delete directory.', 500);
                }
                respond(['ok' => true]);
            }
            fail("Not found: {$path}", 404);
            break;

        /* -------------------------------------------------- mv ------ */
        case 'mv':
            $body = request_body();
            $path = (string)($body['path'] ?? $_GET['path'] ?? '');
            $dest = (string)($body['dest'] ?? $_GET['dest'] ?? '');
            if ($path === '' || $dest === '') {
                fail('Missing "path" or "dest".');
            }
            $abs = resolve_safe($path);
            $destAbs = resolve_safe($dest);
            if ($abs === null || $destAbs === null) {
                fail('Path escapes the sandbox.', 403);
            }
            if (!file_exists($abs)) {
                fail("Not found: {$path}", 404);
            }
            if (!@rename($abs, $destAbs)) {
                fail('Could not move/rename.', 500);
            }
            respond(['ok' => true, 'path' => rel_path($destAbs)]);
            break;

        /* -------------------------------------------------- default - */
        default:
            fail("Unknown action: {$action}", 404);
    }
} catch (Throwable $t) {
    fail('Internal error: ' . $t->getMessage(), 500);
}
