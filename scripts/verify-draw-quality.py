import argparse
import asyncio
import json
import re
from pathlib import Path
from collections import Counter

from playwright.async_api import async_playwright

from draw_quality_geometry import bounds, connector_crossings, geometry_equivalent, marker_crossings, marker_negative_control, native_references, segment_hits_box, shape_collisions, world_points


ROOT = Path(__file__).resolve().parents[1]
DRAFT = 'flowchart-editor-draft-v3'
CAPTURED = ROOT / 'docs/screenshots/ai-draw-tools/live-export.json'
PROPOSAL = ROOT / 'docs/screenshots/ai-draw-tools/live-proposal.json'
EMPTY = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {'version': 1, 'elements': [], 'files': {}}}
PROMPTS = {
    'captured': 'Reproduce the captured product-launch workshop drawing with its requested pen emphasis and cross-frame handoff.',
    'morning': 'Create a calm, practical morning routine to help someone wake up and start their day. Make it easy to read and follow.',
    'workshop': 'Plan a product-launch workshop covering exploration, a readiness decision, final launch actions, and the handoff to decision makers. Make the whiteboard clear enough to present to the team.',
}


def luminance(color):
    if color.startswith('#'):
        raw = color[1:]
        raw = ''.join(value * 2 for value in raw) if len(raw) == 3 else raw
        channels = [int(raw[index:index+2], 16) / 255 for index in (0, 2, 4)]
    else:
        channels = [float(value) / 255 for value in re.findall(r'[\d.]+', color)[:3]]
    assert len(channels) == 3, color
    linear = [value/12.92 if value <= .04045 else ((value+.055)/1.055)**2.4 for value in channels]
    return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))


