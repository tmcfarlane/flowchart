from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3051/'
OUTPUT = Path(__file__).resolve().parents[1] / 'docs/screenshots/draw-lock-selection'
OUTPUT.mkdir(parents=True, exist_ok=True)
KEY = 'flowchart-editor-draft-v3'


def shape(identifier, x, y, **extra):
    return dict(id=identifier, type='rectangle', x=x, y=y, width=190, height=120,
                angle=0, strokeColor='#087f5b', backgroundColor='#b2f2dc', strokeWidth=2,
                opacity=100, groupIds=[], boundElements=None, locked=False) | extra


def document(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)


def element(page, identifier):
    return next(item for item in document(page)['architectureScene']['elements'] if item['id'] == identifier)


def saved(page, identifier, field, value):
    page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e => e.id === args.id)?.[args.field] === args.value',
                           arg={'key': KEY, 'id': identifier, 'field': field, 'value': value})


def click(page, identifier, modifiers=None):
    box = page.locator(f'[data-element-id="{identifier}"]').bounding_box()
    for modifier in modifiers or []:
        page.keyboard.down(modifier)
    page.mouse.click(box['x'] + box['width'] * .3, box['y'] + box['height'] * .3)
    for modifier in reversed(modifiers or []):
        page.keyboard.up(modifier)


def drag(page, identifier, dx=55, dy=30):
    box = page.locator(f'[data-element-id="{identifier}"]').bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=8)
    page.mouse.up()


def focus(page):
    page.get_by_label('Draw canvas', exact=True).focus()


