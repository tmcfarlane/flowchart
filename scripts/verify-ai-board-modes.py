import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import Error as PlaywrightError, async_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/ai-board-modes'
DRAFT = 'flowchart-editor-draft-v3'

parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3054/')
parser.add_argument('--live', action='store_true')
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()

draw_proposal = {
    'outputMode': 'draw',
    'summary': 'A native workshop sketch with editable notes and connectors.',
    'elements': [
        {'id': 'idea', 'type': 'rectangle', 'x': 80, 'y': 90, 'width': 250, 'height': 120, 'label': 'Workshop idea', 'strokeColor': '#2563eb', 'backgroundColor': '#dbeafe'},
        {'id': 'plan', 'type': 'ellipse', 'x': 480, 'y': 100, 'width': 240, 'height': 110, 'label': 'Plan', 'strokeColor': '#0f766e', 'backgroundColor': '#ccfbf1'},
        {'id': 'note', 'type': 'text', 'x': 80, 'y': 290, 'text': 'Standalone sticky note', 'fontSize': 24, 'strokeColor': '#d97706'},
        {'id': 'divider', 'type': 'line', 'points': [{'x': 80, 'y': 250}, {'x': 720, 'y': 250}], 'sourceId': None, 'targetId': None, 'label': '', 'strokeColor': '#64748b'},
        {'id': 'link', 'type': 'arrow', 'points': [{'x': 330, 'y': 150}, {'x': 480, 'y': 155}], 'sourceId': 'idea', 'targetId': 'plan', 'label': 'becomes', 'strokeColor': '#7c3aed'},
    ],
}
refined_proposal = {**draw_proposal, 'summary': 'The standalone note now names the next step.', 'elements': [
    {**item, 'text': 'Standalone next step'} if item['id'] == 'note' else item for item in draw_proposal['elements']
]}

asset_bytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2mGQAAAAASUVORK5CYII='
old_scene = {
    'version': 1,
    'elements': [
        {'id': 'retained-text', 'type': 'text', 'x': 850, 'y': 280, 'width': 220, 'height': 30, 'angle': 0, 'text': 'Old authored note', 'originalText': 'Old authored note', 'fontSize': 20, 'fontFamily': 2, 'strokeColor': '#0f766e', 'customData': {'private': 'keep exactly'}},
        {'id': 'retained-image', 'type': 'image', 'x': 860, 'y': 360, 'width': 90, 'height': 90, 'angle': 0, 'fileId': 'old-asset', 'status': 'saved'},
    ],
    'files': {'old-asset': {'id': 'old-asset', 'mimeType': 'image/png', 'dataURL': 'data:image/png;base64,' + asset_bytes, 'created': 1234}},
    'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20},
}
fixture = {
    'version': 4,
    'mode': 'flowchart',
    'nodes': [{'id': 'old-node', 'type': 'step', 'position': {'x': 1100, 'y': 120}, 'data': {'label': 'Retained flow node', 'custom': 'keep exactly'}, 'style': {'width': 200, 'height': 80}}],
    'edges': [],
    'architectureScene': old_scene,
}


def response(proposal):
    return {'role': 'assistant', 'finishReason': 'stop', 'message': json.dumps(proposal)}