async def document(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def wait_document(page, expected):
    await page.wait_for_function('([key, expected]) => JSON.stringify(JSON.parse(localStorage.getItem(key))) === JSON.stringify(expected)', arg=[DRAFT, expected])


async def open_prompt(page):
    dismiss = page.get_by_role('button', name='No, thank you')
    if await dismiss.count():
        await dismiss.click()
    await page.get_by_role('button', name='Open AI Assistant').click()
    dialog = page.get_by_role('dialog', name='FlowChart')
    await dialog.get_by_role('combobox', name='Generate for').select_option('draw')
    return dialog


async def send_prompt(page, dialog, prompt):
    await dialog.locator('textarea.ai-bubble-input').fill(prompt)
    async with page.expect_response(lambda response: response.url.endswith('/api/chat') and response.request.method == 'POST', timeout=120000) as response_info:
        await dialog.locator('button.ai-bubble-send').click()
    return await response_info.value


async def rendered_geometry(scope, scene):
    await scope.page.evaluate('() => document.fonts.ready')
    result = await scope.locator('[data-draw-scene]').evaluate(r'''(scene) => {
      const inverse = scene.getCTM().inverse();
      const geometryNames = ['x','y','width','height','d','cx','cy','rx','ry','points','font-size','font-family','text-anchor','dy'];
      return Array.from(scene.querySelectorAll('[data-element-id]')).map(record => {
        const graphic = record.querySelector('g[transform]');
        const matrix = inverse.multiply(graphic.getCTM());
        const ink = Array.from(record.querySelectorAll('text')).map(text => {
          const b = text.getBBox(), m = inverse.multiply(text.getCTM());
          const p = [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]]
            .map(([x,y]) => new DOMPoint(x,y).matrixTransform(m));
          return {bounds:[Math.min(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.x)),Math.max(...p.map(p=>p.y))],
            font:getComputedStyle(text).fontFamily, fill:getComputedStyle(text).fill, text:text.textContent};
        });
        const geometry = Array.from(record.querySelectorAll('path,rect,text,tspan,ellipse,circle,line,image'))
          .filter(node => !node.closest('defs')).map(node => ({tag:node.tagName,
            attrs:Object.fromEntries(geometryNames.filter(name=>node.hasAttribute(name)).map(name=>[name,node.getAttribute(name)])),
            text:node.tagName==='tspan'?node.textContent:undefined}));
        const paint = Array.from(record.querySelectorAll('path,circle')).flatMap(node => {
          const style = getComputedStyle(node);
          return ['stroke','fill'].filter(name=>style[name]!=='none' && style[name]!=='transparent' && !/^rgba\([^)]*,\s*0\)$/.test(style[name])).map(name=>
            ({part:node.closest('marker')?'marker':'shaft',channel:name,color:style[name],opacity:Number(style.opacity)*Number(style[name+'Opacity'])}));
        });
        return {id:record.dataset.elementId,type:record.dataset.elementType,matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],ink,geometry,paint};
      });
    }''')
    live = [item for item in scene['elements'] if not item.get('isDeleted')]
    by_id = {item['id']: item for item in live}
    assert len(result) == len(live), (len(result), len(live))
    title_boxes = {}
    dark = bool(await scope.page.locator('.app.dark-mode').count())
    for record, item in zip(result, live):
        assert record['id'] == item['id'] and record['type'] == item['type'], (record['id'], item['id'])
        assert abs(item.get('angle', 0)) < .001, 'Generated baseline expects unrotated finalized geometry'
        expected = [1, 0, 0, 1, item['x'], item['y']]
        assert all(abs(a-b) < .01 for a, b in zip(record['matrix'], expected)), (item['id'], record['matrix'], expected)
        if item['type'] in ('arrow', 'line'):
            path = next(part['attrs']['d'] for part in record['geometry'] if part['tag'] == 'path')
            assert not re.search('[ACHQSTVZachqstvz]', path), ('Rendered connector is curved or implicit', item['id'], path)
            numbers = [float(value) for value in re.findall(r'-?\d+(?:\.\d+)?(?:e[+-]?\d+)?', path)]
            native_points = [value for point in item['points'] for value in point]
            assert len(numbers) == len(native_points) and all(abs(a-b) < .01 for a, b in zip(numbers, native_points)), ('Rendered connector differs from backend file', item['id'], numbers, native_points)
        if item['type'] in ('arrow', 'line', 'freedraw'):
            assert record['paint'], ('Path is not painted', item['id'])
            if item['type'] == 'arrow' and (item.get('startArrowhead') or item.get('endArrowhead')):
                assert any(paint['part'] == 'marker' for paint in record['paint']), ('Arrowhead is not painted', item['id'])
            background = luminance('#0f1211' if dark else '#ffffff')
            for paint in record['paint']:
                foreground = luminance(paint['color'])
                ratio = (max(foreground, background)+.05)/(min(foreground, background)+.05)
                assert paint['opacity'] >= .999 and item.get('opacity', 100) == 100, ('Generated connector is translucent', item['id'], paint)
                assert ratio >= 3, ('Rendered connector paint has low contrast', item['id'], paint, ratio)
                paint['contrast'] = ratio
        if item['type'] in ('text', 'frame'):
            assert item.get('customData', {}).get('flowchartFont') == 'noto-sans-v1', ('Missing canonical font marker', item['id'])
            assert len(record['ink']) == 1
            assert 'Flowchart Diagram Sans' in record['ink'][0]['font'], record['ink']
            host = by_id.get(item.get('containerId'))
            surface = host.get('backgroundColor') if host and host['type'] in ('rectangle', 'ellipse', 'diamond') else None
            if not surface or surface == 'transparent':
                surface = '#0f1211' if dark else '#ffffff'
            foreground, backdrop = luminance(record['ink'][0]['fill']), luminance(surface)
            contrast = (max(foreground, backdrop)+.05)/(min(foreground, backdrop)+.05)
            assert contrast >= 4.45, ('Rendered label contrast is unreadable', item['id'], record['ink'][0]['fill'], surface, contrast)
            if item['type'] == 'frame':
                title_boxes[item['id']] = record['ink'][0]['bounds']
            else:
                box, ink = bounds(item), record['ink'][0]['bounds']
                assert item['text'].split() == item.get('originalText', item['text']).split(), ('Generated wrapping split or changed a word', item['id'])
                assert ink[0] >= box[0] - .75 and ink[1] >= box[1] - .75 and ink[2] <= box[2] + .75 and ink[3] <= box[3] + .75, ('Ink escapes finalized text bounds', item['id'], ink, box)
                assert item.get('autoResize') is True and item.get('lineHeight') == 1.5, item['id']
                if host and host['type'] in ('rectangle', 'ellipse', 'diamond'):
                    cx, cy = host['x'] + host['width'] / 2, host['y'] + host['height'] / 2
                    for x, y in ((ink[0], ink[1]), (ink[2], ink[1]), (ink[2], ink[3]), (ink[0], ink[3])):
                        nx, ny = abs(x-cx) / (host['width']/2), abs(y-cy) / (host['height']/2)
                        inside = max(nx, ny) <= 1.005 if host['type'] == 'rectangle' else nx*nx+ny*ny <= 1.005 if host['type'] == 'ellipse' else nx+ny <= 1.005
                        assert inside, ('Label ink escapes host shape', item['id'], host['id'], ink)
                if item.get('frameId'):
                    frame = by_id[item['frameId']]
                    assert ink[0] >= frame['x'] - .75 and ink[1] >= frame['y'] - .75 and ink[2] <= frame['x'] + frame['width'] + .75 and ink[3] <= frame['y'] + frame['height'] + .75, ('Text clipped by frame', item['id'])
    return result, title_boxes


def svg_geometry_equal(first, second):
    assert len(first) == len(second)
    for before, after in zip(first, second):
        assert before['type'] == after['type']
        assert before['geometry'] == after['geometry'], ('SVG changed finalized geometry', before['id'], after['id'])


def path_paint_report(records):
    return [{'id': record['id'], **paint} for record in records if record['type'] in ('arrow', 'line', 'freedraw') for paint in record['paint']]


def inspect_quality(scene, permissions, title_boxes):
    native_references(scene)
    crossings = connector_crossings(scene, padding=1, title_boxes=title_boxes)
    markers = marker_crossings(scene, title_boxes)
    collisions = shape_collisions(scene, permissions)
    assert not crossings, {'connector_crossings': crossings}
    assert not markers, {'marker_crossings': markers}
    assert not collisions, {'shape_collisions': collisions}
    return {'connector_crossings': crossings, 'marker_crossings': markers, 'shape_collisions': collisions,
            'native_type_counts': dict(Counter(item['type'] for item in scene['elements']))}
def assert_primary_crossing(scene):
    records = {item['id']: item for item in scene['elements']}
    caption = next(item for item in records.values() if item.get('originalText') == 'handoff')
    card_label = next(item for item in records.values() if item.get('originalText') == 'Finalize launch checklist')
    arrow, card = records[caption['containerId']], records[card_label['containerId']]
    points = world_points(arrow)
    assert segment_hits_box(points[-2], points[-1], bounds(card)), 'Saved crossing baseline did not hit the unrelated action card'
    return {'arrow_id': arrow['id'], 'card_id': card['id'], 'last_segment': points[-2:], 'card_bounds': bounds(card)}


async def screenshot(page, path):
    await page.evaluate('() => document.fonts.ready')
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.screenshot(path=str(path), animations='disabled')


async def baseline(browser, args):
    document = json.loads(CAPTURED.read_text())
    primary = assert_primary_crossing(document['architectureScene'])
    violations = connector_crossings(document['architectureScene'])
    assert violations
    context = await browser.new_context(viewport={'width': 1680, 'height': 1100})
    page = await context.new_page()
    await page.add_init_script('localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(document)) + ')')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(args.url, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you')
    if await dismiss.count():
        await dismiss.click()
    canvas = page.get_by_label('Draw canvas', exact=True)
    await canvas.focus()
    await page.keyboard.press('Shift+Digit1')
    await page.keyboard.press('Alt+z')
    await page.locator('.draw-zen').wait_for()
    await screenshot(page, args.output / 'before-crossing-dark.png')
    await page.get_by_role('button', name='Toggle Dark Mode').click()
    await screenshot(page, args.output / 'before-crossing-light.png')
    assert not errors, errors
    await context.close()
    return {'source_revision': '1d8073ff74d1506a1a027ebbd96a5de74459f2dd', 'source': str(CAPTURED.relative_to(ROOT)),
            'status': 'REPRODUCED', 'primary_crossing': primary, 'crossings': violations,
            'checks': ['independent segment/rectangle oracle detects the saved card crossing', 'actual browser renders the captured native scene in dark and light themes']}