def seed_page(browser, drawing):
    page = browser.new_page(viewport={'width': 1680, 'height': 1050}, accept_downloads=True)
    page.goto(ORIGIN, wait_until='networkidle')
    payload = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
               'architectureScene': {'version': 1, 'files': {}, 'elements': drawing,
                                     'appState': {'viewBackgroundColor': '#ffffff'}}}
    page.evaluate('(args) => localStorage.setItem(args.key, JSON.stringify(args.value))', {'key': KEY, 'value': payload})
    page.reload(wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you')
    if dismiss.count():
        dismiss.click()
    page.get_by_test_id('draw-surface').wait_for()
    return page


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    label = dict(id='label', type='text', x=135, y=222, width=120, height=26, angle=0,
                 text='Protected API', originalText='Protected API', fontSize=18, fontFamily=2,
                 containerId='box', strokeColor='#087f5b', groupIds=[], boundElements=None)
    page = seed_page(browser, [shape('box', 100, 180), label, shape('other', 430, 180), shape('third', 760, 180)])
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    click(page, 'box')
    page.get_by_role('button', name='Lock', exact=True).click()
    saved(page, 'box', 'locked', True)
    baseline = document(page)['architectureScene']
    focus(page)
    page.keyboard.press('Escape')
    click(page, 'box')
    assert page.locator('[data-selected="true"]').count() == 2
    assert page.get_by_role('button', name='Unlock', exact=True).is_enabled()
    assert page.locator('[data-resize], [data-rotate], [data-point-index]').count() == 0
    assert page.get_by_label('Stroke color', exact=True).count() == 0
    page.screenshot(path=str(OUTPUT / '01-locked-selection-dark.png'))
    page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
    page.screenshot(path=str(OUTPUT / '02-locked-selection-light.png'))
    drag(page, 'box')
    page.keyboard.down('Alt')
    drag(page, 'box')
    page.keyboard.up('Alt')
    focus(page)
    for key in ['ArrowRight', 'Control+g', 'Control+]', 'Control+d', 'Shift+h', 'Control+k', 'Enter']:
        page.keyboard.press(key)
    assert not page.get_by_label('Edit drawing text', exact=True).count()
    assert document(page)['architectureScene'] == baseline
    box = page.locator('[data-element-id="box"]').bounding_box()
    page.mouse.click(box['x'] + box['width'] * .3, box['y'] + box['height'] * .3, button='right')
    assert document(page)['architectureScene'] == baseline
    focus(page)
    copied = page.evaluate('''() => {const data=new DataTransfer();document.querySelector('.draw-canvas').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('application/x-flowchart-drawing') || data.getData('text/plain')}''')
    assert 'Protected API' in copied
    page.get_by_role('button', name='Export', exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button', name='Export as SVG', exact=True).click()
    download.value.save_as(str(OUTPUT / 'locked-selection.svg'))
    assert 'Protected API' in (OUTPUT / 'locked-selection.svg').read_text()
    focus(page)
    page.keyboard.press('Control+z')
    saved(page, 'box', 'locked', False)
    page.keyboard.press('Control+Shift+z')
    saved(page, 'box', 'locked', True)
    click(page, 'box')
    page.get_by_role('button', name='Unlock', exact=True).click()
    saved(page, 'box', 'locked', False)
    focus(page)
    page.keyboard.press('Control+z')
    saved(page, 'box', 'locked', True)
    page.keyboard.press('Control+Shift+z')
    saved(page, 'box', 'locked', False)
    before = element(page, 'box')
    drag(page, 'box')
    page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e => e.id === "box").x !== args.x', arg={'key': KEY, 'x': before['x']})
    moved = element(page, 'box')
    page.screenshot(path=str(OUTPUT / '03-unlocked-and-moved.png'))
    focus(page)
    page.keyboard.press('Control+z')
    saved(page, 'box', 'x', before['x'])
    page.keyboard.press('Control+Shift+z')
    saved(page, 'box', 'x', moved['x'])
    page.reload(wait_until='networkidle')
    assert element(page, 'box')['x'] == moved['x'] and not element(page, 'box')['locked']
    click(page, 'box')
    page.get_by_role('button', name='Lock', exact=True).click()
    saved(page, 'box', 'locked', True)
    locked_box, locked_label = element(page, 'box'), element(page, 'label')
    focus(page)
    page.keyboard.press('Escape')
    click(page, 'box')
    click(page, 'other', ['Shift'])
    click(page, 'third', ['Shift'])
    assert page.locator('[data-selected="true"]').count() == 4
    assert not page.locator('[data-resize], [data-rotate]').count()
    page.get_by_label('Stroke color', exact=True).fill('#c92a2a')
    saved(page, 'other', 'strokeColor', '#c92a2a')
    focus(page)
    for key in ['Control+g', 'Control+Shift+ArrowRight', 'ArrowDown', 'Control+]', 'Shift+h']:
        page.keyboard.press(key)
    assert element(page, 'box') == locked_box and element(page, 'label') == locked_label
    page.screenshot(path=str(OUTPUT / '04-mixed-selection.png'))
    page.keyboard.press('Delete')
    saved(page, 'other', 'isDeleted', True)
    assert element(page, 'box') == locked_box and element(page, 'label') == locked_label
    page.get_by_role('button', name='Architecture Mode', exact=True).click()
    page.get_by_role('button', name='Add Service Node', exact=True).click()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).nodes.length === 1', arg=KEY)
    original_graph = (document(page)['nodes'], document(page)['edges'])
    for mode in ['Architecture Mode', 'Flowchart Mode', 'Draw Mode']:
        page.get_by_role('button', name=mode, exact=True).click()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).mode === "draw"', arg=KEY)
    assert (document(page)['nodes'], document(page)['edges']) == original_graph
    assert element(page, 'box')['locked']
    page.reload(wait_until='networkidle')
    click(page, 'box')
    assert page.get_by_role('button', name='Unlock', exact=True).is_enabled()
    assert not errors, errors
    print('PASS lock, deselect, plain select, no-op edits, copy/export, unlock, drag, undo/redo, reload, mixed selection, modes')

    for deep in [False, True]:
        frame = shape('frame', 80, 150, locked=True)
        frame.update(type='frame', width=700, height=260, backgroundColor='transparent')
        child = shape('child', 170, 210, frameId='frame')
        group_a = shape('group-a', 80, 520, locked=True)
        group_b = shape('group-b', 400, 520, locked=True)
        group_a['groupIds'] = group_b['groupIds'] = ['pair']
        inherited = seed_page(browser, [frame, child, group_a, group_b])
        click(inherited, 'child', ['Control'] if deep else [])
        assert 'containing frame' in inherited.locator('.draw-properties').inner_text()
        before = document(inherited)['architectureScene']
        drag(inherited, 'child')
        focus(inherited)
        for key in ['ArrowRight', 'Control+g', 'Control+d', 'Shift+h', 'Delete']:
            inherited.keyboard.press(key)
        assert document(inherited)['architectureScene'] == before
        click(inherited, 'child', ['Control'] if deep else [])
        inherited.get_by_role('button', name='Unlock', exact=True).click()
        saved(inherited, 'frame', 'locked', False)
        focus(inherited)
        inherited.keyboard.press('Control+z')
        saved(inherited, 'frame', 'locked', True)
        click(inherited, 'group-a', ['Control'] if deep else [])
        assert inherited.locator('[data-selected="true"]').count() == (1 if deep else 2)
        inherited.get_by_role('button', name='Unlock', exact=True).click()
        saved(inherited, 'group-a', 'locked', False)
        assert bool(element(inherited, 'group-b').get('locked')) == deep
        inherited.close()
    inherited = seed_page(browser, [shape('box', 100, 180, locked=True), label])
    click(inherited, 'label', ['Control'])
    assert inherited.locator('[data-selected="true"]').count() == 1
    inherited.get_by_role('button', name='Unlock', exact=True).click()
    saved(inherited, 'box', 'locked', False)
    focus(inherited)
    inherited.keyboard.press('Control+z')
    saved(inherited, 'box', 'locked', True)
    print('PASS ordinary/deep locked frame child, locked group, deep bound label, owner unlock in one undo transaction')
    browser.close()