async def document(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def screenshot(page, filename):
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.screenshot(path=str(OUTPUT / filename), animations='disabled')


async def seed_page(browser, url, value, light=False):
    context = await browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
    page = await context.new_page()
    await page.add_init_script('if (!localStorage.getItem(' + json.dumps(DRAFT) + ')) localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(value)) + ')')
    await page.goto(url, wait_until='networkidle')
    if light:
        await page.get_by_role('button', name='Toggle Dark Mode').click()
    return context, page


async def selector(page):
    control = page.get_by_role('combobox', name='Generate for')
    await control.wait_for()
    assert await control.locator('option').all_text_contents() == ['Flowchart', 'Architecture', 'Draw']
    return control


async def open_full(page):
    dismiss = page.get_by_role('button', name='No, thank you')
    if await dismiss.count():
        await dismiss.click()
    await page.get_by_role('button', name='Open AI Assistant').click()
    dialog = page.get_by_role('dialog', name='FlowChart')
    await dialog.wait_for()
    return dialog


async def default_modes(browser, url, checks):
    buttons = {'flowchart': 'Generate Flowchart', 'architecture': 'Generate architecture diagram', 'draw': 'Generate drawing'}
    placeholders = {'flowchart': 'Describe any process', 'architecture': 'Describe your services', 'draw': 'Describe shapes'}
    for mode in ('flowchart', 'architecture', 'draw'):
        empty = {'version': 4, 'mode': mode, 'nodes': [], 'edges': [], 'architectureScene': {'version': 1, 'elements': [], 'files': {}}}
        context, page = await seed_page(browser, url, empty, light=mode == 'architecture')
        welcome = page.get_by_role('dialog', name='FlowChart')
        await welcome.wait_for()
        assert await (await selector(welcome)).input_value() == mode
        assert await welcome.get_by_role('button', name=buttons[mode]).count() == 1
        assert placeholders[mode] in await welcome.locator('textarea.ai-bubble-input').get_attribute('placeholder')
        await screenshot(page, f'01-welcome-{mode}.png')
        full = await open_full(page)
        assert await (await selector(full)).input_value() == mode
        assert await full.get_by_role('button', name=buttons[mode]).count() == 1
        assert placeholders[mode] in await full.locator('textarea.ai-bubble-input').get_attribute('placeholder')
        await screenshot(page, f'02-full-{mode}.png')
        checks.append(f'{mode} is the welcome and full prompt default')
        await context.close()


async def main_flow(browser, url, checks):
    context, page = await seed_page(browser, url, fixture)
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def stub(route):
        body = route.request.post_data_json
        requests.append(body)
        await route.fulfill(status=200, content_type='application/json', body=json.dumps(response(refined_proposal if body['mode'] == 'refine' else draw_proposal)))

    await page.route('**/api/chat', stub)
    before = await document(page)
    dialog = await open_full(page)
    target = await selector(dialog)
    assert await target.input_value() == 'flowchart'
    await target.select_option('draw')
    assert await page.get_by_role('button', name='Flowchart Mode').get_attribute('aria-pressed') == 'true'
    assert await dialog.get_by_role('button', name='Generate drawing').count() == 1
    assert await document(page) == before
    await screenshot(page, '03-cross-target-draw-dark.png')
    await dialog.locator('textarea.ai-bubble-input').fill('Sketch a workshop plan with editable shapes, a note, a divider, and a connected arrow.')
    await dialog.locator('button.ai-bubble-send').click()
    preview = page.get_by_role('dialog', name='Preview AI Proposal')
    await preview.wait_for(timeout=20000)
    assert await preview.get_by_text('Insert into Draw').count() == 1
    assert requests[0]['mode'] == 'generate' and requests[0]['diagramMode'] == 'draw'
    assert 'drawContext' not in requests[0] or all('dataURL' not in json.dumps(item) and 'customData' not in json.dumps(item) for item in requests[0]['drawContext']['elements'])
    assert 'dataURL' not in json.dumps(requests[0]) and 'keep exactly' not in json.dumps(requests[0])
    assert await document(page) == before
    assert await preview.get_by_text('Standalone sticky note').count() > 0
    assert await preview.get_by_text('Workshop idea').count() > 0
    await screenshot(page, '04-native-draw-preview-dark.png')
    await preview.locator('textarea.ai-preview-chat-input').fill('Rename the standalone note to the next step.')
    await preview.get_by_role('button', name='Regenerate').click()
    await preview.get_by_text('Standalone next step').wait_for(timeout=20000)
    assert requests[-1]['mode'] == 'refine' and requests[-1]['diagramMode'] == 'draw'
    assert requests[-1]['drawProposal']['outputMode'] == 'draw'
    assert requests[-1]['drawProposal']['elements'] == draw_proposal['elements']
    assert await document(page) == before
    await screenshot(page, '05-refined-native-draw-preview-dark.png')
    unsent = 'Add one more detail after presentation.'
    await preview.locator('textarea.ai-preview-chat-input').fill(unsent)
    await preview.get_by_role('button', name='Present').click()
    await page.get_by_role('button', name='Exit presentation').wait_for()
    await page.get_by_text('Standalone next step').wait_for()
    await screenshot(page, '05b-native-draw-presentation.png')
    await page.get_by_role('button', name='Exit presentation').click()
    await preview.wait_for()
    assert await preview.locator('textarea.ai-preview-chat-input').input_value() == unsent
    await preview.get_by_role('button', name='Insert into Canvas').click()
    await preview.wait_for(state='hidden')
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).mode === "draw"', arg=DRAFT)
    after = await document(page)
    assert after['nodes'] == before['nodes'] and after['edges'] == before['edges']
    old_by_id = {item['id']: item for item in before['architectureScene']['elements']}
    new_by_id = {item['id']: item for item in after['architectureScene']['elements']}
    assert all(new_by_id[identifier] == item for identifier, item in old_by_id.items())
    assert after['architectureScene']['files'] == before['architectureScene']['files']
    generated = [item for item in after['architectureScene']['elements'] if item['id'] not in old_by_id and not item.get('customData', {}).get('flowchart')]
    assert any(item['type'] == 'text' and item.get('text') == 'Standalone next step' and not item.get('containerId') for item in generated)
    assert any(item['type'] == 'line' and not item.get('startBinding') and not item.get('endBinding') for item in generated)
    assert any(item['type'] == 'arrow' and item.get('startBinding') and item.get('endBinding') for item in generated)
    assert any(item['type'] == 'text' and item.get('containerId') for item in generated)
    assert not any('customData' in item for item in generated)
    await page.get_by_label('Draw canvas', exact=True).focus()
    await page.keyboard.press('Alt+z')
    await page.locator('.draw-zen').wait_for()
    await screenshot(page, '06-native-draw-inserted-dark.png')
    await page.get_by_role('button', name='Toggle Dark Mode').click()
    await screenshot(page, '07-native-draw-inserted-light.png')
    await page.get_by_role('button', name='Undo', exact=True).click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).mode === "flowchart"', arg=DRAFT)
    assert await document(page) == before
    await page.get_by_role('button', name='Redo', exact=True).click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).mode === "draw"', arg=DRAFT)
    assert await document(page) == after
    await page.reload(wait_until='networkidle')
    assert await document(page) == after
    await page.get_by_role('button', name='Export', exact=True).click()
    async with page.expect_download() as download_info:
        await page.get_by_role('button', name='Export as JSON', exact=True).click()
    download = await download_info.value
    await download.save_as(str(OUTPUT / 'draw-output-export.json'))
    exported = json.loads((OUTPUT / 'draw-output-export.json').read_text())
    assert exported['mode'] == 'draw'
    assert exported['nodes'] == after['nodes'] and exported['edges'] == after['edges']
    assert exported['architectureScene'] == after['architectureScene']
    label = next(item for item in generated if item['type'] == 'text' and item.get('text') == 'Workshop idea' and item.get('containerId'))
    host_id = label['containerId']
    arrow = next(item for item in generated if item['type'] == 'arrow' and item.get('startBinding', {}).get('elementId') == host_id)
    await page.get_by_label('Draw canvas', exact=True).focus()
    await page.keyboard.press('Alt+z')
    await page.locator('.draw-zen').wait_for()
    label_box = await page.locator(f'[data-element-id="{label["id"]}"]').bounding_box()
    assert label_box
    await page.mouse.dblclick(label_box['x'] + label_box['width'] / 2, label_box['y'] + label_box['height'] / 2, delay=90)
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    await editor.wait_for(state='visible')
    await editor.fill('Workshop plan edited')
    await editor.press('Control+Enter')
    await page.wait_for_function('(arg) => JSON.parse(localStorage.getItem(arg.key)).architectureScene.elements.some(item => item.id === arg.id && item.text === arg.text)', arg={'key': DRAFT, 'id': label['id'], 'text': 'Workshop plan edited'})
    edited = await document(page)
    edited_label = next(item for item in edited['architectureScene']['elements'] if item['id'] == label['id'])
    assert edited_label['containerId'] == host_id
    arrow_before = next(item for item in edited['architectureScene']['elements'] if item['id'] == arrow['id'])
    host_before = next(item for item in edited['architectureScene']['elements'] if item['id'] == host_id)
    host_box = await page.locator(f'[data-element-id="{host_id}"]').bounding_box()
    assert host_box
    start_x = host_box['x'] + host_box['width'] * 0.85
    start_y = host_box['y'] + host_box['height'] * 0.2
    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    await page.mouse.move(start_x + 70, start_y + 40, steps=8)
    await page.mouse.up()
    await page.wait_for_function('(arg) => JSON.parse(localStorage.getItem(arg.key)).architectureScene.elements.some(item => item.id === arg.id && (item.x !== arg.x || item.y !== arg.y))', arg={'key': DRAFT, 'id': host_id, 'x': host_before['x'], 'y': host_before['y']})
    moved = await document(page)
    arrow_after = next(item for item in moved['architectureScene']['elements'] if item['id'] == arrow['id'])
    assert arrow_after['startBinding']['elementId'] == host_id
    assert arrow_after['endBinding']['elementId'] == arrow_before['endBinding']['elementId']
    assert (arrow_after['x'], arrow_after['y'], arrow_after['points']) != (arrow_before['x'], arrow_before['y'], arrow_before['points'])
    assert moved['edges'] == before['edges'] and len(moved['nodes']) == len(before['nodes'])
    for original_node, current_node in zip(before['nodes'], moved['nodes']):
        assert {key: value for key, value in current_node.items() if key != 'data'} == {key: value for key, value in original_node.items() if key != 'data'}
        assert all(current_node['data'][key] == value for key, value in original_node['data'].items())
    moved_by_id = {item['id']: item for item in moved['architectureScene']['elements']}
    for identifier, original in old_by_id.items():
        retained = moved_by_id[identifier]
        assert all(retained[key] == value for key, value in original.items())
        assert set(retained) - set(original) <= {'boundElements'}
        if 'boundElements' not in original:
            assert retained.get('boundElements') is None
    assert moved['architectureScene']['files'] == before['architectureScene']['files']
    await screenshot(page, '11-edited-bound-drawing.png')
    assert not errors, errors
    checks.extend(['explicit Draw target leaves Flowchart unchanged before Insert', 'native SVG preview and refine preserve captured Draw output', 'native presentation preserves the unsent refinement prompt on exit', 'request context omits private drawing and image bytes', 'native text, free line, shape labels, and bound arrow are editable scene records', 'existing graph, native records, and asset bytes survive exactly', 'one Undo and Redo, reload, and exported JSON preserve the document', 'editing a generated bound label and dragging its host reroutes the bound arrow while preserving old content'])
    await context.close()


