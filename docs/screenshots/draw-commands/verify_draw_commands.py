import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


OUTPUT = Path(__file__).resolve().parent
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3031/'
STORAGE = 'flowchart-editor-draft-v3'


def shape(identifier, kind, x, y, width, height, **extra):
    value = dict(id=identifier, type=kind, x=x, y=y, width=width, height=height,
                 angle=0, strokeColor='#087f5b', backgroundColor='#d3f9e8',
                 strokeWidth=2, opacity=100, groupIds=[])
    value.update(extra)
    return value


def saved(page):
    return json.loads(page.evaluate('(key) => localStorage.getItem(key)', STORAGE))


def focus(page):
    page.get_by_role('region', name='Draw canvas', exact=True).focus()


def main():
    payload = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
               'architectureScene': {'version': 1, 'files': {},
                   'elements': [
                       shape('service', 'rectangle', 180, 200, 230, 120,
                             name='Service', text='Service'),
                       shape('note', 'text', 520, 200, 450, 48,
                             text='Find the release checklist',
                             originalText='Find the release checklist',
                             fontSize=28, fontFamily=2,
                             backgroundColor='transparent')],
                   'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}}}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(ORIGIN, wait_until='networkidle')
        page.get_by_role('button', name='Export', exact=True).click()
        page.get_by_label('Import JSON or Excalidraw file').first.set_input_files({
            'name': 'draw-commands.json', 'mimeType': 'application/json',
            'buffer': json.dumps(payload).encode()})
        page.get_by_test_id('draw-surface').wait_for()
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 2', arg=STORAGE)
        baseline = saved(page)['architectureScene']['elements']

        focus(page)
        page.keyboard.press('Control+/')
        palette = page.get_by_role('dialog', name='Drawing commands')
        palette.wait_for()
        palette.get_by_role('textbox', name='Search commands').fill('statistics')
        assert palette.get_by_role('button', name='Drawing statistics').count() == 1
        page.screenshot(path=str(OUTPUT / '01-command-palette.png'), full_page=True)
        palette.get_by_role('button', name='Drawing statistics').click()
        assert page.get_by_role('dialog', name='Drawing statistics').get_by_text('2 elements').is_visible()
        page.screenshot(path=str(OUTPUT / '02-statistics.png'), full_page=True)
        page.get_by_role('button', name='Close panel').click()
        page.get_by_role('button', name='Fit drawing').click()

        focus(page)
        page.keyboard.press('Control+f')
        search = page.get_by_role('textbox', name='Search drawing')
        search.fill('release checklist')
        assert page.get_by_role('status').inner_text() == '1 results'
        page.screenshot(path=str(OUTPUT / '03-search.png'), full_page=True)
        assert saved(page)['architectureScene']['elements'] == baseline
        page.get_by_role('button', name='Close panel').click()

        focus(page)
        page.keyboard.press('Alt+r')
        assert page.get_by_text('View mode · Alt/Option R to edit').is_visible()
        page.keyboard.press('Delete')
        assert saved(page)['architectureScene']['elements'] == baseline
        page.keyboard.press('Alt+r')
        assert page.get_by_text('View mode · Alt/Option R to edit').count() == 0

        element = page.locator('[data-element-id="service"]')
        bounds = element.bounding_box()
        page.mouse.click(bounds['x'] + bounds['width'] - 25, bounds['y'] + bounds['height'] / 2)
        focus(page)
        page.keyboard.press('Control+k')
        link = page.get_by_role('textbox', name='Element link')
        link.fill('javascript:alert(1)')
        page.get_by_role('button', name='Save link').click()
        assert page.get_by_role('alert').is_visible()
        assert saved(page)['architectureScene']['elements'] == baseline
        link.fill('https://example.com/release')
        assert page.get_by_role('link', name='Open link').get_attribute('rel') == 'noopener noreferrer'
        page.screenshot(path=str(OUTPUT / '04-link-editor.png'), full_page=True)
        page.get_by_role('button', name='Save link').click()
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements[0].link === "https://example.com/release"', arg=STORAGE)

        focus(page)
        page.keyboard.press('Alt+r')
        assert page.get_by_role('button', name='Clear All').count() == 0
        page.screenshot(path=str(OUTPUT / '05-view-mode.png'), full_page=True)
        focus(page)
        page.keyboard.press('Control+k')
        assert page.get_by_role('link', name='Open link').is_visible()
        assert page.get_by_role('button', name='Remove link').count() == 0
        page.get_by_role('button', name='Close panel').click()
        focus(page)
        page.keyboard.press('Alt+r')

        focus(page)
        page.keyboard.press('Control+Delete')
        confirm = page.get_by_role('dialog', name='Clear the entire board?')
        confirm.wait_for()
        confirm.get_by_role('button', name='Cancel').click()
        assert len(saved(page)['architectureScene']['elements']) == 2
        focus(page)
        page.keyboard.press('Control+Delete')
        page.get_by_role('dialog', name='Clear the entire board?').get_by_role('button', name='Clear board').click()
        page.wait_for_function('(key) => { const doc = JSON.parse(localStorage.getItem(key)); return !doc.nodes.length && !doc.edges.length && !doc.architectureScene?.elements?.length }', arg=STORAGE)
        focus(page)
        page.keyboard.press('Control+z')
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene?.elements?.length === 2', arg=STORAGE)
        focus(page)
        page.keyboard.press('Alt+r')
        focus(page)
        page.keyboard.press('Alt+r')
        assert page.get_by_role('dialog', name='Clear the entire board?').count() == 0
        assert not errors, errors
        print('Draw commands browser verification passed')
        browser.close()


if __name__ == '__main__':
    main()
