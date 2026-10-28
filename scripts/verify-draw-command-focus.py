import json
import sys

from playwright.sync_api import sync_playwright


URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3036/'
KEY = 'flowchart-editor-draft-v3'
ELEMENT = dict(id='box', type='rectangle', x=180, y=200, width=230, height=120,
               angle=0, strokeColor='#087f5b', backgroundColor='#d3f9e8',
               strokeWidth=2, opacity=100, groupIds=[])
DOCUMENT = dict(version=4, mode='draw', nodes=[], edges=[], architectureScene=dict(
    version=1, files={}, elements=[ELEMENT],
    appState=dict(viewBackgroundColor='#ffffff', gridSize=20)))


def stored(page):
    return json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY))['architectureScene']['elements']


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport=dict(width=1600, height=1000))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='networkidle')
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').first.set_input_files(dict(
        name='focus.json', mimeType='application/json', buffer=json.dumps(DOCUMENT).encode()))
    page.get_by_test_id('draw-surface').wait_for()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 1', arg=KEY)
    canvas = page.get_by_role('region', name='Draw canvas', exact=True)
    canvas.focus()

    page.keyboard.press('Control+/')
    palette = page.get_by_role('dialog', name='Drawing commands')
    palette.get_by_role('textbox', name='Search commands').fill('view')
    page.keyboard.press('Enter')
    assert page.get_by_text('View mode · Alt/Option R to edit').is_visible()
    assert canvas.evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Alt+r')
    assert page.get_by_text('View mode · Alt/Option R to edit').count() == 0

    page.keyboard.press('Control+f')
    search = page.get_by_role('dialog', name='Find in drawing')
    search.get_by_role('textbox', name='Search drawing').fill('box')
    search.get_by_role('button', name='Close panel').click()
    assert canvas.evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Control+/')
    palette.get_by_role('textbox', name='Search commands').fill('stat')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Tab')
    assert palette.evaluate('(el) => el.contains(document.activeElement)')
    palette.get_by_role('button', name='Drawing statistics').click()
    statistics = page.get_by_role('dialog', name='Drawing statistics')
    statistics.wait_for()
    assert statistics.get_by_role('button', name='Close panel').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Tab')
    assert statistics.evaluate('(el) => el.contains(document.activeElement)')
    page.keyboard.press('Delete')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Control+x')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Enter')
    assert statistics.count() == 0
    assert canvas.evaluate('(el) => document.activeElement === el')
    page.get_by_role('button', name='Keyboard shortcuts').click()
    help_dialog = page.get_by_role('dialog', name='Drawing shortcuts')
    help_dialog.wait_for()
    page.keyboard.press('Delete')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Control+x')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Tab')
    assert help_dialog.get_by_role('button', name='Close keyboard shortcuts').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Escape')
    assert help_dialog.count() == 0 and canvas.evaluate('(el) => document.activeElement === el')

    shape = page.locator('[data-element-id="box"]')
    bounds = shape.bounding_box()
    page.mouse.click(bounds['x'] + bounds['width'] - 25, bounds['y'] + bounds['height'] / 2)
    canvas.focus()
    page.keyboard.press('Control+Delete')
    confirm = page.get_by_role('dialog', name='Clear the entire board?')
    confirm.wait_for()
    assert confirm.get_by_role('button', name='Cancel').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Tab')
    assert confirm.get_by_role('button', name='Clear board').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Delete')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Tab')
    assert confirm.get_by_role('button', name='Cancel').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Enter')
    assert confirm.count() == 0 and stored(page) == [ELEMENT]
    assert canvas.evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Control+Delete')
    confirm.get_by_role('button', name='Clear board').click()
    page.wait_for_function('(key) => !JSON.parse(localStorage.getItem(key)).architectureScene?.elements?.length', arg=KEY)
    page.keyboard.press('Control+z')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene?.elements?.length === 1', arg=KEY)
    assert stored(page) == [ELEMENT]
    clear_button = page.get_by_role('button', name='Clear All')
    clear_button.click()
    confirm.wait_for()
    assert confirm.get_by_role('button', name='Cancel').evaluate('(el) => document.activeElement === el')
    page.keyboard.press('Delete')
    assert stored(page) == [ELEMENT]
    page.keyboard.press('Escape')
    assert confirm.count() == 0 and clear_button.evaluate('(el) => document.activeElement === el')
    assert not errors, errors
    browser.close()
    print('PASS: command focus, modal keyboard isolation, clear cancel, and undo')
