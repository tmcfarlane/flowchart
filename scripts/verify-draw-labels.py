"""Verify centered shape labels with native Chromium pointer sequences.

Run: python scripts/verify-draw-labels.py http://127.0.0.1:3026/
Captures review evidence in docs/screenshots/draw-labels/.
Use --expect-bug before the controller fix to capture the failing editor center.
"""
from pathlib import Path
import argparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DRAFT = 'flowchart-editor-draft-v3'
parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3026/')
parser.add_argument('--expect-bug', action='store_true')
args = parser.parse_args()
OUTPUT = Path('/tmp/draw-labels-before-fix') if args.expect_bug else ROOT / 'docs/screenshots/draw-labels'
OUTPUT.mkdir(parents=True, exist_ok=True)
CENTER_ERRORS = []


def document(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "{}")', DRAFT)


def saved(page, condition, **values):
    page.wait_for_function('args => { const doc=JSON.parse(localStorage.getItem(args.key)||"{}"); return (' + condition + ')(doc,args); }', arg={'key': DRAFT, **values})
    return document(page)


def elements(page):
    return [item for item in document(page)['architectureScene']['elements'] if not item.get('isDeleted')]


def by_id(page, identifier):
    return next(item for item in elements(page) if item['id'] == identifier)


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


def label_for(page, identifier):
    return [item for item in elements(page) if item.get('containerId') == identifier and item['type'] == 'text']


def centered_label(page, identifier):
    host = by_id(page, identifier)
    labels = label_for(page, identifier)
    assert len(labels) == 1, labels
    label = labels[0]
    assert abs(label['x'] + label['width'] / 2 - host['x'] - host['width'] / 2) < 0.1, (host, label)
    assert abs(label['y'] + label['height'] / 2 - host['y'] - host['height'] / 2) < 0.1, (host, label)
    assert abs(label.get('angle', 0) - host.get('angle', 0)) < 0.001, (host, label)
    return label


def assert_editor_center(page, identifier, editor):
    host = by_id(page, identifier)
    point = screen(page, host['x'] + host['width'] / 2, host['y'] + host['height'] / 2)
    rect = editor.bounding_box()
    assert rect is not None
    error = {'x': rect['x'] + rect['width'] / 2 - point['x'], 'y': rect['y'] + rect['height'] / 2 - point['y']}
    CENTER_ERRORS.append(error)
    assert abs(error['x']) <= 2 and abs(error['y']) <= 2, {'host': host, 'editor': rect, 'error': error}


