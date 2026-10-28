import argparse
import asyncio
import json
import math
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
DRAFT = 'flowchart-editor-draft-v3'
parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3057/')
parser.add_argument('--live', action='store_true')
parser.add_argument('--proposal', type=Path)
parser.add_argument('--output', type=Path, default=ROOT / 'docs/screenshots/ai-draw-tools')
args = parser.parse_args()

fixture = {
    'outputMode': 'draw', 'summary': 'Explore an idea, make a decision, and run a small test.',
    'elements': [
        {'id': 'title', 'type': 'text', 'x': 60, 'y': 20, 'text': 'From an idea to a small experiment', 'fontSize': 30, 'strokeColor': '#123456'},
        {'id': 'topic', 'type': 'ellipse', 'x': 110, 'y': 200, 'width': 220, 'height': 100, 'label': 'Understand the need', 'strokeColor': '#0f766e', 'backgroundColor': '#d8f3e8'},
        {'id': 'note', 'type': 'text', 'x': 90, 'y': 350, 'text': 'Talk to a few people.\nCapture their strongest need.', 'fontSize': 18, 'strokeColor': '#123456'},
        {'id': 'divider', 'type': 'line', 'points': [{'x': 80, 'y': 320}, {'x': 450, 'y': 320}], 'sourceId': None, 'targetId': None, 'label': '', 'strokeColor': '#64748b'},
        {'id': 'underline', 'type': 'freedraw', 'points': [{'x': 95, 'y': 408}, {'x': 145, 'y': 413}, {'x': 200, 'y': 405}, {'x': 250, 'y': 411}, {'x': 310, 'y': 406}], 'sourceId': None, 'targetId': None, 'label': '', 'strokeColor': '#d97706'},
        {'id': 'problem', 'type': 'rectangle', 'x': 90, 'y': 450, 'width': 300, 'height': 40, 'label': 'Write one clear problem statement that is specific enough to test with a small group of people.', 'strokeColor': '#2563eb', 'backgroundColor': '#e0ecff'},
        {'id': 'decision', 'type': 'diamond', 'x': 760, 'y': 230, 'width': 160, 'height': 120, 'label': 'Ready to test?', 'strokeColor': '#8b5b17', 'backgroundColor': '#fff1c1'},
        {'id': 'test', 'type': 'rectangle', 'x': 1240, 'y': 245, 'width': 210, 'height': 90, 'label': 'Try one small test', 'strokeColor': '#7c3aed', 'backgroundColor': '#eee3ff'},
        {'id': 'cross', 'type': 'arrow', 'points': [{'x': 330, 'y': 260}, {'x': 760, 'y': 260}], 'sourceId': 'topic', 'targetId': 'decision', 'label': 'Explore before deciding', 'strokeColor': '#64748b'},
        {'id': 'handoff', 'type': 'arrow', 'points': [{'x': 920, 'y': 290}, {'x': 1240, 'y': 290}], 'sourceId': 'decision', 'targetId': 'test', 'label': 'Test', 'strokeColor': '#64748b'},
        {'id': 'explore', 'type': 'frame', 'x': 40, 'y': 130, 'width': 420, 'height': 440, 'name': 'Explore the idea', 'children': ['topic', 'note', 'divider', 'underline', 'problem']},
        {'id': 'act', 'type': 'frame', 'x': 700, 'y': 130, 'width': 800, 'height': 440, 'name': 'Decide and act', 'children': ['decision', 'test', 'handoff']},
    ],
}
empty = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {'version': 1, 'elements': [], 'files': {}}}
if args.proposal:
    fixture = json.loads(args.proposal.read_text())