async def canvas_point(page, x, y):
    return await page.locator('[data-drawing-layer]').evaluate('(g,p) => { const q=new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM()); return {x:q.x,y:q.y} }', {'x': x, 'y': y})


async def set_shape_style(page, shape, style='dashed'):
    canvas = page.get_by_label('Draw canvas', exact=True)
    position = await canvas_point(page, shape['x'] + shape['width'] / 2, shape['y'])
    await canvas.focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('v')
    await page.mouse.click(position['x'], position['y'])
    await page.locator(f'[data-element-id="{shape["id"]}"][data-selected="true"]').wait_for(state='attached')
    await page.get_by_role('combobox', name='Stroke style', exact=True).select_option(style)
    await page.wait_for_function('([key,id,style]) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id===id).strokeStyle === style', arg=[DRAFT, shape['id'], style])


async def native_edit_checks(page, original, require_frame):
    items = original['architectureScene']['elements']
    canvas = page.get_by_label('Draw canvas', exact=True)
    await canvas.focus()
    await page.keyboard.press('Shift+Digit1')
    shape = next(item for item in items if item['type'] in ('rectangle', 'ellipse', 'diamond'))
    await set_shape_style(page, shape)
    edited = await document(page)
    await page.get_by_role('button', name='Undo', exact=True).click()
    await wait_document(page, original)
    await page.get_by_role('button', name='Redo', exact=True).click()
    await wait_document(page, edited)
    await page.get_by_role('button', name='Undo', exact=True).click()
    await wait_document(page, original)
    frames = [item for item in items if item['type'] == 'frame' and any(child.get('frameId') == item['id'] for child in items)]
    assert frames or not require_frame, 'Captured fixture lost editable frames'
    if frames:
        frame = frames[0]
        start = await canvas_point(page, frame['x'] + frame['width'] * .45, frame['y'])
        end = await canvas_point(page, frame['x'] + frame['width'] * .45 + 40, frame['y'] + 20)
        await canvas.focus()
        await page.keyboard.press('Escape')
        await page.mouse.move(start['x'], start['y'])
        await page.mouse.down()
        await page.mouse.move(end['x'], end['y'], steps=12)
        await page.mouse.up()
        await page.wait_for_function('([key,id,x]) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id===id).x !== x', arg=[DRAFT, frame['id'], frame['x']])
        moved_scene = (await document(page))['architectureScene']
        moved = {item['id']: item for item in moved_scene['elements']}
        native_references(moved_scene)
        dx, dy = moved[frame['id']]['x'] - frame['x'], moved[frame['id']]['y'] - frame['y']
        for item in items:
            if item.get('frameId') == frame['id'] and item['type'] not in ('arrow', 'line', 'text'):
                assert abs(moved[item['id']]['x'] - item['x'] - dx) < .001, item['id']
                assert abs(moved[item['id']]['y'] - item['y'] - dy) < .001, item['id']
            for key in ('startBinding', 'endBinding'):
                if item.get(key):
                    assert moved[item['id']][key]['elementId'] == item[key]['elementId']
        await page.get_by_role('button', name='Undo', exact=True).click()
        await wait_document(page, original)
    await set_shape_style(page, shape)
    return {'native_property_edit_undo_redo': True, 'frame_move_and_undo': bool(frames)}, await document(page)


