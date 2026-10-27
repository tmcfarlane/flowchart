"""Capture the custom Draw UI through file import and real user gestures.

Run: python scripts/capture-draw-screenshots.py http://localhost:3015
Requires Playwright and Chromium. Writes docs/screenshots/draw-mode/.
"""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
out = root / 'docs/screenshots/draw-mode'
out.mkdir(parents=True, exist_ok=True)
origin = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3015'
source = Path('/workspace/scratch/excalidraw-review/existing-architecture.json')
if source.exists():
    example = json.loads(source.read_text())
else:
    example = {'version': 2, 'mode': 'architecture', 'nodes': [
        {'id': 'api', 'type': 'service', 'position': {'x': 70, 'y': 100}, 'data': {'label': 'Order API'}},
        {'id': 'db', 'type': 'database', 'position': {'x': 400, 'y': 100}, 'data': {'label': 'Orders database'}},
        {'id': 'queue', 'type': 'queue', 'position': {'x': 70, 'y': 330}, 'data': {'label': 'Fulfillment events'}},
        {'id': 'worker', 'type': 'service', 'position': {'x': 400, 'y': 330}, 'data': {'label': 'Shipping worker'}},
    ], 'edges': [
        {'id': 'api-db', 'source': 'api', 'target': 'db', 'sourceHandle': 'right', 'targetHandle': 'left', 'label': 'SQL', 'data': {'protocol': 'SQL'}},
        {'id': 'api-queue', 'source': 'api', 'target': 'queue', 'label': 'Order placed', 'data': {'protocol': 'event', 'commStyle': 'async'}},
        {'id': 'queue-worker', 'source': 'queue', 'target': 'worker', 'sourceHandle': 'right', 'targetHandle': 'left', 'label': 'Subscribe'},
    ]}
# Older examples used "editable" before the shared default-edge registry.
for edge in example['edges']:
    edge['type'] = 'default'
fixture = Path(tempfile.gettempdir()) / 'flowchart-draw-screenshot-example.json'
fixture.write_text(json.dumps(example))

with sync_playwright() as p:
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1680, 'height': 1120}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(origin, wait_until='networkidle')
    page.get_by_role('button', name='No, thank you', exact=True).click()
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON file').set_input_files(str(fixture))
    page.get_by_role('button', name='Architecture Mode', exact=True).wait_for()
    page.locator('.react-flow__node').first.wait_for()
    page.wait_for_timeout(650)
    page.screenshot(path=str(out / '01-architecture-original.png'), full_page=True)

    page.get_by_role('button', name='Draw Mode', exact=True).click()
    page.get_by_test_id('draw-surface').wait_for()
    page.wait_for_timeout(350)
    for _ in range(2):
        page.get_by_role('button', name='Zoom out', exact=True).click()

    def screen(x, y):
        return page.locator('[data-draw-viewport]').evaluate('(element, point) => { const p = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM()); return {x:p.x,y:p.y}; }', {'x': x, 'y': y})

    def click_world(x, y):
        point = screen(x, y)
        page.mouse.click(point['x'], point['y'])

    def gesture(tool, start, end):
        page.get_by_role('button', name=f'{tool} tool', exact=True).click()
        a, b = screen(*start), screen(*end)
        page.mouse.move(a['x'], a['y'])
        page.mouse.down()
        page.mouse.move(b['x'], b['y'], steps=15)
        page.mouse.up()

    def finish_text(text):
        editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
        editor.wait_for(state='visible')
        editor.fill(text)
        editor.press('Control+Enter')
        editor.wait_for(state='hidden')

    def label_selection(text):
        page.locator('[aria-label="Draw canvas"]').focus()
        page.keyboard.press('Enter')
        finish_text(text)

    gesture('Ellipse', (720, 160), (920, 280))
    label_selection('External partner')
    gesture('Arrow', (580, 145), (720, 220))
    label_selection('HTTPS')
    gesture('Rectangle', (720, 390), (960, 490))
    label_selection('Review boundary')
    page.get_by_role('button', name='Text tool', exact=True).click()
    click_world(60, -30)
    finish_text('A clearer picture of your system')
    page.get_by_role('button', name='Text tool', exact=True).click()
    click_world(90, 550)
    finish_text('Sketch the idea. Keep every detail.')
    page.get_by_role('button', name='Pen tool', exact=True).click()
    points = [(90, 500), (120, 480), (160, 505), (200, 480), (240, 505), (280, 480), (320, 500)]
    first = screen(*points[0])
    page.mouse.move(first['x'], first['y']); page.mouse.down()
    for xy in points[1:]:
        position = screen(*xy)
        page.mouse.move(position['x'], position['y'], steps=5)
    page.mouse.up()
    page.get_by_role('button', name='Selection tool', exact=True).click()
    click_world(1040, 580)
    page.get_by_role('button', name='Fit drawing', exact=True).click()
    # Pan slightly so the left properties panel leaves the complete diagram clear.
    page.get_by_role('button', name='Hand tool', exact=True).click()
    page.mouse.move(1300, 850); page.mouse.down(); page.mouse.move(1430, 850, steps=10); page.mouse.up()
    page.get_by_role('button', name='Selection tool', exact=True).click()
    page.wait_for_timeout(350)
    page.screenshot(path=str(out / '02-draw-dark.png'), full_page=True)
    page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(out / '03-draw-light.png'), full_page=True)

    click_world(720, 440)
    page.get_by_label('Background color', exact=True).fill('#d3f9e8')
    page.get_by_label('Roughness', exact=True).select_option('1')
    page.get_by_label('Stroke style', exact=True).select_option('dashed')
    rotation = page.get_by_label('Rotation', exact=True)
    rotation.fill('12'); rotation.press('Tab')
    page.wait_for_timeout(250)
    page.screenshot(path=str(out / '04-draw-properties.png'), full_page=True)

    # Save two semantic objects plus their internal bound connector as a component.
    page.get_by_role('button', name='Selection tool', exact=True).click()
    click_world(160, 100)
    page.keyboard.down('Shift'); click_world(490, 100); page.keyboard.up('Shift')
    page.get_by_role('button', name='Components', exact=True).click()
    page.get_by_role('textbox', name='Component name', exact=True).fill('API + datastore')
    page.get_by_role('button', name='Save selection', exact=False).click()
    page.get_by_role('button', name='Insert API + datastore', exact=True).wait_for()
    page.wait_for_timeout(200)
    page.screenshot(path=str(out / '05-draw-components.png'), full_page=True)
    page.get_by_role('button', name='Close components', exact=True).click()
    page.get_by_role('button', name='Keyboard shortcuts', exact=True).click()
    page.get_by_role('dialog', name='Drawing shortcuts').wait_for()
    page.screenshot(path=str(out / '06-draw-shortcuts.png'), full_page=True)
    assert not errors, errors
    print('Captured six product screenshots with no browser runtime errors.')
    for item in sorted(out.glob('*.png')):
        print(item.name, item.stat().st_size)
    browser.close()
