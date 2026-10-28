import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3035')
parser.add_argument('--live', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'docs/screenshots/draw-selection-ai'
out.mkdir(parents=True, exist_ok=True)
key = 'flowchart-editor-draft-v3'

def element(identifier, kind, x, y, width, height, **extra):
    return dict(id=identifier, type=kind, x=x, y=y, width=width, height=height, angle=0,
                strokeColor='#0f766e', backgroundColor='transparent', strokeWidth=2,
                strokeStyle='solid', fillStyle='solid', roughness=0, opacity=100,
                groupIds=[], frameId=None, isDeleted=False, locked=False, boundElements=None, **extra)

host = element('orders', 'rectangle', 140, 180, 300, 150, customData={'private': {'retained': True}})
host['boundElements'] = [{'id': 'orders-label', 'type': 'text'}, {'id': 'connector', 'type': 'arrow'}]
label = element('orders-label', 'text', 170, 242, 240, 26, text='Receive customer orders', originalText='Receive customer orders', fontSize=20, fontFamily=2, textAlign='center', verticalAlign='middle', containerId='orders')
other = element('archive', 'rectangle', 680, 180, 260, 150)
other['boundElements'] = [{'id': 'archive-label', 'type': 'text'}, {'id': 'connector', 'type': 'arrow'}]
other_label = element('archive-label', 'text', 710, 242, 200, 26, text='Unselected archive', fontSize=20, fontFamily=2, textAlign='center', containerId='archive')
arrow = element('connector', 'arrow', 440, 255, 240, 0, points=[[0, 0], [240, 0]], startBinding={'elementId': 'orders', 'gap': 0}, endBinding={'elementId': 'archive', 'gap': 0}, endArrowhead='arrow')
original = {'version': 1, 'elements': [host, label, other, other_label, arrow], 'files': {}, 'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}}
fixture = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': original}
proposal = {'summary': 'Use blue for the selected API and shorten its label.', 'operations': [
    {'op': 'update_element', 'id': 'orders', 'changes': {'backgroundColor': '#dbeafe', 'strokeColor': '#2563eb'}},
    {'op': 'update_element', 'id': 'orders-label', 'changes': {'text': 'Orders API'}},
]}

def saved(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).architectureScene', key)

def wait_saved(page, text):
    page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e => e.id === "orders-label").text === args.text', arg={'key': key, 'text': text})

def select(page):
    point = page.locator('[data-draw-viewport]').evaluate('(layer) => { const p = new DOMPoint(160,200).matrixTransform(layer.getScreenCTM()); return {x:p.x,y:p.y}; }')
    page.mouse.click(point['x'], point['y'])
    page.get_by_role('button', name='Edit selection with AI').wait_for()

def open_dialog(page):
    page.get_by_role('button', name='Edit selection with AI').click()
    dialog = page.get_by_role('dialog', name='Edit Draw selection with AI')
    dialog.wait_for()
    return dialog

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1540, 'height': 1000})
    page = context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.post_data_json) if request.url.endswith('/api/chat') and request.method == 'POST' else None)
    context.add_init_script('if (!localStorage.getItem(' + json.dumps(key) + ')) localStorage.setItem(' + json.dumps(key) + ',' + json.dumps(json.dumps(fixture)) + ')')
    if not args.live:
        page.route('**/api/chat', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'role': 'assistant', 'finishReason': 'stop', 'message': json.dumps(proposal)})))
    page.goto(args.url, wait_until='networkidle')
    page.get_by_role('region', name='Draw canvas').wait_for()
    page.wait_for_timeout(500)
    select(page)
    page.screenshot(path=str(out / ('01-selection.png' if not args.live else '04-live-selection.png')))
    dialog = open_dialog(page)
    prompt = "Set the selected rectangle's fill to #dbeafe and stroke to #2563eb. Shorten its selected text label to Orders API. Keep all other properties, geometry and relationships unchanged."
    dialog.get_by_role('textbox', name='What should change?').fill(prompt)
    with page.expect_response(lambda response: response.url.endswith('/api/chat'), timeout=60000) as incoming:
        dialog.get_by_role('button', name='Preview changes', exact=True).click()
    response = incoming.value
    assert response.status == 200, (response.status, response.json())
    returned = json.loads(response.json()['message'])
    apply = dialog.get_by_role('button', name='Apply changes')
    apply.wait_for()
    page.wait_for_function('document.querySelector(".ai-draw-edit .apply")?.disabled === false')
    assert saved(page) == original, 'Preview wrote to the document'
    assert set(target['id'] for target in requests[-1]['drawContext']['targets']) == {'orders', 'orders-label'}
    assert not any(field in json.dumps(requests[-1]) for field in ['customData', 'dataURL', 'fileId', 'https://'])
    assert 'connector' in [dep['id'] for dep in requests[-1]['drawContext']['dependencies']]
    assert requests[-1]['drawContext']['targets'][0]['geometryAllowed'] is False
    suffix = 'live' if args.live else 'stub'
    page.screenshot(path=str(out / f'02-preview-{suffix}.png'))
    apply.click()
    dialog.wait_for(state='hidden')
    wait_saved(page, 'Orders API')
    after = saved(page)
    edited_label = next(item for item in after['elements'] if item['id'] == label['id'])
    derived = {key: edited_label[key] for key in ['x', 'y', 'width', 'height']}
    assert edited_label['width'] > 0 and edited_label['height'] >= label['fontSize']
    assert abs(edited_label['x'] + edited_label['width'] / 2 - host['x'] - host['width'] / 2) < 0.001
    assert abs(edited_label['y'] + edited_label['height'] / 2 - host['y'] - host['height'] / 2) < 0.001
    expected = {**original, 'elements': [{**host, 'backgroundColor': '#dbeafe', 'strokeColor': '#2563eb'}, {**label, **derived, 'text': 'Orders API', 'originalText': 'Orders API'}, other, other_label, arrow]}
    assert after == expected, 'Apply changed unrelated authored content or relationships'
    page.screenshot(path=str(out / f'03-applied-{suffix}.png'))
    page.get_by_role('region', name='Draw canvas').focus()
    page.keyboard.press('Control+z')
    wait_saved(page, 'Receive customer orders')
    assert saved(page) == original, 'One Undo must restore the whole edit'
    page.keyboard.press('Control+Shift+z')
    wait_saved(page, 'Orders API')
    assert saved(page) == expected
    page.reload(wait_until='networkidle')
    assert saved(page) == expected, 'Reload lost the full scene'
    if not args.live:
        select(page)
        dialog = open_dialog(page)
        dialog.get_by_role('textbox').fill('Unapplied preview')
        dialog.get_by_role('button', name='Preview changes', exact=True).click()
        page.wait_for_function('document.querySelector(".ai-draw-edit .apply")?.disabled === false')
        dialog.get_by_role('button', name='Cancel').click()
        assert saved(page) == expected
        page.unroute('**/api/chat')
        invalid = {'summary': 'Unsafe geometry', 'operations': [{'op': 'update_element', 'id': 'orders', 'changes': {'x': 500}}]}
        page.route('**/api/chat', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'message': json.dumps(invalid)})))
        dialog = open_dialog(page)
        dialog.get_by_role('textbox').fill('Move the bound shape')
        dialog.get_by_role('button', name='Preview changes', exact=True).click()
        dialog.get_by_role('alert').wait_for()
        assert not dialog.get_by_role('button', name='Apply changes').is_enabled()
        assert saved(page) == expected
        page.screenshot(path=str(out / '06-rejected-bound-geometry.png'))
    assert not errors, errors
    report = {'provider': 'configured live Azure via existing local API' if args.live else 'explicit browser response stub', 'httpStatus': response.status, 'proposal': returned, 'checks': ['preview does not save', 'exact selected scope', 'relationship context without private metadata', 'sparse apply preserves all other fields', 'one Undo and Redo', 'reload persistence', 'no browser runtime errors']}
    if not args.live:
        report['checks'] += ['cancel does not save', 'browser rejects bound geometry proposal']
    (out / f'verification-{suffix}.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'provider': report['provider'], 'checks': report['checks'], 'httpStatus': response.status}))
    browser.close()