async def cancelled_request(browser, url, checks):
    context, page = await seed_page(browser, url, fixture)
    errors = []
    completed = asyncio.Event()
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def delayed(route):
        await asyncio.sleep(0.6)
        try:
            await route.fulfill(status=200, content_type='application/json', body=json.dumps(response(draw_proposal)))
        except PlaywrightError:
            pass
        finally:
            completed.set()

    await page.route('**/api/chat', delayed)
    before = await document(page)
    dialog = await open_full(page)
    await (await selector(dialog)).select_option('draw')
    prompt = 'Sketch the delayed drawing.'
    await dialog.locator('textarea.ai-bubble-input').fill(prompt)
    async with page.expect_request(lambda request: request.url.endswith('/api/chat') and request.method == 'POST'):
        await dialog.locator('button.ai-bubble-send').click()
    await dialog.get_by_role('button', name='Close').click()
    await dialog.wait_for(state='hidden')
    await asyncio.wait_for(completed.wait(), timeout=3)
    assert await page.get_by_role('dialog', name='Preview AI Proposal').count() == 0
    assert await document(page) == before
    reopened = await open_full(page)
    assert await reopened.locator('textarea.ai-bubble-input').input_value() == prompt
    assert not errors, errors
    checks.append('closing a pending request discards its late reply and retains the typed prompt')
    await context.close()


