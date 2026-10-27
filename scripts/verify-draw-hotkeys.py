"""Verify custom Draw modifiers and capture review evidence in Chromium.

Run: python scripts/verify-draw-hotkeys.py http://127.0.0.1:3025/
Ctrl workflows run on Linux. Meta/Option behavior is explicitly emulated; this
does not claim a native macOS browser run.
"""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/draw-hotkeys'
OUTPUT.mkdir(parents=True, exist_ok=True)
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3025/'
DRAFT = 'flowchart-editor-draft-v3'


def element(identifier, kind, x, y, width, height, **properties):
    return dict(id=identifier, type=kind, x=x, y=y, width=width,
                height=height, angle=0, strokeColor='#087f5b',
                backgroundColor='transparent', strokeWidth=2, opacity=100,
                groupIds=[], **properties)


def text(identifier, value, x, y, width=340, **properties):
    appearance = dict(text=value, originalText=value, fontSize=22, fontFamily=2)
    appearance.update(properties)
    return element(identifier, 'text', x, y, width, 30, **appearance)


def initial_document():
    first = element('group-one', 'rectangle', 100, 180, 210, 120)
    second = element('group-two', 'rectangle', 410, 180, 210, 120)
    first.update(backgroundColor='#d3f9e8', groupIds=['services'])
    second.update(backgroundColor='#d0ebff', groupIds=['services'])
    return {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
            'architectureScene': {'version': 1, 'files': {}, 'elements': [
                text('title', 'Keep your drawing muscle memory', 100, 30, 780, fontSize=32),
                text('subtitle', 'Centered shapes · deep selection · editable connectors', 100, 80, 850, fontSize=18),
                first, second,
                text('group-caption', 'One visual group. Select just the part you need.', 100, 330, 760, fontSize=18),
                text('center-caption', 'Alt / Option + drag', 760, 180, 380),
            ], 'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}}}


def document(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "{}")', DRAFT)


def saved(page, predicate):
    page.wait_for_function('(args) => { const doc=JSON.parse(localStorage.getItem(args.key)||"{}"); return (' + predicate + ')(doc); }', arg={'key': DRAFT})
    return document(page)


def screen(page, x, y):
    return page.locator('[data-draw-viewport]').evaluate(
        '(layer,p) => { const point=new DOMPoint(p.x,p.y).matrixTransform(layer.getScreenCTM()); return {x:point.x,y:point.y}; }', {'x': x, 'y': y})


def click_world(page, x, y):
    p = screen(page, x, y)
    page.mouse.click(p['x'], p['y'])


def drag_world(page, start, end):
    a, b = screen(page, *start), screen(page, *end)
    page.mouse.move(a['x'], a['y'])
    page.mouse.down()
    page.mouse.move(b['x'], b['y'], steps=12)
    page.mouse.up()


def import_document(page, payload, filename='keyboard-workflow.json'):
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files({
        'name': filename, 'mimeType': 'application/json', 'buffer': json.dumps(payload).encode()})
    if filename.endswith('.excalidraw'):
        page.get_by_role('button', name='Open as new diagram').click()
    page.get_by_test_id('draw-surface').wait_for()
    page.wait_for_timeout(650)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1680, 'height': 1120}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(ORIGIN, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you', exact=True)
    if dismiss.count():
        dismiss.click()
    import_document(page, initial_document())
    # Camera framing leaves every gesture clear of the contextual properties.
    page.mouse.move(1400, 850)
    page.mouse.down(button='right')
    page.mouse.move(1580, 730, steps=8)
    page.mouse.up(button='right')
    canvas = page.get_by_role('region', name='Draw canvas', exact=True)
    canvas.focus()

    # A real Alt+drag is symmetric about the initial pointer position.
    page.keyboard.press('o')
    page.keyboard.down('Alt')
    drag_world(page, (900, 290), (1000, 360))
    page.keyboard.up('Alt')
    current = saved(page, 'doc => doc.architectureScene?.elements.some(e => e.type==="ellipse")')
    ellipse = next(item for item in current['architectureScene']['elements'] if item['type'] == 'ellipse')
    assert abs(ellipse['x'] - 800) < 1 and abs(ellipse['y'] - 220) < 1, ellipse
    assert abs(ellipse['width'] - 200) < 1 and abs(ellipse['height'] - 140) < 1, ellipse
    page.get_by_label('Background color', exact=True).fill('#e5dbff')
    page.screenshot(path=str(OUTPUT / '01-centered-drawing.png'), full_page=True)

    # Ctrl marquee skips group expansion; nudge changes only the enclosed part.
    canvas.focus()
    page.keyboard.press('Escape')
    page.keyboard.down('Control')
    drag_world(page, (90, 170), (320, 310))
    page.keyboard.up('Control')
    page.get_by_text('1 selected', exact=True).wait_for()
    page.keyboard.press('Shift+ArrowRight')
    current = saved(page, 'doc => doc.architectureScene?.elements.find(e=>e.id==="group-one")?.x===105')
    assert next(item for item in current['architectureScene']['elements'] if item['id'] == 'group-two')['x'] == 410
    page.screenshot(path=str(OUTPUT / '02-deep-group-selection.png'), full_page=True)
    page.keyboard.press('Control+z')
    saved(page, 'doc => doc.architectureScene?.elements.find(e=>e.id==="group-one")?.x===100')

    # A click-click-click creates a path; Enter commits it once and undo restores
    # the whole previous document. Text shortcuts are checked against real typing.
    canvas.focus()
    page.keyboard.press('Escape')
    page.keyboard.press('a')
    for point in [(150, 480), (340, 420), (530, 480)]:
        click_world(page, *point)
    page.keyboard.press('Enter')
    current = saved(page, 'doc => doc.architectureScene?.elements.some(e=>e.type==="arrow")')
    arrow = next(item for item in current['architectureScene']['elements'] if item['type'] == 'arrow')
    assert len(arrow['points']) == 3, arrow
    original_points = arrow['points']
    page.keyboard.press('Control+z')
    saved(page, 'doc => !doc.architectureScene?.elements.some(e=>e.type==="arrow")')
    page.keyboard.press('Control+Shift+z')
    saved(page, 'doc => doc.architectureScene?.elements.some(e=>e.type==="arrow")')
    page.screenshot(path=str(OUTPUT / '03-multipoint-connector.png'), full_page=True)

    page.keyboard.press('t')
    click_world(page, 100, 580)
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    editor.fill('Rectangle hotkey r stays text')
    editor.press('Enter')
    editor.type('A second line')
    editor.press('Meta+Enter')
    current = saved(page, 'doc => doc.architectureScene?.elements.some(e=>e.type==="text"&&e.text?.includes("A second line"))')
    annotation = next(item for item in current['architectureScene']['elements'] if item.get('text', '').startswith('Rectangle hotkey'))
    assert '\n' in annotation['text'], annotation

    # Emulate actual Option-produced key values instead of sending plain ASCII.
    canvas.focus()
    canvas.dispatch_event('keydown', {'key': 'ß', 'code': 'KeyS', 'altKey': True, 'bubbles': True})
    assert page.get_by_role('button', name='Snap to objects', exact=True).get_attribute('aria-pressed') == 'true'
    page.reload(wait_until='networkidle')
    page.get_by_test_id('draw-surface').wait_for()
    assert next(item for item in document(page)['architectureScene']['elements'] if item['type'] == 'arrow')['points'] == original_points
    page.get_by_role('button', name='Architecture Mode', exact=True).click()
    page.locator('.react-flow').wait_for()
    assert page.get_by_test_id('draw-surface').count() == 0
    page.get_by_role('button', name='Draw Mode', exact=True).click()
    page.get_by_test_id('draw-surface').wait_for()

    # Existing imported bound connector: Meta+Enter enters point mode, moving an
    # interior point keeps endpoint bindings and its attached label intact.
    fixture = json.loads((ROOT / 'src/test/fixtures/excalidraw/architecture-complete.excalidraw').read_text())
    import_document(page, fixture, 'bound-architecture.excalidraw')
    canvas = page.get_by_role('region', name='Draw canvas', exact=True)
    imported = saved(page, 'doc => doc.architectureScene?.elements.some(e=>e.type==="frame")')
    imported_arrow = next(item for item in imported['architectureScene']['elements'] if item['type'] == 'arrow')
    path_position = page.locator('[data-element-id="' + imported_arrow['id'] + '"] path[pointer-events="stroke"]').first.evaluate(
        '(path) => { const point=path.getPointAtLength(path.getTotalLength()*0.3).matrixTransform(path.getScreenCTM()); return {x:point.x,y:point.y}; }')
    page.keyboard.down('Meta')
    page.mouse.click(path_position['x'], path_position['y'])
    page.keyboard.up('Meta')
    canvas.focus()
    page.keyboard.press('Meta+Enter')
    page.get_by_text('Editing connector points', exact=True).wait_for()
    midpoint = page.get_by_role('button', name='Edit path point 2', exact=True)
    midpoint.focus()
    midpoint.press('Shift+ArrowUp')
    page.wait_for_function('({key,id,points})=>JSON.stringify(JSON.parse(localStorage.getItem(key)||"{}").architectureScene?.elements.find(e=>e.id===id)?.points)!==JSON.stringify(points)', arg={'key': DRAFT, 'id': imported_arrow['id'], 'points': imported_arrow['points']})
    current = document(page)
    edited = next(item for item in current['architectureScene']['elements'] if item['id'] == imported_arrow['id'])
    assert edited['startBinding'] == imported_arrow['startBinding']
    assert edited['endBinding'] == imported_arrow['endBinding']
    assert next(item for item in current['architectureScene']['elements'] if item.get('text') == 'HTTPS')['containerId'] == imported_arrow['id']
    page.screenshot(path=str(OUTPUT / '04-imported-connector-points.png'), full_page=True)
    page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
    page.screenshot(path=str(OUTPUT / '05-connector-points-light.png'), full_page=True)
    canvas.focus()
    page.keyboard.press('Escape')
    assert page.get_by_text('Editing connector points', exact=True).count() == 0

    assert not errors, errors
    print('Verified Linux Ctrl workflow and emulated macOS Meta/Option events, multiline text, one-transaction path creation, imported bindings, local reload, and Architecture/Draw switching.')
    print('No browser runtime errors. Five screenshots saved in docs/screenshots/draw-hotkeys/.')
    browser.close()
