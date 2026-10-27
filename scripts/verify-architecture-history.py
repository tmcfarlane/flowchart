"""Real-browser regression for native movement history.

Run the app, then: python scripts/verify-architecture-history.py http://localhost:3004
Requires Python Playwright and Chromium (or CHROMIUM_EXECUTABLE).
"""
import os
import shutil
import sys
from playwright.sync_api import sync_playwright

origin = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3004'
executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin, wait_until='networkidle')
    page.get_by_role('button', name='Architecture Mode', exact=True).click()
    page.locator('.excalidraw canvas').first.wait_for()
    page.mouse.click(1000, 700)
    page.keyboard.press('r')
    page.mouse.move(400, 300)
    page.mouse.down()
    page.mouse.move(600, 430, steps=10)
    page.mouse.up()
    scene = "JSON.parse(localStorage.getItem('flowchart-editor-draft-v3') || '{}').architectureScene"
    rectangle = f"({scene})?.elements.find(e => e.type === 'rectangle' && !e.isDeleted)"
    page.wait_for_function(f'!!({rectangle})')
    before = page.evaluate(rectangle)

    def expect_position(x, y):
        page.wait_for_function(f'({rectangle})?.x === {x} && ({rectangle})?.y === {y}')

    page.keyboard.press('ArrowRight')
    expect_position(before['x'] + 1, before['y'])
    page.keyboard.press('Control+z')
    expect_position(before['x'], before['y'])
    page.keyboard.press('Control+Shift+z')
    expect_position(before['x'] + 1, before['y'])
    print('Native nudge undo/redo: PASS', flush=True)

    page.keyboard.press('Shift+ArrowUp')
    expect_position(before['x'] + 1, before['y'] - 5)
    page.keyboard.press('Control+z')
    expect_position(before['x'] + 1, before['y'])
    print('Shift nudge undo: PASS', flush=True)

    for _ in range(3):
        page.keyboard.down('ArrowRight')
    page.keyboard.up('ArrowRight')
    expect_position(before['x'] + 4, before['y'])
    page.keyboard.press('Control+z')
    expect_position(before['x'] + 1, before['y'])
    print('Held-key gesture is one undo step: PASS', flush=True)

    page.keyboard.press('v')
    page.mouse.move(before['x'] + 1, 350)
    page.mouse.down()
    page.mouse.move(before['x'] + 71, 380, steps=10)
    page.mouse.up()
    page.wait_for_function(f'({rectangle})?.x > {before["x"] + 20}')
    dragged = page.evaluate(rectangle)
    page.keyboard.press('Control+z')
    expect_position(before['x'] + 1, before['y'])
    page.keyboard.press('Control+Shift+z')
    expect_position(dragged['x'], dragged['y'])
    print('Mouse movement undo/redo: PASS', flush=True)

    page.get_by_role('button', name='Open AI Assistant', exact=True).click()
    prompt = page.get_by_placeholder('Describe any process, workflow, or plan...')
    prompt.fill('rdoapltqv123456780')
    prompt.press('ArrowLeft')
    prompt.press('ArrowRight')
    assert prompt.input_value() == 'rdoapltqv123456780'
    assert not errors, errors
    print('AI text entry unaffected; no browser errors: PASS', flush=True)
    browser.close()
