from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:3000")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    page.locator(".navbar").screenshot(path="scripts/navbar_bigger.png")
    rect = page.locator(".bot-selector-btn").bounding_box()
    print("bot-selector-btn bbox:", rect)
    browser.close()
