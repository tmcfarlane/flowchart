import argparse
import asyncio
import json
import math
from pathlib import Path

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
DRAFT = 'flowchart-editor-draft-v3'
parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3055/')
parser.add_argument('--baseline', action='store_true')
parser.add_argument('--live', action='store_true')
parser.add_argument('--proposal', type=Path)
parser.add_argument('--horizontal', choices=['before', 'after'])
parser.add_argument('--output', type=Path, default=ROOT / 'docs/screenshots/draw-generation-layout')
args = parser.parse_args()

labels = [
    '1. Prepare tonight\n\nChoose a bedtime and put your alarm across the room.',
    '2. Keep a steady time\n\nWake at a similar time each day, including weekends.',
    '3. Get out of bed\n\nWhen the alarm rings, stand up. Skip the snooze button.',
    '4. Find bright light\n\nOpen the curtains or step outside. Have a glass of water.',
    '5. Move, then begin\n\nStretch or walk for 5 minutes. Start with one easy task.',
]
fills = ['#e7f1f5', '#e7f4ef', '#f7efdf', '#f2e9f5', '#eaf0fa']
elements = [
    {'id': 'title', 'type': 'text', 'x': 0, 'y': 0, 'text': 'A gentler way to wake up', 'fontSize': 32, 'strokeColor': '#123456'},
    {'id': 'subtitle', 'type': 'text', 'x': 0, 'y': 55, 'text': 'Make mornings easier with a few small, repeatable habits.', 'fontSize': 18, 'strokeColor': '#123456'},
]
for index, label in enumerate(labels):
    elements.append({'id': f'card-{index}', 'type': 'rectangle', 'x': index * 200, 'y': 150, 'width': 180, 'height': 210, 'label': label, 'strokeColor': '#334155', 'backgroundColor': fills[index]})
    if index:
        elements.append({'id': f'arrow-{index}', 'type': 'arrow', 'points': [{'x': index * 200 - 20, 'y': 255}, {'x': index * 200, 'y': 255}], 'sourceId': f'card-{index - 1}', 'targetId': f'card-{index}', 'label': '', 'strokeColor': '#64748b'})
elements.append({'id': 'note', 'type': 'rectangle', 'x': 90, 'y': 400, 'width': 800, 'height': 90, 'label': 'If mornings feel especially hard, shift bedtime earlier in small steps and make sure you are getting enough sleep.', 'strokeColor': '#334155', 'backgroundColor': '#f1f5f9'})
fixture_proposal = {'outputMode': 'draw', 'summary': 'Five small habits for gentler mornings.', 'elements': elements}
if args.proposal:
    fixture_proposal = json.loads(args.proposal.read_text())
empty = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {'version': 1, 'elements': [], 'files': {}}}


