"""Run against `PORT=3016 npm run dev -- --host 0.0.0.0` with Python Playwright installed.

Exposes the editor's documented imperative API only in an intercepted browser-test
module response. Production source and browser globals are unchanged by this hook.
"""
from pathlib import Path
import argparse
import json
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'src/test/fixtures/excalidraw/architecture-complete.excalidraw'
OUTPUT = ROOT / 'docs/screenshots/excalidraw-import'

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3016/')
args = parser.parse_args()
OUTPUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)

    def instrument_public_api(route):
        response = route.fetch()
        body = response.text()
        dependency = re.search(r'from "([^"]*excalidraw_excalidraw[^\"]*)"', body)
        assert dependency, 'Vite native editor import was not found'
        body = 'import {serializeAsJSON as verifySerialize} from "' + dependency.group(1) + '";\n' + body
        hook = '''window.__verifyNative = {
          point: point => viewportCoordsToSceneCoords({clientX: point.x, clientY: point.y}, api.getAppState()),
          state: () => { const s = api.getAppState(); return {scrollX:s.scrollX,scrollY:s.scrollY,zoom:s.zoom.value,offsetLeft:s.offsetLeft,offsetTop:s.offsetTop,selected:s.selectedElementIds}; },
          elements: () => api.getSceneElementsIncludingDeleted(),
          exportFile: () => verifySerialize(api.getSceneElements(),api.getAppState(),api.getFiles(),'local'),
          fit: () => api.scrollToContent(undefined,{fitToContent:true})
        }; onReady({'''
        assert 'onReady({' in body, 'Native editor ready callback was not found'
        route.fulfill(response=response, body=body.replace('onReady({', hook, 1))

    context.route('**/src/components/ArchitectureCanvas.tsx*', instrument_public_api)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='networkidle')
    page.get_by_label('Import JSON or Excalidraw file').set_input_files({
        'name': 'checkout-architecture.excalidraw', 'mimeType': '', 'buffer': FIXTURE.read_bytes(),
    })
    dialog = page.get_by_role('dialog', name='Bring your drawing in')
    dialog.wait_for()
    page.screenshot(path=str(OUTPUT / '01-import-destination.png'), full_page=True)
    page.get_by_role('button', name='Open as new diagram').click()
    page.wait_for_function('window.__verifyNative?.elements().length === 9', timeout=60000)
    page.wait_for_timeout(900)
    page.screenshot(path=str(OUTPUT / '02-editable-scene-dark.png'), full_page=True)

    exported = page.evaluate('window.__verifyNative.exportFile()')
    exported_path = ROOT / 'src/test/fixtures/excalidraw/native-editor-roundtrip.excalidraw'
    exported_path.write_text(exported + '\n')
    print('NATIVE EDITOR EXPORT:', exported_path.name, 'elements:', len(json.loads(exported)['elements']), flush=True)

    # Select a single imported shape inside its native group, edit with the
    # keyboard, then undo through native history. Bound text/arrows stay associated.
    service = page.evaluate("window.__verifyNative.elements().find(e=>e.customData?.fixtureRole==='service')")
    service_id = service['id']
    database_id = page.evaluate("window.__verifyNative.elements().find(e=>e.type==='ellipse').id")
    old_arrow = page.evaluate("window.__verifyNative.elements().find(e=>e.type==='arrow')")
    state = page.evaluate('window.__verifyNative.state()')
    service_screen = {
        'x': (service['x'] + service['width'] / 2 + state['scrollX']) * state['zoom'] + state['offsetLeft'],
        'y': (service['y'] + service['height'] / 2 + state['scrollY']) * state['zoom'] + state['offsetTop'],
    }
    page.keyboard.down('Control')
    page.mouse.click(service_screen['x'], service_screen['y'])
    page.keyboard.up('Control')
    page.keyboard.press('ArrowRight')
    page.wait_for_function("({x,id})=>window.__verifyNative.elements().find(e=>e.id===id).x === x", arg={'x':service['x']+1,'id':service_id})
    moved = page.evaluate("window.__verifyNative.elements().find(e=>e.type==='arrow')")
    assert moved['startBinding']['elementId'] == service_id
    assert moved['endBinding']['elementId'] == database_id
    assert (moved['x'], moved['y'], moved['points']) != (old_arrow['x'], old_arrow['y'], old_arrow['points']), 'Bound arrow did not follow imported shape'
    page.keyboard.press('Control+z')
    page.wait_for_function("({x,id})=>window.__verifyNative.elements().find(e=>e.id===id).x === x", arg={'x':service['x'],'id':service_id})
    print('NATIVE EDITING + BOUND ARROW + UNDO: PASS', flush=True)

    page.mouse.click(1290, 600)
    page.get_by_role('button', name='Zoom out', exact=True).click()
    page.get_by_role('button', name='Zoom out', exact=True).click()
    page.keyboard.down('Space')
    page.mouse.move(1280, 650)
    page.mouse.down()
    page.mouse.move(1170, 590, steps=12)
    page.mouse.up()
    page.keyboard.up('Space')
    viewport_before = page.evaluate('window.__verifyNative.state()')
    assert viewport_before['zoom'] != 1, viewport_before
    point = {'x': 1000, 'y': 570}
    expected = page.evaluate('(point)=>window.__verifyNative.point(point)', point)
    old_ids = set(page.evaluate('window.__verifyNative.elements().map(e=>e.id)'))
    drag = page.evaluate_handle("text=>{const data=new DataTransfer();data.items.add(new File([text],'second-architecture.excalidraw',{type:''}));return data;}", FIXTURE.read_text())
    wrapper = page.locator('.react-flow-wrapper')
    wrapper.dispatch_event('dragenter', {'dataTransfer': drag, 'clientX': point['x'], 'clientY': point['y']})
    page.get_by_role('status').filter(has_text='Drop your drawing here').wait_for()
    page.screenshot(path=str(OUTPUT / '03-canvas-file-drop.png'), full_page=True)
    wrapper.dispatch_event('drop', {'dataTransfer': drag, 'clientX': point['x'], 'clientY': point['y']})
    dialog.wait_for()
    assert set(page.evaluate('window.__verifyNative.elements().map(e=>e.id)')) == old_ids, 'Drop changed the scene before confirmation'
    page.get_by_role('button', name='Insert into current diagram').click()
    page.wait_for_function('window.__verifyNative.elements().filter(e=>!e.isDeleted).length === 18')
    inserted_frame = page.evaluate('(oldIds)=>window.__verifyNative.elements().find(e=>e.type==="frame"&&!oldIds.includes(e.id))', list(old_ids))
    actual = {'x': inserted_frame['x'] + inserted_frame['width'] / 2, 'y': inserted_frame['y'] + inserted_frame['height'] / 2}
    assert abs(actual['x'] - expected['x']) < 0.00001 and abs(actual['y'] - expected['y']) < 0.00001, {'expected': expected, 'actual': actual}
    viewport_after = page.evaluate('window.__verifyNative.state()')
    for field in ['scrollX', 'scrollY', 'zoom']:
        assert abs(viewport_before[field] - viewport_after[field]) < 0.00001, {'before': viewport_before, 'after': viewport_after}
    print('NONDEFAULT PAN/ZOOM INSERTION:', json.dumps({'viewport': {k:viewport_before[k] for k in ['scrollX','scrollY','zoom']}, 'expected': expected, 'actual': actual}), flush=True)

    page.get_by_role('button', name='Undo diagram import', exact=True).click()
    page.wait_for_function('window.__verifyNative.elements().filter(e=>!e.isDeleted).length === 9')
    page.get_by_role('button', name='Toggle Dark Mode').click()
    page.evaluate('window.__verifyNative.fit()')
    page.wait_for_timeout(700)
    page.screenshot(path=str(OUTPUT / '04-editable-scene-light.png'), full_page=True)

    before_failure = page.evaluate('JSON.stringify(window.__verifyNative.elements())')
    corrupt = page.evaluate_handle("()=>{const data=new DataTransfer();data.items.add(new File(['{broken'],'broken.excalidraw',{type:''}));return data;}")
    wrapper.dispatch_event('drop', {'dataTransfer': corrupt, 'clientX': 800, 'clientY': 550})
    page.get_by_role('alert').filter(has_text='Couldn’t import drawing').wait_for()
    assert page.evaluate('JSON.stringify(window.__verifyNative.elements())') == before_failure
    page.screenshot(path=str(OUTPUT / '05-invalid-file-feedback.png'), full_page=True)
    page.get_by_label('Dismiss import error').click()

    # Saving through the real shared-chart API must retain imported scene data.
    page.get_by_role('button', name='Share', exact=True).click()
    with page.expect_response(lambda response: response.request.method == 'POST' and response.url.endswith('/api/flows')) as created:
        page.get_by_role('button', name='Create share link').click()
    response = created.value
    assert response.status == 201
    shared = response.json()
    shared_scene = shared['chart']['architectureScene']
    assert len(shared_scene['elements']) == 9 and len(shared_scene['files']) == 1
    viewer = context.new_page()
    viewer.on('pageerror', lambda error: errors.append(str(error)))
    viewer.goto(shared['url'], wait_until='networkidle')
    viewer.locator('.architecture-canvas .excalidraw').wait_for()
    assert viewer.get_by_label('Architecture Mode').get_attribute('aria-pressed') == 'true'
    saved = viewer.request.get(shared['url'].replace('/f/', '/api/flows/')).json()['architectureScene']
    assert len(saved['elements']) == 9 and saved['files'] == shared_scene['files']
    print('IMPORTED SCENE SHARED RELOAD: PASS (HTTP 201, 9 elements, embedded image retained)', flush=True)

    # An export carrying app-reserved IDs must remain independent of future
    # semantic nodes. Image-file drops must not bypass destination confirmation.
    clean = context.new_page()
    clean.goto(args.url, wait_until='networkidle')
    clean.evaluate("localStorage.removeItem('flowchart-editor-draft-v3')")
    clean.reload(wait_until='networkidle')
    foreign = {'type': 'excalidraw', 'version': 2, 'elements': [{'id': 'fc-node-2', 'type': 'rectangle', 'x': -100, 'y': 50, 'width': 180, 'height': 90, 'angle': 0, 'customData': {'flowchart': {'kind': 'node', 'id': '2'}}}], 'files': {}}
    clean.get_by_label('Import JSON or Excalidraw file').set_input_files({'name': 'native-export.excalidraw', 'mimeType': '', 'buffer': json.dumps(foreign).encode()})
    clean.get_by_role('button', name='Open as new diagram').click()
    clean.locator('.architecture-canvas .excalidraw').wait_for()
    clean.get_by_label('Add Service Node').click()
    clean.wait_for_function("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')||'{}').nodes?.length===1")
    clean.wait_for_timeout(700)
    result = clean.evaluate("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3'))")
    elements = result['architectureScene']['elements']
    ids = [element['id'] for element in elements]
    assert len(ids) == len(set(ids)) and result['nodes'][0]['id'] == '2'
    imported = [element for element in elements if element['type'] == 'rectangle' and not element.get('customData', {}).get('flowchart')]
    assert len(imported) == 1 and imported[0]['x'] == -100 and imported[0]['y'] == 50
    before_image = clean.evaluate("localStorage.getItem('flowchart-editor-draft-v3')")
    svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><metadata>excalidraw scene</metadata></svg>'
    image_drop = clean.evaluate_handle("svg=>{const data=new DataTransfer();data.items.add(new File([svg],'scene.svg',{type:'image/svg+xml'}));return data;}", svg)
    clean.locator('.react-flow-wrapper').dispatch_event('drop', {'dataTransfer': image_drop, 'clientX': 700, 'clientY': 500})
    clean.get_by_role('alert').filter(has_text='Use the Image tool').wait_for()
    assert clean.evaluate("localStorage.getItem('flowchart-editor-draft-v3')") == before_image
    print('RESERVED-ID ISOLATION + IMAGE-DROP GUARD: PASS', flush=True)
    assert not errors, errors
    print('INVALID FILE PRESERVES SCENE: PASS', flush=True)
    print('BROWSER ERRORS:', errors, flush=True)
    browser.close()