async def document(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def wait_document(page, value):
    await page.wait_for_function('([key, expected]) => JSON.stringify(JSON.parse(localStorage.getItem(key))) === JSON.stringify(expected)', arg=[DRAFT, value])


async def point(page, x, y):
    return await page.locator('[data-drawing-layer]').evaluate('(g,p) => { const q = new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM()); return {x:q.x,y:q.y} }', {'x': x, 'y': y})


async def capture(page, path):
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.screenshot(path=str(path), animations='disabled')


def bounds(item):
    points = item.get('points') or [[0, 0], [item['width'], 0], [item['width'], item['height']], [0, item['height']]]
    xs, ys = [point[0] for point in points], [point[1] for point in points]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    cosine, sine = math.cos(item.get('angle', 0)), math.sin(item.get('angle', 0))
    world = [(item['x'] + cx + (x - cx) * cosine - (y - cy) * sine, item['y'] + cy + (x - cx) * sine + (y - cy) * cosine) for x, y in points]
    return min(point[0] for point in world), min(point[1] for point in world), max(point[0] for point in world), max(point[1] for point in world)


def check_scene(scene, proposal):
    records = {item['id']: item for item in scene['elements']}
    counts = dict(Counter(item['type'] for item in records.values()))
    expected = Counter(item['type'] for item in proposal['elements'])
    assert all(counts.get(kind, 0) >= count for kind, count in expected.items()), (counts, expected)
    if not args.live:
        assert set(counts) == {'rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow', 'freedraw', 'frame'}, counts
    else:
        assert counts.get('frame', 0) and counts.get('text', 0), counts
        assert len(set(counts) & {'ellipse', 'diamond', 'line', 'freedraw'}) >= 2, counts
    frames = [item for item in records.values() if item['type'] == 'frame']
    assert frames, 'No native frame was inserted'
    members = 0
    for item in records.values():
        if item.get('frameId'):
            frame = records[item['frameId']]
            assert frame['type'] == 'frame', item
            left, top, right, bottom = bounds(item)
            assert left >= frame['x'] - 0.001 and top >= frame['y'] - 0.001, item
            assert right <= frame['x'] + frame['width'] + 0.001, item
            assert bottom <= frame['y'] + frame['height'] + 0.001, item
            members += 1
        if item['type'] == 'text' and item.get('containerId'):
            host = records[item['containerId']]
            assert item.get('frameId') == host.get('frameId'), item
            assert item['text'].split() == item.get('originalText', item['text']).split(), item
        for key in ('startBinding', 'endBinding'):
            if item.get(key):
                assert records[item[key]['elementId']]['type'] in ('rectangle', 'ellipse', 'diamond'), item
    assert members, 'Frames have no native member records'
    if not args.live and not args.proposal:
        cross_label = next(item for item in records.values() if item.get('originalText') == 'Explore before deciding')
        cross = records[cross_label['containerId']]
        assert not cross.get('frameId')
        assert records[cross['startBinding']['elementId']]['frameId'] != records[cross['endBinding']['elementId']]['frameId']
        problem_label = next(item for item in records.values() if item.get('originalText', '').startswith('Write one clear problem'))
        assert records[problem_label['containerId']]['height'] > 40
    return {'native_type_counts': counts, 'frame_count': len(frames), 'frame_member_count': members}


async def palette(dialog, visible=True):
    hint = dialog.get_by_label('AI Draw tools', exact=True)
    if not visible:
        assert await hint.count() == 0
        return
    await hint.wait_for()
    text = (await hint.inner_text()).lower()
    for names in [('rectangle',), ('circle', 'ellipse'), ('diamond',), ('line',), ('arrow',), ('pen', 'freehand'), ('text',), ('frame',)]:
        assert any(name in text for name in names), text


async def compact_prompts(browser, checks):
    context = await browser.new_context(viewport={'width': 390, 'height': 667})
    page = await context.new_page()
    await page.add_init_script('localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(empty)) + ')')
    await page.goto(args.url, wait_until='networkidle')
    welcome = page.get_by_role('dialog', name='FlowChart')
    await palette(welcome)
    for selector in ('.ai-welcome-prompt', '.ai-welcome-prompt .ai-bubble-header'):
        box = await page.locator(selector).bounding_box()
        assert box and box['y'] >= 0 and box['y'] + box['height'] <= 667.01, (selector, box)
    dismiss = welcome.get_by_role('button', name='No, thank you')
    await dismiss.scroll_into_view_if_needed()
    box = await dismiss.bounding_box()
    assert box and box['y'] >= 0 and box['y'] + box['height'] <= 667.01, box
    await capture(page, args.output / 'fixture-mobile-welcome.png')
    await dismiss.click()
    await page.get_by_role('button', name='Open AI Assistant').click()
    dialog = page.get_by_role('dialog', name='FlowChart')
    await palette(dialog)
    for selector in ('.ai-bubble-prompt', '.ai-bubble-prompt .ai-bubble-header'):
        box = await page.locator(selector).bounding_box()
        assert box and box['y'] >= 0 and box['y'] + box['height'] <= 667.01, (selector, box)
    field = dialog.locator('textarea.ai-bubble-input')
    await field.scroll_into_view_if_needed()
    await field.fill('Keep the mobile drawing prompt editable')
    assert await field.input_value() == 'Keep the mobile drawing prompt editable'
    submit = dialog.get_by_role('button', name='Generate drawing')
    await submit.scroll_into_view_if_needed()
    box = await submit.bounding_box()
    assert box and box['y'] >= 0 and box['y'] + box['height'] <= 667.01, box
    assert await submit.is_enabled()
    assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    await capture(page, args.output / 'fixture-mobile-full.png')
    await dialog.get_by_role('button', name='Close', exact=True).scroll_into_view_if_needed()
    await dialog.get_by_role('button', name='Close', exact=True).click()
    await dialog.wait_for(state='hidden')
    await context.close()
    checks.append('390 by 667 welcome and full prompts keep headers, tool help, dismissal, input, and submit reachable without horizontal overflow')


async def native_edits(page, after, checks):
    scene = after['architectureScene']['elements']
    line = next((item for item in scene if item['type'] == 'line'), None)
    if line:
        start, end = line['points'][0], line['points'][-1]
        position = await point(page, line['x'] + (start[0] + end[0]) / 2, line['y'] + (start[1] + end[1]) / 2)
        await page.get_by_label('Draw canvas', exact=True).focus()
        await page.keyboard.press('v')
        await page.mouse.click(position['x'], position['y'])
        await page.locator(f'[data-element-id="{line["id"]}"][data-selected="true"]').wait_for(state='attached')
        await page.get_by_role('combobox', name='Stroke style', exact=True).select_option('dashed')
        await page.wait_for_function('([key,id]) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id===id).strokeStyle === "dashed"', arg=[DRAFT, line['id']])
        await page.get_by_role('button', name='Undo', exact=True).click()
        await wait_document(page, after)
        checks.append('generated line accepts a native property edit and undo')
    frame = next(item for item in scene if item['type'] == 'frame' and any(member.get('frameId') == item['id'] for member in scene))
    start = await point(page, frame['x'] + frame['width'] * 0.45, frame['y'])
    end = await point(page, frame['x'] + frame['width'] * 0.45 + 40, frame['y'] + 20)
    await page.get_by_label('Draw canvas', exact=True).focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('v')
    await page.mouse.move(start['x'], start['y'])
    await page.mouse.down()
    await page.mouse.move(end['x'], end['y'], steps=12)
    await page.mouse.up()
    await page.wait_for_function('([key,id,x,y]) => { const f=JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id===id);return f.x !== x || f.y !== y }', arg=[DRAFT, frame['id'], frame['x'], frame['y']])
    moved = {item['id']: item for item in (await document(page))['architectureScene']['elements']}
    original = {item['id']: item for item in scene}
    externally_bound = {item['id'] for item in scene if item['type'] == 'arrow' and item.get('frameId') == frame['id'] and any(item.get(key) and original[item[key]['elementId']].get('frameId') != frame['id'] for key in ('startBinding', 'endBinding'))}
    dx, dy = moved[frame['id']]['x'] - frame['x'], moved[frame['id']]['y'] - frame['y']
    for item in scene:
        if item.get('frameId') == frame['id'] and item['id'] not in externally_bound and item.get('containerId') not in externally_bound:
            assert abs(moved[item['id']]['x'] - item['x'] - dx) < 0.001, item
            assert abs(moved[item['id']]['y'] - item['y'] - dy) < 0.001, item
        for key in ('startBinding', 'endBinding'):
            if item.get(key):
                assert moved[item['id']][key]['elementId'] == item[key]['elementId']
        if item['type'] == 'frame' and item['id'] != frame['id']:
            assert moved[item['id']] == item
    await page.get_by_role('button', name='Undo', exact=True).click()
    await wait_document(page, after)
    checks.append('dragging a generated frame moves its members once, preserves the other frame, and undoes atomically')


async def run():
    args.output.mkdir(parents=True, exist_ok=True)
    prefix = 'live' if args.live else 'replay' if args.proposal else 'fixture'
    report = {'url': args.url, 'live': args.live, 'source_proposal': str(args.proposal) if args.proposal else None, 'checks': []}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        try:
            if not args.live and not args.proposal:
                await compact_prompts(browser, report['checks'])
            context = await browser.new_context(viewport={'width': 1680, 'height': 1100}, accept_downloads=True)
            page = await context.new_page()
            await page.add_init_script('if (!localStorage.getItem(' + json.dumps(DRAFT) + ')) localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(empty)) + ')')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if not args.live:
                async def stub(route):
                    await route.fulfill(status=200, content_type='application/json', body=json.dumps({'role': 'assistant', 'finishReason': 'stop', 'message': json.dumps(fixture)}))
                await page.route('**/api/chat', stub)
            await page.goto(args.url, wait_until='networkidle')
            welcome = page.get_by_role('dialog', name='FlowChart')
            await palette(welcome)
            await capture(page, args.output / f'{prefix}-welcome-tools.png')
            await page.get_by_role('button', name='No, thank you').click()
            await page.get_by_role('button', name='Open AI Assistant').click()
            dialog = page.get_by_role('dialog', name='FlowChart')
            await palette(dialog)
            await dialog.get_by_role('combobox', name='Generate for').select_option('flowchart')
            await palette(dialog, visible=False)
            await dialog.get_by_role('combobox', name='Generate for').select_option('draw')
            await palette(dialog)
            await capture(page, args.output / f'{prefix}-prompt-tools.png')
            report['checks'].append('eight supported tools appear in welcome and full Draw prompts, and stay hidden for Flowchart')
            before = await document(page)
            prompt = 'Sketch a product-launch workshop whiteboard in two titled frames, Explore and Decide. Use circular brainstorming topics, a diamond for a readiness decision, an actual line divider, a simple pen-stroke emphasis, standalone notes, arrows, and one action card. Keep cross-frame arrows outside the frames and give the drawing room to breathe.'
            await dialog.locator('textarea.ai-bubble-input').fill(prompt)
            async with page.expect_response(lambda response: response.url.endswith('/api/chat') and response.request.method == 'POST', timeout=120000) as response_info:
                await dialog.locator('button.ai-bubble-send').click()
            response = await response_info.value
            assert response.status == 200, f'AI API HTTP {response.status}: {await response.text()}'
            report['http_status'] = response.status
            report['request_id'] = response.headers.get('x-request-id')
            proposal = json.loads((await response.json())['message'])
            assert proposal['outputMode'] == 'draw'
            (args.output / f'{prefix}-proposal.json').write_text(json.dumps(proposal, indent=2) + '\n')
            preview = page.get_by_role('dialog', name='Preview AI Proposal')
            await preview.wait_for(timeout=20000)
            assert await document(page) == before
            for frame in [item for item in proposal['elements'] if item['type'] == 'frame']:
                assert await preview.get_by_text(frame['name'], exact=True).count()
            await capture(page, args.output / f'{prefix}-preview-dark.png')
            await preview.get_by_role('button', name='Insert into Canvas').click()
            await preview.wait_for(state='hidden')
            await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length > 0', arg=DRAFT)
            after = await document(page)
            report.update(check_scene(after['architectureScene'], proposal))
            report['checks'].extend(['preview leaves document unchanged and renders native frame titles', 'all requested native tool types and frame membership survive insertion', 'fitted labels remain whole and inside their frames'])
            await page.get_by_role('button', name='Undo', exact=True).click()
            await wait_document(page, before)
            await page.get_by_role('button', name='Redo', exact=True).click()
            await wait_document(page, after)
            report['checks'].append('one undo and redo retain the whole generated scene')
            canvas = page.get_by_label('Draw canvas', exact=True)
            await canvas.focus()
            await page.keyboard.press('Shift+Digit1')
            await native_edits(page, after, report['checks'])
            await canvas.focus()
            await page.keyboard.press('Escape')
            await page.keyboard.press('Alt+z')
            await page.locator('.draw-zen').wait_for()
            await capture(page, args.output / f'{prefix}-board-dark.png')
            await page.get_by_role('button', name='Toggle Dark Mode').click()
            await capture(page, args.output / f'{prefix}-board-light.png')
            await page.reload(wait_until='networkidle')
            await wait_document(page, after)
            report['checks'].append('reload retains native tools, geometry, and frame links')
            for label, suffix in [('Export as JSON', 'json'), ('Export as SVG', 'svg')]:
                await page.get_by_role('button', name='Export', exact=True).click()
                async with page.expect_download() as download_info:
                    await page.get_by_role('button', name=label, exact=True).click()
                await (await download_info.value).save_as(str(args.output / f'{prefix}-export.{suffix}'))
            exported = json.loads((args.output / f'{prefix}-export.json').read_text())
            assert exported['architectureScene'] == after['architectureScene']
            svg = ElementTree.fromstring((args.output / f'{prefix}-export.svg').read_text())
            rendered_types = Counter(item.attrib['data-element-type'] for item in svg.iter() if 'data-element-type' in item.attrib)
            assert dict(rendered_types) == report['native_type_counts'], rendered_types
            svg_text = ''.join(svg.itertext())
            assert all(frame['name'] in svg_text for frame in proposal['elements'] if frame['type'] == 'frame')
            assert any(item.tag.endswith('clipPath') for item in svg.iter())
            report['checks'].append('JSON export retains the exact scene; SVG includes every native type, frame title, and clipping definitions')
            svg_page = await context.new_page()
            await svg_page.set_content((args.output / f'{prefix}-export.svg').read_text())
            await svg_page.locator('svg').screenshot(path=str(args.output / f'{prefix}-export-rendered.png'))
            await svg_page.close()
            assert not errors, errors
            report['checks'].append('no browser page errors')
            await context.close()
        finally:
            await browser.close()
    (args.output / f'verification-{prefix}.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


asyncio.run(run())