def open_editor(page, identifier):
    host = by_id(page, identifier)
    previous_labels = label_for(page, identifier)
    point = screen(page, host['x'] + host['width'] / 2, host['y'] + host['height'] / 2)
    # This is the browser's native pointerdown/up/click/dblclick sequence. The
    # shape remains selected, so the selection overlay is present throughout.
    assert page.locator('.draw-selection').count() == 1
    page.mouse.dblclick(point['x'], point['y'], delay=90)
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    editor.wait_for(state='visible')
    assert editor.evaluate('(element) => element === document.activeElement')
    if previous_labels:
        label_svg = page.locator('[data-element-id="' + previous_labels[0]['id'] + '"]')
        label_svg.wait_for(state='hidden')
        assert label_svg.count() == 1
        assert label_svg.get_attribute('visibility') == 'hidden'
        for other in elements(page):
            if other['type'] == 'text' and other['id'] != previous_labels[0]['id']:
                assert page.locator('[data-element-id="' + other['id'] + '"]').is_visible()
    rect = editor.bounding_box()
    assert rect is not None
    error = {'x': rect['x'] + rect['width'] / 2 - point['x'], 'y': rect['y'] + rect['height'] / 2 - point['y']}
    if args.expect_bug:
        editor.fill('Centered shape label')
        page.screenshot(path=str(OUTPUT / 'before-centered-label.png'), full_page=True)
        print('EDITOR CENTER ERROR BEFORE FIX:', json.dumps(error), flush=True)
        assert max(abs(error['x']), abs(error['y'])) > 2, error
        return editor
    assert_editor_center(page, identifier, editor)
    return editor


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1680, 'height': 1120}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you', exact=True)
    if dismiss.count():
        dismiss.click()
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files({
        'name': 'centered-labels.json', 'mimeType': 'application/json', 'buffer': json.dumps({
            'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
            'architectureScene': {'version': 1, 'elements': [], 'files': {}, 'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}},
        }).encode()})
    page.get_by_test_id('draw-surface').wait_for()
    saved(page, 'doc => doc.mode === "draw" && doc.architectureScene?.elements.length === 0')
    canvas = page.get_by_role('region', name='Draw canvas', exact=True)
    assert page.get_by_role('button', name='Keep tool selected', exact=True).get_attribute('aria-pressed') == 'false'

    shapes = []
    for tool, bounds, color in [
        ('Rectangle', ((340, 260), (610, 430)), '#d0ebff'),
        ('Ellipse', ((720, 260), (990, 430)), '#d3f9d8'),
        ('Diamond', ((1100, 240), (1360, 450)), '#fff3bf'),
    ]:
        previous = {item['id'] for item in elements(page)}
        page.get_by_role('button', name=f'{tool} tool', exact=True).click()
        drag_world(page, *bounds)
        assert page.get_by_role('button', name='Selection tool', exact=True).get_attribute('aria-pressed') == 'true'
        current = saved(page, '(doc,args) => doc.architectureScene?.elements.filter(e => !e.isDeleted).length === args.count', count=len(previous) + 1)
        host = next(item for item in current['architectureScene']['elements'] if item['id'] not in previous and not item.get('isDeleted'))
        shapes.append(host['id'])
        page.get_by_label('Background color', exact=True).fill(color)
        saved(page, '(doc,args) => doc.architectureScene?.elements.find(e => e.id === args.id)?.backgroundColor === args.color', id=host['id'], color=color)

    # Every primitive opens a centered, focused editor even with its selection
    # overlay present. The rectangle also proves ordinary Enter remains a newline.
    for index, (identifier, value) in enumerate(zip(shapes, ['Orders API', 'Event stream', 'Route order'])):
        host = by_id(page, identifier)
        click_world(page, host['x'] + host['width'] / 2, host['y'] + host['height'] / 2)
        editor = open_editor(page, identifier)
        if args.expect_bug:
            browser.close()
            raise SystemExit(0)
        editor.fill(value)
        if index == 0:
            editor.press('Enter')
            editor.type('Main service')
            assert editor.input_value() == 'Orders API\nMain service'
        assert_editor_center(page, identifier, editor)
        if index == 2:
            page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
            # The theme button blurs and commits the existing editor; reopen it
            # with a real double click before capturing the light editing state.
            saved(page, '(doc,args) => doc.architectureScene?.elements.some(e => e.containerId === args.id)', id=identifier)
            click_world(page, host['x'] + 10, host['y'] + host['height'] / 2)
            editor = open_editor(page, identifier)
        page.screenshot(path=str(OUTPUT / ['01-rectangle-label-editor-dark.png', '02-ellipse-label-editor-dark.png', '03-diamond-label-editor-light.png'][index]), full_page=True)
        editor.press('Control+Enter')
        saved(page, '(doc,args) => doc.architectureScene?.elements.some(e => e.containerId === args.id)', id=identifier)
        label = centered_label(page, identifier)
        assert page.locator('[data-element-id="' + label['id'] + '"]').is_visible()
        if index == 0:
            original_id = label['id']
            canvas.focus()
            page.keyboard.press('Control+z')
            saved(page, '(doc,args) => !doc.architectureScene?.elements.some(e => !e.isDeleted && e.containerId === args.id)', id=identifier)
            assert by_id(page, identifier)['type'] == 'rectangle'
            page.keyboard.press('Control+Shift+z')
            saved(page, '(doc,args) => doc.architectureScene?.elements.some(e => !e.isDeleted && e.id === args.id)', id=original_id)
            assert centered_label(page, identifier)['id'] == original_id

    # A second native double-click edits the bound label, never creates a second
    # standalone text object. Clicking outside commits through normal blur.
    identifier = shapes[0]
    host = by_id(page, identifier)
    click_world(page, host['x'] + 15, host['y'] + 25)
    previous_id = centered_label(page, identifier)['id']
    editor = open_editor(page, identifier)
    assert editor.input_value() == 'Orders API\nMain service'
    editor.fill('Orders API\nLive service')
    click_world(page, 1500, 820)
    saved(page, '(doc,args) => doc.architectureScene?.elements.some(e => e.id === args.id && e.text === "Orders API\\nLive service")', id=previous_id)
    assert centered_label(page, identifier)['id'] == previous_id
    assert page.locator('[data-element-id="' + previous_id + '"]').is_visible()

    # Moving and resizing a host keeps the stored label centered and associated.
    host = by_id(page, identifier)
    drag_world(page, (host['x'] + 15, host['y'] + 25), (host['x'] + 85, host['y'] + 105))
    saved(page, '(doc,args) => doc.architectureScene?.elements.find(e=>e.id===args.id)?.x > args.x + 60', id=identifier, x=host['x'])
    centered_label(page, identifier)
    corner = page.get_by_label('Resize se', exact=True).bounding_box()
    assert corner is not None
    page.mouse.move(corner['x'] + corner['width'] / 2, corner['y'] + corner['height'] / 2)
    page.mouse.down()
    page.mouse.move(corner['x'] + corner['width'] / 2 + 80, corner['y'] + corner['height'] / 2 + 50, steps=10)
    page.mouse.up()
    saved(page, '(doc,args) => doc.architectureScene?.elements.find(e=>e.id===args.id)?.width > args.width + 60', id=identifier, width=host['width'])
    centered_label(page, identifier)

    # Q is opt-in. With Q enabled, repeated drawing keeps Rectangle; disabling it
    # restores the default switch back to Pointer. Undo removes just these probes.
    canvas.focus()
    page.keyboard.press('q')
    page.keyboard.press('r')
    drag_world(page, (750, 650), (900, 750))
    assert page.get_by_role('button', name='Rectangle tool', exact=True).get_attribute('aria-pressed') == 'true'
    saved(page, 'doc => doc.architectureScene?.elements.filter(e=>!e.isDeleted).length === 7')
    page.keyboard.press('q')
    drag_world(page, (1000, 650), (1150, 750))
    assert page.get_by_role('button', name='Selection tool', exact=True).get_attribute('aria-pressed') == 'true'
    saved(page, 'doc => doc.architectureScene?.elements.filter(e=>!e.isDeleted).length === 8')
    page.keyboard.press('Control+z')
    page.keyboard.press('Control+z')
    saved(page, 'doc => doc.architectureScene?.elements.filter(e=>!e.isDeleted).length === 6')
    page.wait_for_function('() => document.querySelectorAll("[data-draw-content] [data-element-id]").length === 6')
    page.screenshot(path=str(OUTPUT / '04-labeled-shapes-light.png'), full_page=True)

    # The editor remains centered after formatting, camera movement and rotation.
    host = by_id(page, identifier)
    click_world(page, host['x'] + 15, host['y'] + 25)
    page.get_by_label('Font size', exact=True).fill('32')
    page.get_by_label('Font family', exact=True).select_option('3')
    page.get_by_label('Rotation', exact=True).fill('25')
    saved(page, '(doc,args) => Math.abs(doc.architectureScene?.elements.find(e=>e.id===args.id)?.angle - 25*Math.PI/180)<0.001', id=identifier)
    centered_label(page, identifier)
    page.get_by_role('button', name='Zoom out', exact=True).click()
    page.mouse.move(1500, 900)
    page.mouse.down(button='right')
    page.mouse.move(1420, 850, steps=8)
    page.mouse.up(button='right')
    page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
    host = by_id(page, identifier)
    click_world(page, host['x'] + host['width'] / 2, host['y'] + host['height'] / 2)
    editor = open_editor(page, identifier)
    zoom = page.locator('[data-draw-viewport]').evaluate('(layer)=>layer.getCTM().a')
    actual_font = editor.evaluate('(element) => ({size:parseFloat(getComputedStyle(element).fontSize),family:getComputedStyle(element).fontFamily})')
    assert abs(actual_font['size'] - 32 * zoom) <= 0.2, actual_font
    assert 'mono' in actual_font['family'].lower() or 'courier' in actual_font['family'].lower(), actual_font
    editor_width = editor.evaluate('(element) => ({client:element.clientWidth,scroll:element.scrollWidth})')
    assert editor_width['scroll'] <= editor_width['client'] + 1, editor_width
    page.screenshot(path=str(OUTPUT / '05-rotated-zoomed-label-editor-dark.png'), full_page=True)
    editor.press('Control+Enter')
    assert len(label_for(page, identifier)) == 1
    assert page.locator('[data-element-id="' + previous_id + '"]').is_visible()
    page.reload(wait_until='networkidle')
    page.get_by_test_id('draw-surface').wait_for()
    for identifier in shapes:
        centered_label(page, identifier)
    assert not errors, errors
    print('CENTERED SHAPE LABELS: PASS; native rectangle/ellipse/diamond double-click, autofocus, actual editor bounds, multiline/CtrlEnter/blur, existing-label reuse, movement/resize/history, Q opt-in, font/zoom/pan/rotation and reload.')
    print('Maximum measured editor-center error:', max(max(abs(value['x']), abs(value['y'])) for value in CENTER_ERRORS), 'CSS pixels.')
    print('Five screenshots captured; no browser runtime errors.')
    browser.close()
