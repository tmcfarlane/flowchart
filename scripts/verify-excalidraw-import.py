"""Verify .excalidraw interoperability with Flowchart AI's own Draw surface.

Run against `PORT=3016 npm run dev -- --host 0.0.0.0` with Python Playwright.
All geometry checks use the visible SVG DOM and persisted application document.
"""
from pathlib import Path
import argparse
import json
import math
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'src/test/fixtures/excalidraw/architecture-complete.excalidraw'
OUTPUT = ROOT / 'docs/screenshots/excalidraw-import'
DRAFT = 'flowchart-editor-draft-v3'

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3016/')
args = parser.parse_args()
OUTPUT.mkdir(parents=True, exist_ok=True)


def document(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)||"{}")', DRAFT)


def wait_elements(page, count):
    page.wait_for_function('({key,count})=>JSON.parse(localStorage.getItem(key)||"{}").architectureScene?.elements.filter(e=>!e.isDeleted).length===count', arg={'key': DRAFT, 'count': count})


def pick(page, payload=None):
    field = page.get_by_label('Import JSON or Excalidraw file')
    if not field.count():
        page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files(payload or {'name': 'checkout-architecture.excalidraw', 'mimeType': '', 'buffer': FIXTURE.read_bytes()})
    page.get_by_role('dialog', name='Bring your drawing in').wait_for()


def world_point(page, point):
    return page.evaluate('(point)=>{const matrix=document.querySelector("[data-draw-viewport]").getScreenCTM().inverse();const p=new DOMPoint(point.x,point.y).matrixTransform(matrix);return {x:p.x,y:p.y};}', point)


def screen_point(page, point):
    return page.evaluate('(point)=>{const matrix=document.querySelector("[data-draw-viewport]").getScreenCTM();const p=new DOMPoint(point.x,point.y).matrixTransform(matrix);return {x:p.x,y:p.y};}', point)


def matrix(page):
    return page.evaluate('()=>{const m=document.querySelector("[data-draw-viewport]").getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f];}')