async def cancelled_welcome_request(browser, url, checks):
    empty = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {'version': 1, 'elements': [], 'files': {}}}
    context, page = await seed_page(browser, url, empty)
    completed = asyncio.Event()

    async def delayed(route):
        await asyncio.sleep(0.6)
        try:
            await route.fulfill(status=200, content_type='application/json', body=json.dumps(response(draw_proposal)))
        except PlaywrightError:
            pass
        finally:
            completed.set()

    await page.route('**/api/chat', delayed)
    welcome = page.get_by_role('dialog', name='FlowChart')
    await welcome.wait_for()
    assert await (await selector(welcome)).input_value() == 'draw'
    prompt = 'A workshop sketch from the welcome prompt.'
    await welcome.locator('textarea.ai-bubble-input').fill(prompt)
    async with page.expect_request(lambda request: request.url.endswith('/api/chat') and request.method == 'POST'):
        await welcome.locator('button.ai-bubble-send').click()
    await welcome.get_by_role('button', name='Close').click()
    await welcome.wait_for(state='hidden')
    await asyncio.wait_for(completed.wait(), timeout=3)
    assert await page.get_by_role('dialog', name='Preview AI Proposal').count() == 0
    full = await open_full(page)
    assert await (await selector(full)).input_value() == 'draw'
    assert await full.locator('textarea.ai-bubble-input').input_value() == prompt
    await screenshot(page, '10-cancelled-welcome-prompt-retained.png')
    checks.append('closing a pending welcome request retains its text in the full prompt and discards its late reply')
    await context.close()


