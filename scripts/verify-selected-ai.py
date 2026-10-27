"""Verify selected-node AI edits in a real browser.

Run the app, then pass its URL (default http://localhost:3014). Set
SELECTION_EDIT_VERIFY_LIVE_AI=1 to use the configured provider; otherwise only
the provider response is stubbed and all UI, scope, apply/history/export checks
still run in Chromium. Screenshots and a verification report go to
SELECTION_EDIT_VERIFY_OUTPUT or /tmp/flowchart-selected-ai.
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

origin = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3014').rstrip('/')
out = Path(os.environ.get('SELECTION_EDIT_VERIFY_OUTPUT', '/tmp/flowchart-selected-ai'))
out.mkdir(parents=True, exist_ok=True)
live_provider = os.environ.get('SELECTION_EDIT_VERIFY_LIVE_AI') == '1'
draft_key = 'flowchart-editor-draft-v3'
report = {'provider': 'live configured provider' if live_provider else 'explicit provider-response stub', 'modes': []}


def fixture(mode):
    architecture = mode == 'architecture'
    nodes = [
        {'id': 'receive', 'type': 'service' if architecture else 'step', 'position': {'x': 60.123456, 'y': 110.987654}, 'data': {'label': 'Receive and validate a customer order', 'custom': {'preserved': True}}, 'style': {'width': 240, 'height': 100}, 'selected': True},
        {'id': 'receipt', 'type': 'service' if architecture else 'step', 'position': {'x': 410, 'y': 110}, 'data': {'label': 'Send the customer an order confirmation'}, 'style': {'width': 240, 'height': 100}, 'selected': True},
        {'id': 'archive', 'type': 'database' if architecture else 'note', 'position': {'x': 770, 'y': 230}, 'data': {'label': 'Order archive', 'custom': 'unselected and unchanged'}, 'style': {'width': 200, 'height': 115}},
    ]
    if architecture:
        nodes.insert(0, {'id': 'private', 'type': 'container', 'position': {'x': 0, 'y': 0}, 'data': {'label': 'Private order platform', 'containerKind': 'vpc'}, 'style': {'width': 1060, 'height': 430}})
        for node in nodes[1:]:
            node.update({'parentNode': 'private', 'extent': 'parent'})
    edges = [
        {'id': 'receive-receipt', 'source': 'receive', 'target': 'receipt', 'sourceHandle': 'right', 'targetHandle': 'left', 'label': 'Order accepted', 'type': 'default', 'animated': False, 'data': {'protocol': 'event', 'commStyle': 'sync'}},
        {'id': 'receive-archive', 'source': 'receive', 'target': 'archive', 'sourceHandle': 'bottom', 'targetHandle': 'left', 'label': 'Audit record', 'type': 'default', 'animated': False, 'data': {'protocol': 'SQL', 'commStyle': 'sync'}},
    ]
    drawing = {'version': 1, 'elements': [{'id': 'retained-sketch', 'type': 'text', 'x': -200, 'y': 0, 'width': 160, 'height': 24, 'angle': 0, 'text': 'Retained Draw annotation'}], 'files': {}}
    return {'version': 4, 'mode': mode, 'nodes': nodes, 'edges': edges, 'architectureScene': drawing}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
    for mode in ['flowchart', 'architecture']:
        context = browser.new_context(viewport={'width': 1600, 'height': 1050}, accept_downloads=True)
        page = context.new_page()
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        original = fixture(mode)
        page.add_init_script('localStorage.setItem(' + json.dumps(draft_key) + ',' + json.dumps(json.dumps(original)) + ')')
        expected = {'receive': 'Receive order' if mode == 'flowchart' else 'Orders API', 'receipt': 'Send receipt' if mode == 'flowchart' else 'Notifications'}
        operations = [{'op': 'update_node', 'id': node_id, 'changes': {'label': text}} for node_id, text in expected.items()]
        if not live_provider:
            page.route('**/api/chat', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'role': 'assistant', 'finishReason': 'stop', 'message': json.dumps({'summary': 'Shorten the two selected labels in place.', 'operations': operations})})))
        page.on('request', lambda request: requests.append(request.post_data_json) if request.url.endswith('/api/chat') and request.method == 'POST' else None)
        page.goto(origin + '/', wait_until='networkidle')
        page.get_by_role('button', name='Edit with AI', exact=True).wait_for()
        page.wait_for_timeout(600)
        if mode == 'architecture':
            page.get_by_label('Toggle Dark Mode', exact=True).click()
        page.screenshot(path=str(out / (mode + '-selection.png')))
        page.get_by_role('button', name='Edit with AI', exact=True).click()
        dialog = page.get_by_role('dialog', name='Edit with AI', exact=True)
        dialog.wait_for()
        assert dialog.get_by_text('2 nodes', exact=True).count() == 1
        assert not dialog.get_by_role('checkbox').is_checked()
        instruction = 'Rename “Receive and validate a customer order” to “' + expected['receive'] + '” and “Send the customer an order confirmation” to “' + expected['receipt'] + '”. Keep the layout and connections unchanged.'
        dialog.get_by_role('textbox', name='What should change?').fill(instruction)
        started = time.monotonic()
        with page.expect_response(lambda response: response.url.endswith('/api/chat') and response.request.method == 'POST', timeout=90000) as response_info:
            dialog.get_by_role('button', name='Preview changes', exact=True).click()
        response = response_info.value
        body = response.json()
        assert response.status == 200, body
        proposed = json.loads(body['message'])
        assert all(operation['op'] == 'update_node' and operation['id'] in expected and set(operation['changes']) == {'label'} for operation in proposed['operations']), proposed
        apply = dialog.get_by_role('button', name='Apply changes', exact=True)
        apply.wait_for()
        assert apply.is_enabled(), dialog.inner_text()
        assert requests[-1]['selection']['nodeIds'] == ['receipt', 'receive']
        assert requests[-1]['selection']['edgeIds'] == ['receive-receipt']
        page.wait_for_timeout(600)
        page.screenshot(path=str(out / (mode + '-preview.png')))
        apply.click()
        dialog.wait_for(state='detached')
        page.wait_for_function("expected => { const d=JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')||'{}');return Object.entries(expected).every(([id,text])=>d.nodes?.find(n=>n.id===id)?.data.label===text) }", arg=expected)
        saved = page.evaluate("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3'))")
        assert len(saved['nodes']) == len(original['nodes'])
        assert saved['architectureScene'] == original['architectureScene']
        for node in original['nodes']:
            after = next(item for item in saved['nodes'] if item['id'] == node['id'])
            assert after['position'] == node['position'], after
            assert after.get('style') == node.get('style'), after
            assert after.get('parentNode') == node.get('parentNode'), after
            assert after['data'].get('custom') == node['data'].get('custom')
            if node['id'] not in expected:
                assert after['data']['label'] == node['data']['label']
        page.screenshot(path=str(out / (mode + '-applied.png')))
        page.get_by_label('Undo', exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).nodes.find(n=>n.id==='receive').data.label==='Receive and validate a customer order'")
        page.get_by_label('Redo', exact=True).click()
        page.wait_for_function("text=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).nodes.find(n=>n.id==='receive').data.label===text", arg=expected['receive'])
        page.get_by_label('Export', exact=True).click()
        with page.expect_download() as download_info:
            page.get_by_role('button', name='Export as JSON', exact=True).click()
        exported = json.loads(Path(download_info.value.path()).read_text())
        assert len(exported['nodes']) == len(original['nodes'])
        assert next(node for node in exported['nodes'] if node['id'] == 'receive')['data']['label'] == expected['receive']
        assert exported['architectureScene'] == original['architectureScene']
        assert not errors, errors
        report['modes'].append({'mode': mode, 'instruction': instruction, 'status': response.status, 'elapsedSeconds': round(time.monotonic() - started, 2), 'operationCount': len(proposed['operations']), 'sameNodeIds': True, 'exactGeometryAndMetadata': True, 'retainedDrawing': True, 'undoRedo': True, 'jsonExport': True, 'browserErrors': errors})
        print(mode.upper() + ': scoped AI preview → in-place apply → undo/redo → JSON export PASS (' + report['provider'] + ')', flush=True)
        context.close()
    browser.close()
out.joinpath('verification.json').write_text(json.dumps(report, indent=2) + '\n')
print('Selected-node AI verification: PASS; artifacts in ' + str(out), flush=True)