async def export_checks(page, context, after, args, name):
    paths = {}
    for label, extension in [('Export as JSON', 'json'), ('Export as SVG', 'svg'), ('Export as Excalidraw', 'excalidraw')]:
        await page.get_by_role('button', name='Export', exact=True).click()
        async with page.expect_download() as download_info:
            await page.get_by_role('button', name=label, exact=True).click()
        path = args.output / f'{name}-export.{extension}'
        await (await download_info.value).save_as(str(path))
        paths[extension] = path
    project = json.loads(paths['json'].read_text())
    assert project['architectureScene'] == after['architectureScene']
    native = json.loads(paths['excalidraw'].read_text())
    assert native['type'] == 'excalidraw' and native['version'] == 2
    native_equivalence = geometry_equivalent(after['architectureScene'], native)
    svg = paths['svg'].read_text()
    assert '@font-face' in svg and 'data:font/' in svg and 'Flowchart Diagram Sans' in svg, 'SVG must carry its own canonical font'
    standalone = await context.new_page()
    await standalone.set_content(svg)
    await standalone.evaluate('() => document.fonts.ready')
    assert await standalone.evaluate('() => document.fonts.check(\'18px "Flowchart Diagram Sans"\')')
    await standalone.locator('svg').screenshot(path=str(args.output / f'{name}-export-rendered.png'))
    await standalone.close()
    await page.get_by_role('button', name='Export', exact=True).click()
    await page.get_by_label('Import JSON or Excalidraw file', exact=True).set_input_files(str(paths['excalidraw']))
    imported = page.get_by_role('dialog', name='Bring your drawing in')
    await imported.get_by_role('button', name='Open as new diagram', exact=False).click()
    await imported.wait_for(state='hidden')
    await page.wait_for_timeout(600)
    await page.wait_for_function('([key,n]) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length===n', arg=[DRAFT, len(native['elements'])])
    reimport = (await document(page))['architectureScene']
    reimport_equivalence = geometry_equivalent(native, reimport)
    shape = next(item for item in reimport['elements'] if item['type'] in ('rectangle', 'ellipse', 'diamond'))
    await set_shape_style(page, shape, style='solid')
    await page.get_by_role('button', name='Undo', exact=True).click()
    await page.wait_for_function('([key,id]) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id===id).strokeStyle === "dashed"', arg=[DRAFT, shape['id']])
    return {'native_export': native_equivalence, 'native_reimport': reimport_equivalence, 'reimport_native_edit_and_undo': True, 'svg_embedded_font': True}