async def document(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def capture(page, name):
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.screenshot(path=str(args.output / name), animations='disabled')


def scene_checks(scene, baseline):
    records = {item['id']: item for item in scene['elements']}
    broken = []
    fitted = []
    arrow_lengths = []
    shape_gaps = []
    for item in records.values():
        if item['type'] == 'text' and item.get('containerId'):
            source = item.get('originalText', item['text'])
            if item['text'].split() != source.split():
                broken.append({'source': source, 'display': item['text']})
            host = records[item['containerId']]
            if host['type'] == 'rectangle':
                assert item['x'] >= host['x'] and item['y'] >= host['y'], item
                assert item['x'] + item['width'] <= host['x'] + host['width'] + 0.01, item
                assert item['y'] + item['height'] <= host['y'] + host['height'] + 0.01, item
                fitted.append(item['id'])
        if item['type'] == 'arrow' and item.get('startBinding') and item.get('endBinding'):
            arrow_lengths.append(sum(math.dist(a, b) for a, b in zip(item['points'], item['points'][1:])))
            left, right = records[item['startBinding']['elementId']], records[item['endBinding']['elementId']]
            dx = max(left['x'] - right['x'] - right['width'], right['x'] - left['x'] - left['width'], 0)
            dy = max(left['y'] - right['y'] - right['height'], right['y'] - left['y'] - left['height'], 0)
            shape_gaps.append(math.hypot(dx, dy))
    if baseline:
        assert broken, 'Baseline did not reproduce mid-word line breaks'
    else:
        assert not broken, f'Ordinary words split across lines: {broken}'
    assert fitted, 'No bound rectangle label was checked'
    assert arrow_lengths, 'No connected arrow was checked'
    return {'broken_labels': broken, 'fitted_label_count': len(fitted), 'arrow_lengths': arrow_lengths, 'connected_shape_gaps': shape_gaps}


async def run():
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'url': args.url, 'baseline': args.baseline, 'live': args.live, 'horizontal': args.horizontal, 'checks': []}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        try:
            context = await browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
            page = await context.new_page()
            await page.add_init_script('if (!localStorage.getItem(' + json.dumps(DRAFT) + ')) localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(empty)) + ')')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            if not args.live:
                async def stub(route):
                    await route.fulfill(status=200, content_type='application/json', body=json.dumps({'role': 'assistant', 'finishReason': 'stop', 'message': json.dumps(fixture_proposal)}))
                await page.route('**/api/chat', stub)
            await page.goto(args.url, wait_until='networkidle')
            before = await document(page)
            dismiss = page.get_by_role('button', name='No, thank you')
            if await dismiss.count():
                await dismiss.click()
            await page.get_by_role('button', name='Open AI Assistant').click()
            dialog = page.get_by_role('dialog', name='FlowChart')
            await dialog.wait_for()
            await dialog.get_by_role('combobox', name='Generate for').select_option('draw')
            prompt = 'Create a Draw board titled "A gentler way to wake up". Show five rectangular pastel habit cards in one left-to-right row connected by arrows. The steps are prepare tonight, keep a steady time, get out of bed, find bright light, and move then begin. Give each card a short heading and two sentences of practical advice, including opening the curtains and keeping a bedtime. Add one helpful note below the row.'
            await dialog.locator('textarea.ai-bubble-input').fill(prompt)
            async with page.expect_response(lambda response: response.url.endswith('/api/chat') and response.request.method == 'POST', timeout=120000) as response_info:
                await dialog.locator('button.ai-bubble-send').click()
            response = await response_info.value
            assert response.status == 200, f'AI API HTTP {response.status}: {await response.text()}'
            report['http_status'] = response.status
            report['request_id'] = response.headers.get('x-request-id')
            payload = await response.json()
            proposal = json.loads(payload['message'])
            assert proposal['outputMode'] == 'draw'
            (args.output / ('live-proposal.json' if args.live else 'fixture-proposal.json')).write_text(json.dumps(proposal, indent=2) + '\n')
            preview = page.get_by_role('dialog', name='Preview AI Proposal')
            await preview.wait_for(timeout=20000)
            assert await document(page) == before
            prefix = f'horizontal-{args.horizontal}' if args.horizontal else '00-before' if args.baseline else 'live' if args.live else 'after'
            await capture(page, f'{prefix}-preview-dark.png')
            await preview.get_by_role('button', name='Insert into Canvas').click()
            await preview.wait_for(state='hidden')
            await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length > 0', arg=DRAFT)
            after = await document(page)
            report.update(scene_checks(after['architectureScene'], args.baseline))
            if args.horizontal:
                arrows = [item for item in after['architectureScene']['elements'] if item['type'] == 'arrow' and item.get('startBinding') and item.get('endBinding')]
                offsets = [item['points'][-1][1] - item['points'][0][1] for item in arrows]
                report['arrow_vertical_offsets'] = offsets
                assert arrows and all(len(item['points']) == 2 for item in arrows)
                if args.horizontal == 'before':
                    assert any(abs(offset) > 0.001 for offset in offsets), offsets
                else:
                    assert all(abs(offset) < 0.000001 for offset in offsets), offsets
                    assert all(item['points'][-1][0] > item['points'][0][0] for item in arrows)
                    report['checks'].append('every connected row arrow is a straight horizontal left-to-right segment')
            report['checks'].extend(['preview leaves document unchanged', 'bound labels fit their rectangular hosts', 'insert creates editable native Draw records'])
            if args.live:
                assert len(report['arrow_lengths']) >= 4, report
                assert min(report['arrow_lengths']) >= 96, report
                assert min(report['connected_shape_gaps']) >= 96, report
                report['checks'].append('live model leaves at least 96 world pixels for every connected card gap and arrow')
            elif not args.baseline and not args.proposal:
                by_source = {item.get('originalText'): item for item in after['architectureScene']['elements'] if item['type'] == 'text'}
                assert all('\n\n' in by_source[label]['text'] for label in labels)
                report['checks'].append('fixture keeps complete words and explicit blank paragraphs')
            canvas = page.get_by_label('Draw canvas', exact=True)
            await canvas.focus()
            await page.keyboard.press('Shift+Digit1')
            await page.keyboard.press('Alt+z')
            await page.locator('.draw-zen').wait_for()
            await capture(page, f'{prefix}-board-dark.png')
            await page.get_by_role('button', name='Toggle Dark Mode').click()
            await capture(page, f'{prefix}-board-light.png')
            await page.get_by_role('button', name='Undo', exact=True).click()
            await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length === 0', arg=DRAFT)
            assert await document(page) == before
            await page.get_by_role('button', name='Redo', exact=True).click()
            await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length > 0', arg=DRAFT)
            assert await document(page) == after
            await page.reload(wait_until='networkidle')
            assert await document(page) == after
            await page.get_by_role('button', name='Export', exact=True).click()
            async with page.expect_download() as download_info:
                await page.get_by_role('button', name='Export as JSON', exact=True).click()
            download = await download_info.value
            export_file = args.output / f'{prefix}-export.json'
            await download.save_as(str(export_file))
            assert json.loads(export_file.read_text())['architectureScene'] == after['architectureScene']
            report['checks'].append('one undo, redo, reload, and JSON export preserve the inserted scene')
            assert not errors, errors
            report['checks'].append('no browser page errors')
            report['provider'] = {key: payload[key] for key in ('model', 'usage', 'requestId') if key in payload}
            await context.close()
        finally:
            await browser.close()
    report_file = args.output / (f'verification-horizontal-{args.horizontal}.json' if args.horizontal else 'verification-before.json' if args.baseline else 'verification-live.json' if args.live else 'verification-after.json')
    report_file.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


asyncio.run(run())