def graph(document):
    return {
        'nodes': [{key: node.get(key) for key in ['id', 'type', 'position', 'parentNode', 'style']} | {'label': node['data']['label'], 'containerKind': node['data'].get('containerKind')} for node in document['nodes']],
        'edges': [{key: edge.get(key) for key in ['id', 'source', 'target', 'label', 'sourceHandle', 'targetHandle']} | {'protocol': edge.get('data', {}).get('protocol'), 'commStyle': edge.get('data', {}).get('commStyle')} for edge in document['edges']],
    }


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='networkidle')
    pick(page)
    page.get_by_role('note', name='Draw compatibility').wait_for()
    page.screenshot(path=str(OUTPUT / '01-import-destination.png'), full_page=True)
    page.get_by_role('button', name='Open as new diagram').click()
    page.get_by_role('application', name='Drawing surface').wait_for()
    wait_elements(page, 9)
    assert page.get_by_label('Draw Mode').get_attribute('aria-pressed') == 'true'
    assert page.get_by_label('Architecture Mode').get_attribute('aria-pressed') == 'false'
    assert page.locator('[data-element-id]').count() == 9
    page.screenshot(path=str(OUTPUT / '02-editable-scene-dark.png'), full_page=True)

    # Imported shapes are individual SVG objects. Moving one updates its bound
    # text and arrow, and the document history restores the complete operation.
    original = document(page)
    service = next(element for element in original['architectureScene']['elements'] if element.get('customData', {}).get('fixtureRole') == 'service')
    arrow = next(element for element in original['architectureScene']['elements'] if element['type'] == 'arrow')
    # Use the upper corner of the shape so this selects its container rather
    # than the separately editable bound text drawn over its center.
    angle = service.get('angle', 0)
    dx, dy = -service['width'] * 0.3, -service['height'] * 0.3
    center = screen_point(page, {'x': service['x'] + service['width'] / 2 + dx * math.cos(angle) - dy * math.sin(angle), 'y': service['y'] + service['height'] / 2 + dx * math.sin(angle) + dy * math.cos(angle)})
    page.keyboard.down('Control')
    page.mouse.click(center['x'], center['y'])
    page.keyboard.up('Control')
    page.keyboard.press('ArrowRight')
    page.wait_for_function('({key,id,x})=>JSON.parse(localStorage.getItem(key)||"{}").architectureScene?.elements.find(e=>e.id===id)?.x===x', arg={'key': DRAFT, 'id': service['id'], 'x': service['x'] + 1})
    moved = next(element for element in document(page)['architectureScene']['elements'] if element['id'] == arrow['id'])
    assert moved['startBinding']['elementId'] == service['id']
    assert (moved['x'], moved['y'], moved['points']) != (arrow['x'], arrow['y'], arrow['points'])
    page.keyboard.press('Control+z')
    page.wait_for_function('({key,id,x})=>JSON.parse(localStorage.getItem(key)||"{}").architectureScene?.elements.find(e=>e.id===id)?.x===x', arg={'key': DRAFT, 'id': service['id'], 'x': service['x']})
    print('OWN DRAW: editable imported geometry, bound arrow, and undo PASS', flush=True)

    page.get_by_role('button', name='Zoom out', exact=True).click()
    page.get_by_role('button', name='Zoom out', exact=True).click()
    page.keyboard.down('Space')
    page.mouse.move(1100, 820)
    page.mouse.down()
    page.mouse.move(1000, 750, steps=10)
    page.mouse.up()
    page.keyboard.up('Space')
    before_viewport = matrix(page)
    assert abs(before_viewport[0] - 1) > 0.001
    point = {'x': 1000, 'y': 570}
    expected = world_point(page, point)
    old_ids = {element['id'] for element in document(page)['architectureScene']['elements']}
    data = page.evaluate_handle('text=>{const data=new DataTransfer();data.items.add(new File([text],"second-architecture.excalidraw",{type:""}));return data;}', FIXTURE.read_text())
    wrapper = page.locator('.react-flow-wrapper')
    wrapper.dispatch_event('dragenter', {'dataTransfer': data, 'clientX': point['x'], 'clientY': point['y']})
    page.get_by_role('status').filter(has_text='Drop your drawing here').wait_for()
    page.screenshot(path=str(OUTPUT / '03-canvas-file-drop.png'), full_page=True)
    wrapper.dispatch_event('drop', {'dataTransfer': data, 'clientX': point['x'], 'clientY': point['y']})
    page.get_by_role('dialog', name='Bring your drawing in').wait_for()
    assert {element['id'] for element in document(page)['architectureScene']['elements']} == old_ids
    page.get_by_role('button', name='Insert into current diagram').click()
    wait_elements(page, 18)
    inserted = next(element for element in document(page)['architectureScene']['elements'] if element['type'] == 'frame' and element['id'] not in old_ids)
    actual = {'x': inserted['x'] + inserted['width'] / 2, 'y': inserted['y'] + inserted['height'] / 2}
    # SVG matrices are exposed as float32 values by Chromium; a thousandth of a
    # scene unit is still substantially below one physical pixel at every zoom.
    assert abs(actual['x'] - expected['x']) < 0.001 and abs(actual['y'] - expected['y']) < 0.001, {'expected': expected, 'actual': actual, 'matrix': before_viewport, 'mode': document(page)['mode']}
    assert all(abs(a - b) < 0.00001 for a, b in zip(matrix(page), before_viewport))
    print('PANNED/ZOOMED DROP: expected and actual centers', json.dumps({'expected': expected, 'actual': actual}), flush=True)

    page.get_by_role('button', name='Undo', exact=True).click()
    wait_elements(page, 9)
    page.get_by_role('button', name='Toggle Dark Mode').click()
    page.get_by_role('button', name='Fit drawing').click()
    page.screenshot(path=str(OUTPUT / '04-editable-scene-light.png'), full_page=True)
    before_failure = document(page)
    corrupt = page.evaluate_handle('()=>{const data=new DataTransfer();data.items.add(new File(["{broken"],"broken.excalidraw",{type:""}));return data;}')
    wrapper.dispatch_event('drop', {'dataTransfer': corrupt, 'clientX': 800, 'clientY': 550})
    page.get_by_role('alert').filter(has_text='Couldn’t import drawing').wait_for()
    assert document(page) == before_failure
    page.screenshot(path=str(OUTPUT / '05-invalid-file-feedback.png'), full_page=True)
    page.get_by_label('Dismiss import error').click()

    page.get_by_role('button', name='Share', exact=True).click()
    with page.expect_response(lambda response: response.request.method == 'POST' and response.url.endswith('/api/flows')) as created:
        page.get_by_role('button', name='Create share link').click()
    assert created.value.status == 201
    shared = created.value.json()
    assert shared['chart']['mode'] == 'draw'
    shared_scene = shared['chart']['architectureScene']
    viewer = context.new_page()
    viewer.on('pageerror', lambda error: errors.append(str(error)))
    viewer.goto(shared['url'], wait_until='networkidle')
    viewer.get_by_role('application', name='Drawing surface').wait_for()
    assert viewer.get_by_label('Draw Mode').get_attribute('aria-pressed') == 'true'
    saved = viewer.request.get(shared['url'].replace('/f/', '/api/flows/')).json()
    assert saved['mode'] == 'draw' and saved['architectureScene'] == shared_scene
    print('DRAW SHARING: explicit mode, geometry, and embedded images PASS', flush=True)

    # Preserve original Architecture and mixed drawing content across insertion,
    # import undo/redo, mode switching, local reload and application JSON export.
    architecture = context.new_page()
    architecture.on('pageerror', lambda error: errors.append(str(error)))
    architecture.goto(args.url, wait_until='networkidle')
    initial = {'version': 4, 'mode': 'architecture', 'nodes': [
        {'id': '2', 'type': 'container', 'position': {'x': 30, 'y': 40}, 'style': {'width': 650, 'height': 380}, 'data': {'label': 'Production VPC', 'containerKind': 'vpc'}},
        {'id': '3', 'type': 'service', 'parentNode': '2', 'position': {'x': 60, 'y': 110}, 'style': {'width': 180, 'height': 90}, 'data': {'label': 'Orders API'}},
        {'id': '4', 'type': 'database', 'parentNode': '2', 'position': {'x': 370, 'y': 110}, 'style': {'width': 160, 'height': 110}, 'data': {'label': 'Orders DB'}},
    ], 'edges': [{'id': 'sql', 'source': '3', 'target': '4', 'label': 'Read/write', 'sourceHandle': 'right', 'targetHandle': 'left', 'data': {'protocol': 'SQL', 'commStyle': 'sync'}}], 'architectureScene': {'version': 1, 'elements': [{'id': 'retained-note', 'type': 'text', 'x': 800, 'y': 300, 'width': 210, 'height': 30, 'angle': 0, 'text': 'Existing drawing note', 'fontSize': 20, 'fontFamily': 2}], 'files': {}}}
    architecture.evaluate('({key,doc})=>localStorage.setItem(key,JSON.stringify(doc))', {'key': DRAFT, 'doc': initial})
    architecture.reload(wait_until='networkidle')
    assert architecture.get_by_label('Architecture Mode').get_attribute('aria-pressed') == 'true'
    assert architecture.locator('.react-flow__node').count() == 3
    architecture.wait_for_timeout(600)
    before_architecture = document(architecture)
    pick(architecture)
    architecture.get_by_role('button', name='Cancel', exact=True).click()
    assert graph(document(architecture)) == graph(before_architecture)
    assert document(architecture)['mode'] == 'architecture'
    pick(architecture)
    architecture.get_by_role('button', name='Insert into current diagram').click()
    architecture.get_by_role('application', name='Drawing surface').wait_for()
    architecture.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"{}").mode==="draw"', arg=DRAFT)
    assert graph(document(architecture)) == graph(before_architecture)
    assert any(element['id'] == 'retained-note' for element in document(architecture)['architectureScene']['elements'])
    architecture.get_by_role('button', name='Undo', exact=True).click()
    architecture.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"{}").mode==="architecture"', arg=DRAFT)
    assert architecture.locator('.react-flow__node').count() == 3
    assert graph(document(architecture)) == graph(before_architecture)
    assert document(architecture)['architectureScene'] == before_architecture['architectureScene']
    architecture.get_by_role('button', name='Redo', exact=True).click()
    architecture.get_by_role('application', name='Drawing surface').wait_for()
    architecture.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"{}").mode==="draw"', arg=DRAFT)
    architecture.get_by_label('Architecture Mode').click()
    architecture.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)||"{}").mode==="architecture"', arg=DRAFT)
    mixed = document(architecture)
    assert graph(mixed) == graph(before_architecture) and len(mixed['architectureScene']['elements']) > 9, {'before': graph(before_architecture), 'after': graph(mixed), 'sceneCount': len(mixed['architectureScene']['elements'])}
    architecture.reload(wait_until='networkidle')
    assert architecture.get_by_label('Architecture Mode').get_attribute('aria-pressed') == 'true'
    assert graph(document(architecture)) == graph(before_architecture)
    architecture.get_by_role('button', name='Export', exact=True).click()
    with architecture.expect_download() as downloaded:
        architecture.get_by_role('button', name='Export as JSON', exact=True).click()
    exported = json.loads(Path(downloaded.value.path()).read_text())
    assert exported['version'] == 4 and exported['mode'] == 'architecture'
    assert graph(exported) == graph(before_architecture) and exported['architectureScene'] == document(architecture)['architectureScene']
    print('ARCHITECTURE: original renderer, insert/cancel/undo/redo/mixed reload/export PASS', flush=True)
    assert not errors, errors
    print('BROWSER ERRORS:', errors, flush=True)
    browser.close()