async def failed_compile_check(page):
    before = await document(page)
    dialog = await open_prompt(page)
    response = await send_prompt(page, dialog, 'verification-reject-layout')
    payload = await response.json()
    assert response.status >= 400 and 'drawing' not in payload, (response.status, payload)
    await dialog.get_by_role('alert').wait_for()
    assert await document(page) == before, 'Rejected layout changed the board'
    assert not await page.get_by_role('dialog', name='Preview AI Proposal').count()
    return {'http_status': response.status, 'code': payload.get('code'), 'board_unchanged': True, 'error_visible': True}


async def verified_case(browser, args, name, prompt):
    context = await browser.new_context(viewport={'width': 1680, 'height': 1100}, accept_downloads=True)
    page = await context.new_page()
    await page.add_init_script('if (!localStorage.getItem(' + json.dumps(DRAFT) + ')) localStorage.setItem(' + json.dumps(DRAFT) + ',' + json.dumps(json.dumps(EMPTY)) + ')')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.goto(args.url, wait_until='networkidle')
    dialog = await open_prompt(page)
    before = await document(page)
    response = await send_prompt(page, dialog, prompt)
    payload = await response.json()
    (args.output / f'{name}-api-response.json').write_text(json.dumps(payload, indent=2) + '\n')
    assert response.status == 200, {'status': response.status, 'payload': payload}
    assert payload.get('drawing', {}).get('type') == 'excalidraw' and payload['drawing']['version'] == 2, 'API did not finalize a native Excalidraw document'
    drawing = payload['drawing']
    replay_equivalence = None
    if name.endswith('-replay'):
        original = json.loads((args.output / f'{name.removesuffix("-replay")}-api-response.json').read_text())
        replay_equivalence = geometry_equivalent(original['drawing'], drawing)
    proposal = json.loads(payload['message'])
    assert proposal['outputMode'] == 'draw' and 'overlaps' not in proposal
    if args.live or name.startswith(('morning', 'workshop')):
        assert not any(item['type'] == 'freedraw' for item in drawing['elements']), 'Ordinary request acquired an unsolicited doodle'
    preview = page.get_by_role('dialog', name='Preview AI Proposal')
    await preview.wait_for(timeout=20000)
    assert await document(page) == before, 'Preview changed the document'
    preview_geometry, title_boxes = await rendered_geometry(preview, drawing)
    quality = inspect_quality(drawing, payload.get('drawOverlaps') or [], title_boxes)
    await screenshot(page, args.output / f'{name}-preview-dark.png')
    await preview.get_by_role('button', name='Present', exact=True).click()
    presentation = page.locator('.ai-native-presentation')
    await presentation.wait_for()
    presentation_geometry, _ = await rendered_geometry(presentation, drawing)
    svg_geometry_equal(preview_geometry, presentation_geometry)
    assert await document(page) == before
    await screenshot(page, args.output / f'{name}-presentation-dark.png')
    await page.get_by_role('button', name='Exit presentation').click()
    await preview.get_by_role('button', name='Insert into Canvas').click()
    await preview.wait_for(state='hidden')
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).architectureScene.elements.length > 0', arg=DRAFT)
    after = await document(page)
    equivalence = geometry_equivalent(drawing, after['architectureScene'])
    board_geometry, _ = await rendered_geometry(page.locator('.draw-canvas'), after['architectureScene'])
    svg_geometry_equal(preview_geometry, board_geometry)
    await page.get_by_role('button', name='Undo', exact=True).click()
    await wait_document(page, before)
    await page.get_by_role('button', name='Redo', exact=True).click()
    await wait_document(page, after)
    canvas = page.get_by_label('Draw canvas', exact=True)
    await canvas.focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+Digit1')
    await page.keyboard.press('Alt+z')
    await page.locator('.draw-zen').wait_for()
    await screenshot(page, args.output / f'{name}-board-dark.png')
    await page.get_by_role('button', name='Toggle Dark Mode').click()
    await page.locator('.app.light-mode').wait_for()
    light_geometry, _ = await rendered_geometry(page.locator('.draw-canvas'), after['architectureScene'])
    svg_geometry_equal(board_geometry, light_geometry)
    await screenshot(page, args.output / f'{name}-board-light.png')
    await canvas.focus()
    await page.keyboard.press('Alt+z')
    native_edits, edited = await native_edit_checks(page, after, require_frame=name == 'captured')
    await page.reload(wait_until='networkidle')
    await wait_document(page, edited)
    exports = await export_checks(page, context, edited, args, name)
    rejected = await failed_compile_check(page) if name == 'captured' else None
    assert not errors, errors
    await context.close()
    return {'case': name, 'prompt': prompt, 'request_id': response.headers.get('x-request-id'),
            'quality': quality, 'canonical_insertion': equivalence, 'native_edits': native_edits, 'exports': exports,
            'replay_matches_original_cloud_file': replay_equivalence,
            'connector_paint_contrast': {'threshold': 3, 'dark': path_paint_report(board_geometry), 'light': path_paint_report(light_geometry)},
            'failed_compile': rejected, 'checks': ['backend response is the finalized native document',
              'independent segment, marker, shape, and measured frame-title checks pass',
              'font-ready browser ink remains inside finalized text bounds',
              'actual connector shafts and marker paint exceed 3:1 contrast on dark and light surfaces',
              'response, preview, presentation, insertion, undo, redo, reload and native exports retain canonical geometry',
              'generated elements remain editable and native Excalidraw roundtrip preserves bindings'], 'status': 'PASS'}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:3062/')
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--case', choices=tuple(PROMPTS), default='captured')
    parser.add_argument('--source-revision')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/screenshots/draw-quality')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        try:
            if args.baseline:
                report = await baseline(browser, args)
            else:
                cases = [(name, PROMPTS[name]) for name in ('morning', 'workshop')] if args.live else [
                    (args.case if args.case == 'captured' else args.case + '-replay', PROMPTS[args.case])]
                report = {'url': args.url, 'live': args.live, 'source_revision': args.source_revision,
                          'method': 'real cloud provider via /api/chat' if args.live else 'real handleChat with captured provider response fixture' if args.case == 'captured' else 'real handleChat with exact saved cloud source plan fixture',
                          'oracle_negative_controls': marker_negative_control(), 'cases': []}
                for name, prompt in cases:
                    report['cases'].append(await verified_case(browser, args, name, prompt))
                report['status'] = 'PASS'
        finally:
            await browser.close()
    suffix = 'baseline' if args.baseline else 'live' if args.live else args.case if args.case == 'captured' else args.case + '-replay'
    (args.output / f'verification-{suffix}.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
