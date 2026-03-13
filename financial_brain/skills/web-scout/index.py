#!/usr/bin/env python3
"""
Web Scout Skill - Headless browser reconnaissance
"""
import sys
import json
import time
import os
from typing import Dict, Any

def log(msg):
    print(msg, file=sys.stderr)

def main():
    # Parse arguments from environment or stdin
    params = {}
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            k, v = line.strip().split('=', 1)
            params[k] = v
        except Exception:
            continue

    url = params.get('url', '').strip()
    wait_ms = int(params.get('waitMs', 3000))
    capture_requests = params.get('captureRequests', 'true').lower() == 'true'
    capture_console = params.get('captureConsole', 'false').lower() == 'true'
    user_agent = params.get('userAgent', '')

    if not url:
        log("ERROR: 'url' parameter is required")
        sys.exit(1)

    # Try to use Playwright
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        log("ERROR: Playwright not installed. Run: python3 -m pip install playwright && python3 -m playwright install chromium")
        sys.exit(1)

    result = {
        "content": "",
        "requests": [],
        "consoleLogs": []
    }

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=user_agent or "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

            if capture_requests:
                context.on("request", lambda request: result["requests"].append({
                    "method": request.method,
                    "url": request.url
                }))
                context.on("response", lambda response: None)  # placeholder for status later

            page = context.new_page()

            if capture_console:
                page.on("console", lambda msg: result["consoleLogs"].append(msg.text))

            log(f"[WebScout] Navigating to {url}")
            page.goto(url, timeout=60000)
            log(f"[WebScout] Waiting {wait_ms}ms...")
            page.wait_for_timeout(wait_ms)

            # Capture content
            html = page.content()
            result["content"] = html[:5000] + ("..." if len(html) > 5000 else "")

            # Re-scan requests to add status codes (need to await responses)
            # Simple approach: we can't easily get status in sync API without hijacking responses
            # We'll just keep method+url

            browser.close()
            log("[WebScout] Done")

    except Exception as e:
        log(f"ERROR: {e}")
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()