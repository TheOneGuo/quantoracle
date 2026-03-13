# Web Scout Skill

Scan webpages with headless Chromium to discover APIs and extract data.

## Usage

```bash
/skill web-scout url=https://example.com capture_requests=true
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| url | string | Yes | Target URL to visit |
| waitMs | number | No | Milliseconds to wait after load (default 3000) |
| captureRequests | boolean | No | Capture observed network requests (default true) |
| captureConsole | boolean | No | Capture console logs (default false) |
| userAgent | string | No | Custom user agent (default Chrome headless) |

## Output

Returns structured data:
- `content`: partial HTML (truncated to 5000 chars)
- `requests`: array of observed network requests (method, url, status)
- `consoleLogs`: array of console messages (if captureConsole=true)

## Notes

- Requires Playwright to be installed (`python3 -m pip install playwright && python3 -m playwright install chromium`)
- Respects robots.txt and rate limits; use responsibly.
- This skill helps discover hidden APIs; do not abuse target sites.

## Example

```json
{
  "content": "<!DOCTYPE html>...",
  "requests": [
    {"method": "GET", "url": "https://api.example.com/data", "status": 200}
  ],
  "consoleLogs": []
}
```