async def light_preview(browser, url, checks):
    context, page = await seed_page(browser, url, fixture, light=True)

    async def stub(route):
        await route.fulfill(status=200, content_type='application/json', body=json.dumps(response(draw_proposal)))

    await page.route('**/api/chat', stub)
    dialog = await open_full(page)
    await (await selector(dialog)).select_option('draw')
    await screenshot(page, '08-cross-target-draw-light.png')
    await dialog.locator('textarea.ai-bubble-input').fill('Sketch a workshop plan.')
    await dialog.locator('button.ai-bubble-send').click()
    preview = page.get_by_role('dialog', name='Preview AI Proposal')
    await preview.wait_for(timeout=20000)
    assert await preview.get_by_text('Standalone sticky note').count() > 0
    await screenshot(page, '09-native-draw-preview-light.png')
    checks.append('native Draw preview renders in the light theme')
    await context.close()


async def live_flow(browser, url, checks):
    context, page = await seed_page(browser, url, fixture)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    before = await document(page)
    dialog = await open_full(page)
    await (await selector(dialog)).select_option('draw')
    await screenshot(page, '10-live-cross-target-draw.png')
    await dialog.locator('textarea.ai-bubble-input').fill('Draw an editable workshop plan with two labeled shapes, a separate note, a free line, and an arrow connecting the shapes.')
    async with page.expect_response(lambda item: item.url.endswith('/api/chat') and item.request.method == 'POST', timeout=120000) as response_info:
        await dialog.locator('button.ai-bubble-send').click()
    api_response = await response_info.value
    assert api_response.status == 200, f'Live API returned HTTP {api_response.status}'
    body = await api_response.json()
    proposal = json.loads(body['message'])
    assert proposal['outputMode'] == 'draw' and proposal['elements']
    preview = page.get_by_role('dialog', name='Preview AI Proposal')
    await preview.wait_for(timeout=20000)
    assert await document(page) == before
    await screenshot(page, '11-live-native-draw-preview.png')
    await preview.get_by_role('button', name='Insert into Canvas').click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).mode === "draw"', arg=DRAFT)
    after = await document(page)
    assert after['nodes'] == before['nodes'] and after['edges'] == before['edges']
    originals = {item['id']: item for item in before['architectureScene']['elements']}
    applied = {item['id']: item for item in after['architectureScene']['elements']}
    assert all(applied[identifier] == item for identifier, item in originals.items())
    assert after['architectureScene']['files'] == before['architectureScene']['files']
    assert len(applied) > len(originals)
    await screenshot(page, '12-live-native-draw-inserted.png')
    assert not errors, errors
    checks.extend(['live local API returned a native Draw proposal', 'live native preview left the document unchanged', 'live insertion retained the graph, authored drawing, and embedded image bytes'])
    await context.close()


async def baseline(browser, url, checks):
    original = {**fixture, 'mode': 'draw'}
    context, page = await seed_page(browser, url, original)
    dialog = await open_full(page)
    assert await dialog.get_by_role('combobox', name='Generate for').count() == 0
    await screenshot(page, '00-before-draw-ai.png')
    checks.append('the old Draw prompt has no output selector')
    await context.close()


async def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    earlier = Path('/workspace/scratch/ai-board-modes/00-before-draw-ai.png')
    if earlier.exists() and not (OUTPUT / earlier.name).exists():
        (OUTPUT / earlier.name).write_bytes(earlier.read_bytes())
    checks = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        try:
            if args.baseline:
                await baseline(browser, args.url, checks)
            elif args.live:
                await live_flow(browser, args.url, checks)
            else:
                await default_modes(browser, args.url, checks)
                await main_flow(browser, args.url, checks)
                await light_preview(browser, args.url, checks)
                await cancelled_request(browser, args.url, checks)
                await cancelled_welcome_request(browser, args.url, checks)
        finally:
            await browser.close()
    names = sorted(path.name for path in OUTPUT.glob('*.png'))
    if args.baseline:
        names = [name for name in names if name.startswith('00-')]
    elif args.live:
        names = [name for name in names if '-live-' in name]
    else:
        names = [name for name in names if not name.startswith('00-') and '-live-' not in name]
    report = {'provider': 'old app baseline' if args.baseline else 'configured local API' if args.live else 'browser route stub', 'checks': checks, 'screenshots': names}
    if not args.baseline and not args.live:
        report['retainedContentAfterNativeEdit'] = 'The existing Draw bridge adds graph snapshot mirror fields and null boundElements during any Draw edit. The verifier checks every original graph and native field and the exact asset bytes after editing.'
    report_name = 'verification-baseline.json' if args.baseline else 'verification-live.json' if args.live else 'verification-stub.json'
    (OUTPUT / report_name).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


asyncio.run(run())
