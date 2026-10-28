import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/screenshots/draw-geometry'
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3032/'
KEY = 'flowchart-editor-draft-v3'


def shape(id, type, x, y, w, h, **extra):
    return dict(id=id, type=type, x=x, y=y, width=w, height=h, angle=0,
                strokeColor='#087f5b', backgroundColor='#d3f9e8', strokeWidth=2,
                opacity=100, groupIds=[], **extra)


def fixture():
    return dict(version=4, mode='draw', nodes=[], edges=[], architectureScene=dict(
        version=1, files={}, elements=[
            shape('source', 'rectangle', 220, 200, 160, 90),
            shape('label', 'text', 250, 230, 100, 30, containerId='source', text='Review', originalText='Review', fontSize=24, fontFamily=2),
            shape('path', 'freedraw', 260, 440, 150, 110, points=[[0, 0], [150, 0], [40, 110]], pressures=[0.2, 0.8, 0.5]),
            shape('notch', 'diamond', 650, 420, 160, 100),
        ], appState=dict(viewBackgroundColor='#ffffff', gridSize=20)))


def elements(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements', KEY)


def point(page, x, y):
    return page.locator('[data-draw-viewport]').evaluate('(el,p) => {const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y}}', dict(x=x, y=y))


def move(page, x, y):
    p = point(page, x, y)
    page.mouse.move(p['x'], p['y'])


def click(page, x, y):
    p = point(page, x, y)
    page.mouse.click(p['x'], p['y'])


def selected(page):
    return page.locator('[data-element-id][data-selected="true"]').evaluate_all('(els) => els.map(el=>el.dataset.elementId)')


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport=dict(width=1680, height=1120), device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you', exact=True)
    if dismiss.count():
        dismiss.click()
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files(dict(name='geometry.json', mimeType='application/json', buffer=json.dumps(fixture()).encode()))
    page.get_by_test_id('draw-surface').wait_for()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length===4', arg=KEY)
    page.get_by_role('region', name='Draw canvas', exact=True).focus()
    page.keyboard.press('Shift+1')
    click(page, 230, 245)
    page.keyboard.press('Control+ArrowRight')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length===7', arg=KEY)
    clone, label, arrow = elements(page)[4:]
    assert clone['x'] == 460 and label['containerId'] == clone['id']
    assert arrow['startBinding']['elementId'] == 'source' and arrow['endBinding']['elementId'] == clone['id']
    page.screenshot(path=str(OUT / '01-connected-shape.png'), full_page=True)
    before = elements(page)
    page.keyboard.press('Alt+ArrowLeft')
    assert set(selected(page)) == {'source', 'label'}
    assert elements(page) == before
    page.screenshot(path=str(OUT / '02-bound-navigation.png'), full_page=True)
    page.keyboard.press('Control+z')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length===4', arg=KEY)
    page.keyboard.press('Control+Shift+z')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length===7', arg=KEY)
    click(page, 280, 440)
    path_bounds = page.locator('[data-element-id="path"]').bounding_box()
    page.keyboard.press('Shift+h')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id==="path").points[1][0] < 0', arg=KEY)
    flipped_path = elements(page)[2]
    assert flipped_path['pressures'] == [0.2, 0.8, 0.5]
    assert (flipped_path['width'], flipped_path['height']) == (150, 110)
    flipped_bounds = page.locator('[data-element-id="path"]').bounding_box()
    assert all(abs(path_bounds[key] - flipped_bounds[key]) < 1 for key in ('width', 'height'))
    page.screenshot(path=str(OUT / '03-horizontal-flip.png'), full_page=True)
    page.keyboard.press('Shift+v')
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id==="path").points[2][1] < 0', arg=KEY)
    vertical_path = elements(page)[2]
    assert (vertical_path['width'], vertical_path['height']) == (150, 110)
    vertical_bounds = page.locator('[data-element-id="path"]').bounding_box()
    assert all(abs(path_bounds[key] - vertical_bounds[key]) < 1 for key in ('width', 'height'))
    before = elements(page)
    page.keyboard.press('j')
    move(page, 200, 180)
    page.mouse.down()
    for x, y in [(850, 180), (850, 340), (430, 340), (430, 600), (200, 600)]:
        move(page, x, y)
    assert page.get_by_test_id('draw-lasso').count() == 1
    assert page.locator('[data-draw-content] [data-testid="draw-lasso"]').count() == 0
    page.screenshot(path=str(OUT / '04-concave-lasso.png'), full_page=True)
    move(page, 200, 180)
    page.mouse.up()
    assert 'notch' not in selected(page) and 'source' in selected(page) and 'path' in selected(page)
    assert elements(page) == before
    previous = selected(page)
    move(page, 600, 400)
    page.mouse.down()
    move(page, 850, 650)
    page.keyboard.press('Escape')
    page.mouse.up()
    assert selected(page) == previous and elements(page) == before
    assert not errors, errors
    page.screenshot(path=str(OUT / '05-lasso-selection.png'), full_page=True)
    print('PASS: connected creation and undo/redo; binding navigation; both flips; concave lasso and cancellation; clean export content; no browser errors')
    browser.close()
