"""Verify Draw object text editing with native mouse and touch input.

python3 scripts/verify-draw-doubleclick.py URL --source-revision FULL_SHA --baseline-url BASE_URL
Use --baseline-only --baseline-url BASE_URL to capture the negative control first.
Use --baseline-report PATH to reuse that control, and --output PATH for separate evidence.
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/draw-doubleclick'
DRAFT = 'flowchart-editor-draft-v3'
BASE_REVISION = 'c3c37856b40293bf515ddb02fff044c34e17a075'


@dataclass(frozen=True)
class Screen:
    name: str
    width: int
    height: int
    touch: bool
    theme: str


@dataclass(frozen=True)
class Case:
    name: str
    kind: str = 'rectangle'
    outline: bool = False
    filled: bool = False
    angle: float = 0
    history: bool = False
    transformed: bool = False


SCREENS = [Screen('desktop-dark', 1440, 960, False, 'dark'),
           Screen('desktop-light', 1440, 960, False, 'light'),
           Screen('phone-dark', 390, 844, True, 'dark'),
           Screen('phone-light', 390, 844, True, 'light')]
CASES = [Case('rectangle-interior'), Case('rectangle-outline', outline=True, history=True),
         Case('ellipse-outline-filled', 'ellipse', True, True),
         Case('diamond-outline', 'diamond', True),
         Case('arrow-midpoint', 'arrow', history=True), Case('line-midpoint', 'line'),
         Case('existing-text', 'text', history=True)]
EXTRA_CASES = [Case('rectangle-filled', filled=True),
               Case('ellipse-interior', 'ellipse'), Case('ellipse-outline', 'ellipse', True),
               Case('diamond-filled', 'diamond', False, True),
               Case('diamond-outline-filled', 'diamond', True, True),
               Case('rotated-outline', angle=.35, outline=True, transformed=True)]


def fixture(case, locked=False):
    host = {'id': 'host', 'type': case.kind, 'x': 100, 'y': 100, 'width': 240, 'height': 160,
            'angle': case.angle, 'strokeColor': '#087f5b',
            'backgroundColor': '#b2f2dc' if case.filled else 'transparent',
            'strokeWidth': 2, 'opacity': 100, 'groupIds': [], 'boundElements': None, 'locked': locked}
    if case.kind in ('line', 'arrow'):
        host.update(height=0, points=[[0, 0], [240, 0]])
    if case.kind == 'text':
        host.update(height=30, text='Existing text', originalText='Existing text', fontSize=20, fontFamily=2)
    files = {}
    if case.kind == 'image':
        host.update(fileId='asset-logo', status='saved', scale=[1, 1], crop=None)
        files = json.loads((ROOT / 'src/test/fixtures/excalidraw/architecture-complete.excalidraw').read_text())['files']
    return {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
            'architectureScene': {'version': 1, 'elements': [host], 'files': files,
                                  'appState': {'viewBackgroundColor': '#ffffff'}}}


async def settle(page):
    await page.evaluate('''async () => {
        const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        await frame();
        await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
        await frame();
    }''')


async def new_page(browser, url, screen, case, locked=False):
    context = await browser.new_context(viewport={'width': screen.width, 'height': screen.height},
                                        has_touch=screen.touch, is_mobile=screen.touch,
                                        device_scale_factor=1, color_scheme=screen.theme)
    page = await context.new_page()
    page.set_default_timeout(7000)
    page.set_default_navigation_timeout(30000)
    errors, api_calls = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def block(route):
        api_calls.append({'url': route.request.url, 'method': route.request.method})
        await route.abort()

    await page.route('**/api/**', block)
    initial = fixture(case, locked)
    await page.add_init_script('''(initial => {
        if (!sessionStorage.getItem('draw-doubleclick-seeded')) {
            localStorage.setItem('flowchart-editor-draft-v3',JSON.stringify(initial));
            localStorage.setItem('flowchart-patch-notes-seen-revision',String(Number.MAX_SAFE_INTEGER));
            sessionStorage.setItem('draw-doubleclick-seeded','true');
        }
    })(''' + json.dumps(initial) + ')')
    await page.goto(url, wait_until='domcontentloaded')
    await page.get_by_test_id('draw-surface').wait_for()
    await page.evaluate('document.fonts.ready')
    await settle(page)
    actual_dark = await page.locator('.app').evaluate('n=>n.classList.contains("dark-mode")')
    if actual_dark != (screen.theme == 'dark'):
        await page.get_by_label('Draw canvas', exact=True).focus()
        await page.keyboard.press('Alt+Shift+d')
        await settle(page)
    assert await page.locator('.app').evaluate('n=>n.classList.contains("dark-mode")') == (screen.theme == 'dark'), 'Rendered theme differs from the named case'
    await page.evaluate('''() => {
        window.__doubleclickEvents=[];
        for (const name of ['pointerdown','pointerup','click','dblclick']) {
            document.querySelector('.draw-surface').addEventListener(name,event=>{
                const actual=document.elementFromPoint(event.clientX,event.clientY);
                window.__doubleclickEvents.push({type:event.type,pointerType:event.pointerType||null,
                    detail:event.detail,target:event.target.tagName,
                    id:event.target.closest('[data-element-id]')?.getAttribute('data-element-id')||null,
                    actualHitId:actual?.closest('[data-element-id]')?.getAttribute('data-element-id')||null});
            });
        }
    }''')
    page._proof_errors, page._proof_api = errors, api_calls
    return context, page


async def saved(page):
    return await page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', DRAFT)


async def wait_saved(page, condition, **values):
    await page.wait_for_function('(arg)=>{const doc=JSON.parse(localStorage.getItem(arg.key)||"{}");return (' + condition + ')(doc,arg)}',
                                 arg={'key': DRAFT, **values})
    return await saved(page)


def live(document):
    return [item for item in document['architectureScene']['elements'] if not item.get('isDeleted')]


def element(document, identifier):
    return next(item for item in live(document) if item['id'] == identifier)


def label(document, host_id='host'):
    labels = [item for item in live(document) if item['type'] == 'text' and item.get('containerId') == host_id]
    assert len(labels) == 1, f'Expected one attached label for {host_id}, got {labels}'
    result = labels[0]
    host = element(document, host_id)
    refs = [entry for entry in host.get('boundElements') or [] if entry.get('type') == 'text']
    assert refs == [{'id': result['id'], 'type': 'text'}], f'Host text binding differs: {refs}, {result}'
    assert abs(result['x'] + result['width']/2 - host['x'] - host['width']/2) < .1, f'Label is not horizontally centered: {host}, {result}'
    assert abs(result['y'] + result['height']/2 - host['y'] - host['height']/2) < .1, f'Label is not vertically centered: {host}, {result}'
    assert abs(result.get('angle', 0) - host.get('angle', 0)) < .001, f'Label rotation differs: {host}, {result}'
    return result


async def world_point(page, x, y):
    return await page.locator('[data-draw-viewport]').evaluate('''(layer,p)=>{
        const point=new DOMPoint(p.x,p.y).matrixTransform(layer.getScreenCTM());
        return {x:point.x,y:point.y};
    }''', {'x': x, 'y': y})


async def case_point(page, case, host=None):
    host = host or element(await saved(page), 'host')
    x = host['x'] + (80 if case.kind == 'text' else host['width']/2)
    y = host['y'] + host['height']/2
    if case.outline:
        x = host['x'] - 3
    if case.angle:
        cx, cy = host['x'] + host['width']/2, host['y'] + host['height']/2
        x, y = cx + (x-cx)*math.cos(case.angle) - (y-cy)*math.sin(case.angle), cy + (x-cx)*math.sin(case.angle) + (y-cy)*math.cos(case.angle)
    return await world_point(page, x, y)


async def double_click(page, screen, point):
    if screen.touch:
        await page.touchscreen.tap(point['x'], point['y'])
        await page.wait_for_timeout(90)
        await page.touchscreen.tap(point['x'], point['y'])
    else:
        await page.mouse.dblclick(point['x'], point['y'], delay=90)
    await settle(page)


async def editor_observation(page, host_id=None):
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    if not await editor.count():
        return {'opened': False}
    box = await editor.bounding_box()
    result = {'opened': True, 'focused': await editor.evaluate('n=>n===document.activeElement'),
              'value': await editor.input_value(), 'box': box}
    if host_id:
        host = element(await saved(page), host_id)
        center = await world_point(page, host['x'] + host['width']/2, host['y'] + host['height']/2)
        result['centerError'] = {'x': box['x'] + box['width']/2 - center['x'],
                                 'y': box['y'] + box['height']/2 - center['y']}
    return result


async def capture(page, output, filename):
    await settle(page)
    await page.screenshot(path=str(output / filename), animations='disabled')


async def close(context, page):
    assert not page._proof_errors, f'Browser exceptions: {page._proof_errors}'
    assert not page._proof_api, f'Unexpected API calls: {page._proof_api}'
    await context.close()


async def negative_control(browser, url, output):
    cases = [Case('outline', outline=True), Case('existing-text', 'text'), Case('arrow-midpoint', 'arrow')]
    results = []
    for case in cases:
        context, page = await new_page(browser, url, SCREENS[0], case)
        await double_click(page, SCREENS[0], await case_point(page, case))
        observed = await editor_observation(page, 'host' if case.kind != 'text' else None)
        events = await page.evaluate('window.__doubleclickEvents')
        if case.kind == 'arrow':
            assert not observed['opened'] and not any(event['type'] == 'dblclick' for event in events), f'Expected blocked connector double-click was absent: {observed}, {events}'
        else:
            assert observed['opened'], f'Expected an observable wrong editor, got {observed}'
            editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
            assert observed['value'] == '', f'Expected empty detached editor, got {observed}'
            await editor.fill('Orders service')
            await capture(page, output, f'before-{case.name}-desktop-dark.png')
            await editor.press('Control+Enter')
            document = await wait_saved(page, 'doc=>doc.architectureScene.elements.some(e=>e.text==="Orders service")')
            texts = [item for item in live(document) if item['type'] == 'text']
            observed['savedText'] = [{'id': item['id'], 'text': item.get('text'), 'containerId': item.get('containerId')} for item in texts]
            if case.kind == 'text':
                assert len(texts) == 2 and element(document, 'host')['text'] == 'Existing text', f'Expected duplicated text was absent: {texts}'
            else:
                assert len(texts) == 1 and texts[0].get('containerId') is None, f'Expected detached label was absent: {texts}'
        results.append({'case': case.name, 'observation': observed, 'events': events})
        await close(context, page)
    result = {'sourceRevision': BASE_REVISION, 'url': url, 'verifiedAt': datetime.now(timezone.utc).isoformat(), 'cases': results}
    (output / 'negative-control.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASS baseline reproduces detached outline text, duplicated existing text, and interrupted connector double-click', flush=True)
    return result


def read_control(path):
    control = json.loads(path.read_text())
    assert control['sourceRevision'] == BASE_REVISION, 'Wrong baseline revision'
    cases = {item['case']: item for item in control['cases']}
    assert set(cases) == {'outline', 'existing-text', 'arrow-midpoint'}, 'Unexpected negative-control cases'
    outline = cases['outline']['observation']['savedText']
    assert len(outline) == 1 and outline[0]['containerId'] is None, 'Negative control did not show detached text'
    text = cases['existing-text']['observation']
    assert text['value'] == '' and len(text['savedText']) == 2, 'Negative control did not show duplicated text'
    arrow = cases['arrow-midpoint']
    assert not arrow['observation']['opened'] and not any(event['type'] == 'dblclick' for event in arrow['events']), 'Negative control did not show interrupted double-click'
    return control


async def positive_case(browser, url, screen, case, output):
    context, page = await new_page(browser, url, screen, case)
    if case.transformed:
        before = live(await saved(page))
        original = await page.locator('[data-draw-viewport]').get_attribute('transform')
        await page.get_by_label('Draw canvas', exact=True).focus()
        await page.keyboard.press('Control+-')
        await page.mouse.move(1000, 320)
        await page.mouse.down(button='right')
        await page.mouse.move(1080, 365, steps=8)
        await page.mouse.up(button='right')
        await settle(page)
        assert await page.locator('[data-draw-viewport]').get_attribute('transform') != original, 'Pan and zoom did not change the viewport'
        assert live(await saved(page)) == before, 'Pan and zoom changed document objects'
    await double_click(page, screen, await case_point(page, case))
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    await expect(editor).to_be_visible()
    observed = await editor_observation(page, 'host' if case.kind != 'text' else None)
    assert observed['focused'], f'Editor is not focused: {observed}'
    expected_value = 'Existing text' if case.kind == 'text' else ''
    assert observed['value'] == expected_value, f'Existing text was not reused: {observed}'
    if case.kind != 'text':
        assert all(abs(value) <= 2 for value in observed['centerError'].values()), f'Editor is not centered: {observed}'
    value = 'Orders service' if case.kind != 'text' else 'Updated existing text'
    await editor.fill(value)
    captures = {('desktop-dark', 'rectangle-outline'): 'after-outline-desktop-dark.png',
                ('desktop-dark', 'existing-text'): 'after-text-desktop-dark.png',
                ('desktop-dark', 'arrow-midpoint'): 'after-connector-desktop-dark.png',
                ('phone-dark', 'rectangle-outline'): 'after-outline-phone-dark.png',
                ('phone-light', 'ellipse-outline-filled'): 'after-shape-phone-light.png',
                ('desktop-dark', 'rotated-outline'): 'after-rotated-editor-dark.png'}
    if (screen.name, case.name) in captures:
        await capture(page, output, captures[(screen.name, case.name)])
    await editor.press('Control+Enter')
    document = await wait_saved(page, '(doc,arg)=>doc.architectureScene.elements.some(e=>e.text===arg.value)', value=value)
    if case.kind == 'text':
        assert len(live(document)) == 1 and element(document, 'host')['text'] == value, f'Standalone text was duplicated: {live(document)}'
        label_id = 'host'
    else:
        assert len(live(document)) == 2, f'Unexpected scene objects: {live(document)}'
        label_id = label(document)['id']
        assert element(document, label_id)['text'] == value
    await double_click(page, screen, await case_point(page, case))
    await expect(editor).to_be_visible()
    assert await editor.input_value() == value, 'Reopening did not reuse the label'
    updated = value + '\nReady for review'
    await editor.fill(updated)
    await page.get_by_role('button', name='Fit drawing', exact=True).click()
    document = await wait_saved(page, '(doc,arg)=>doc.architectureScene.elements.some(e=>e.id===arg.id&&e.text===arg.value)', id=label_id, value=updated)
    assert len([item for item in live(document) if item['type'] == 'text']) == 1, 'Reopening created another text object'
    if case.kind != 'text':
        assert label(document)['id'] == label_id
    if case.history:
        await page.get_by_label('Draw canvas', exact=True).focus()
        await page.keyboard.press('Control+z')
        await wait_saved(page, '(doc,arg)=>doc.architectureScene.elements.some(e=>e.id===arg.id&&e.text===arg.value)', id=label_id, value=value)
        await page.keyboard.press('Control+z')
        if case.kind == 'text':
            await wait_saved(page, 'doc=>doc.architectureScene.elements.find(e=>e.id==="host").text==="Existing text"')
        else:
            await wait_saved(page, 'doc=>doc.architectureScene.elements.filter(e=>!e.isDeleted).length===1')
        await page.keyboard.press('Control+Shift+z')
        await page.keyboard.press('Control+Shift+z')
        await wait_saved(page, '(doc,arg)=>doc.architectureScene.elements.some(e=>e.id===arg.id&&e.text===arg.value)', id=label_id, value=updated)
        await page.reload(wait_until='domcontentloaded')
        await page.get_by_test_id('draw-surface').wait_for()
        document = await saved(page)
        assert element(document, label_id)['text'] == updated, 'Reload lost edited text'
        if case.kind != 'text':
            assert label(document)['id'] == label_id
    result = {'screen': screen.name, 'viewport': {'width': screen.width, 'height': screen.height},
              'touch': screen.touch, 'theme': screen.theme, 'case': case.name, 'editor': observed, 'textId': label_id,
              'containerId': None if case.kind == 'text' else 'host', 'historyChecked': case.history,
              'reloadChecked': case.history,
              'panZoomRotation': case.transformed}
    await close(context, page)
    print(f'PASS {screen.name} {case.name}', flush=True)
    return result


async def native_drawing(browser, url, screen, output):
    context, page = await new_page(browser, url, screen, Case('new-shape'))
    await page.get_by_label('Draw canvas', exact=True).focus()
    await page.keyboard.press('r')
    surface = await page.get_by_test_id('draw-surface').bounding_box()
    start = {'x': screen.width/2 - 90, 'y': surface['y'] + 160}
    end = {'x': start['x'] + 180, 'y': start['y'] + 70}
    if screen.touch:
        session = await page.context.new_cdp_session(page)
        await session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': start['x'], 'y': start['y'], 'id': 1}]})
        for step in range(1, 11):
            await session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': start['x'] + (end['x']-start['x'])*step/10, 'y': start['y'] + (end['y']-start['y'])*step/10, 'id': 1}]})
            await page.wait_for_timeout(20)
        await session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await session.detach()
    else:
        await page.mouse.move(start['x'], start['y'])
        await page.mouse.down()
        await page.mouse.move(end['x'], end['y'], steps=10)
        await page.mouse.up()
    document = await wait_saved(page, 'doc=>doc.architectureScene.elements.filter(e=>!e.isDeleted).length===2')
    await expect(page.get_by_role('button', name='Selection tool', exact=True)).to_have_attribute('aria-pressed', 'true')
    host = next(item for item in live(document) if item['id'] != 'host')
    await double_click(page, screen, await case_point(page, Case('new-shape'), host))
    editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
    await expect(editor).to_be_visible()
    observed = await editor_observation(page, host['id'])
    assert observed['focused'] and all(abs(value) <= 2 for value in observed['centerError'].values()), f'New shape editor is not centered and focused: {observed}'
    await editor.fill('New shape label')
    if screen.touch:
        await capture(page, output, 'after-new-shape-phone-light.png')
    await editor.press('Control+Enter')
    document = await wait_saved(page, 'doc=>doc.architectureScene.elements.some(e=>e.text==="New shape label")')
    attached = label(document, host['id'])
    assert len(live(document)) == 3 and attached['text'] == 'New shape label'
    await page.get_by_label('Draw canvas', exact=True).focus()
    await page.keyboard.press('Control+z')
    await wait_saved(page, 'doc=>doc.architectureScene.elements.filter(e=>!e.isDeleted).length===2')
    await page.keyboard.press('Control+z')
    await wait_saved(page, 'doc=>doc.architectureScene.elements.filter(e=>!e.isDeleted).length===1')
    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+Shift+z')
    document = await wait_saved(page, '(doc,arg)=>doc.architectureScene.elements.some(e=>e.id===arg.id)', id=attached['id'])
    assert label(document, host['id'])['id'] == attached['id']
    await close(context, page)
    print(f'PASS {screen.name} native draw, pointer default, centered text, and separate history', flush=True)
    return {'screen': screen.name, 'viewport': {'width': screen.width, 'height': screen.height},
            'touch': screen.touch, 'theme': screen.theme, 'case': 'native-draw', 'editor': observed,
            'textId': attached['id'], 'containerId': host['id'], 'historyChecked': True, 'reloadChecked': False}


async def guards(browser, url):
    results = []
    for name in ('locked', 'view-mode', 'resize', 'rotate', 'path-point', 'blank-canvas', 'empty-label', 'image-crop'):
        case = Case(name, 'arrow' if name == 'path-point' else 'image' if name == 'image-crop' else 'rectangle')
        context, page = await new_page(browser, url, SCREENS[0], case, locked=name == 'locked')
        await page.wait_for_timeout(550)
        before = await saved(page)
        center = await case_point(page, case)
        if name == 'view-mode':
            await page.get_by_label('Draw canvas', exact=True).focus()
            await page.keyboard.press('Alt+r')
            await expect(page.locator('.draw-view-badge')).to_be_visible()
        if name in ('resize', 'rotate', 'path-point'):
            await page.mouse.click(center['x'], center['y'])
            control = page.get_by_label('Resize se' if name == 'resize' else 'Rotate selection' if name == 'rotate' else 'Edit path point 1', exact=True)
            box = await control.bounding_box()
            center = {'x': box['x'] + box['width']/2, 'y': box['y'] + box['height']/2}
        if name == 'blank-canvas':
            surface = await page.get_by_test_id('draw-surface').bounding_box()
            center = {'x': 850, 'y': surface['y'] + 180}
        await double_click(page, SCREENS[0], center)
        editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
        if name in ('blank-canvas', 'empty-label'):
            await expect(editor).to_be_visible()
            if name == 'empty-label':
                await page.get_by_role('button', name='Fit drawing', exact=True).click()
                await expect(editor).to_have_count(0)
                assert await saved(page) == before, 'Discarding an empty label changed the document'
                await expect(page.get_by_role('button', name='Undo drawing', exact=True)).to_be_disabled()
            else:
                await editor.fill('A standalone note')
                await editor.press('Control+Enter')
                document = await wait_saved(page, 'doc=>doc.architectureScene.elements.some(e=>e.text==="A standalone note")')
                note = next(item for item in live(document) if item.get('text') == 'A standalone note')
                assert note.get('containerId') is None, 'Blank canvas note acquired a host'
        elif name == 'image-crop':
            await expect(page.get_by_role('dialog', name='Crop image', exact=True)).to_be_visible()
            await expect(editor).to_have_count(0)
            await page.get_by_role('button', name='Cancel crop', exact=True).click()
            assert await saved(page) == before, 'Cancelling image crop changed the document'
        else:
            await expect(editor).to_have_count(0)
            after = await saved(page)
            assert after == before, f'{name} double-click changed the document: before={before}, after={after}'
        results.append({'guard': name, 'passed': True})
        await close(context, page)
        print(f'PASS {name} guard', flush=True)
    print('PASS locked, view-mode, resize, rotate, path-point, blank-canvas, empty-label, and image-crop guards', flush=True)
    return results


async def assets(browser, url):
    context = await browser.new_context()
    page = await context.new_page()
    await page.route('**/api/**', lambda route: route.abort())
    await page.goto(url, wait_until='domcontentloaded')
    await page.get_by_role('button', name='Draw Mode', exact=True).wait_for()
    urls = await page.locator('script[src],link[rel="stylesheet"][href]').evaluate_all('nodes=>nodes.map(n=>n.src||n.href)')
    result = []
    for asset in urls:
        if urlsplit(asset).netloc != urlsplit(url).netloc:
            continue
        response = await page.request.get(asset)
        assert response.ok, f'Entry asset failed: {asset}, {response.status}'
        result.append({'url': asset, 'status': response.status, 'sha256': hashlib.sha256(await response.body()).hexdigest()})
    await context.close()
    return result


async def patch_notes(browser, url, output):
    context, page = await new_page(browser, url, SCREENS[0], Case('patch-notes'))
    await page.wait_for_timeout(550)
    before = await saved(page)
    await page.get_by_role('button', name="What's new", exact=True).click()
    notes = page.get_by_role('dialog', name="What's new", exact=True)
    await expect(notes).to_be_visible()
    headings = await notes.get_by_role('heading', level=3).all_text_contents()
    assert headings[0] == 'Edit text right on your drawings', f'Wrong latest release: {headings}'
    await expect(notes.get_by_text('Double-click a shape or its outline to add a centered label that stays attached.', exact=True)).to_be_visible()
    await capture(page, output, 'after-patch-notes-desktop-dark.png')
    await notes.get_by_role('button', name='Got it', exact=True).click()
    marker = await page.evaluate('localStorage.getItem("flowchart-patch-notes-seen-revision")')
    assert marker == '9007199254740991', 'Manual dismissal downgraded the future marker'
    assert await saved(page) == before, 'Patch notes changed the document'
    await close(context, page)
    print('PASS manual patch notes show revision 3 text-editing release', flush=True)
    return {'revision': 3, 'headings': headings, 'futureMarkerPreserved': True, 'documentPreserved': True}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?')
    parser.add_argument('--source-revision')
    baseline = parser.add_mutually_exclusive_group(required=True)
    baseline.add_argument('--baseline-url')
    baseline.add_argument('--baseline-report', type=Path)
    parser.add_argument('--baseline-only', action='store_true')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    if args.baseline_only and not args.baseline_url:
        parser.error('--baseline-only requires --baseline-url')
    if not args.baseline_only and (not args.url or not re.fullmatch('[0-9a-f]{40}', args.source_revision or '')):
        parser.error('Final proof requires a URL and full --source-revision')
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        control = await negative_control(browser, args.baseline_url, args.output) if args.baseline_url else read_control(args.baseline_report)
        assert control['sourceRevision'] == BASE_REVISION, 'Wrong baseline revision'
        if args.baseline_only:
            await browser.close()
            return
        report = {'sourceRevision': args.source_revision, 'url': args.url,
                  'verifiedAt': datetime.now(timezone.utc).isoformat(), 'chromium': browser.version,
                  'playwright': version('playwright'), 'negativeControl': control, 'cases': [],
                  'limits': ['Chromium mouse and touch emulation only. Physical Safari and native WebKit are unverified.',
                             'Screenshot device scale is 1, and viewport sizes are CSS pixels.',
                             'All API requests are blocked. No AI or shared-backend writes are sent.']}
        try:
            for screen in SCREENS:
                for case in CASES + (EXTRA_CASES if screen == SCREENS[0] else []):
                    report['cases'].append(await positive_case(browser, args.url, screen, case, args.output))
            for screen in (SCREENS[1], SCREENS[3]):
                report['cases'].append(await native_drawing(browser, args.url, screen, args.output))
            report['guards'] = await guards(browser, args.url)
            report['patchNotes'] = await patch_notes(browser, args.url, args.output)
            report['entryAssets'] = await assets(browser, args.url)
        except Exception as error:
            report['failure'] = str(error)
            (args.output / 'failure.json').write_text(json.dumps(report, indent=2) + '\n')
            raise
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        await browser.close()
    print(f'PASS {len(report["cases"])} native object cases, {len(report["guards"])} interaction guards, and manual patch notes. Evidence in {args.output}', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
