"""Reproduce mobile failures, then verify an immutable editor build with real touch input.

Run two isolated servers, one at the base revision and one at the reviewed revision.
python scripts/verify-mobile-layout.py URL --source-revision FULL_SHA --baseline-url BASE_URL
Use --baseline-only while preparing the negative control. No live API writes are allowed.
"""

import argparse
import asyncio
import copy
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/mobile'
DRAFT = 'flowchart-editor-draft-v3'
SEEN = 'flowchart-patch-notes-seen-revision'
BASE_REVISION = '52a3d51eb56697deb143f9c22989f6065cae436e'
FIXTURE = {
    'version': 4, 'mode': 'flowchart',
    'nodes': [{'id': 'retained-node', 'type': 'step', 'position': {'x': 80, 'y': 220},
               'data': {'label': 'Retained workflow'}, 'style': {'width': 200, 'height': 80}}],
    'edges': [],
    'architectureScene': {'version': 1, 'elements': [
        {'id': 'retained-box', 'type': 'rectangle', 'x': 80, 'y': 180,
         'width': 160, 'height': 90, 'angle': 0, 'strokeColor': '#087f5b',
         'backgroundColor': '#b2f2dc', 'strokeWidth': 2, 'opacity': 100,
         'groupIds': [], 'boundElements': None, 'locked': False},
    ], 'files': {}, 'appState': {'viewBackgroundColor': '#ffffff'}},
}
AI_FIXTURE = ROOT / 'docs/screenshots/draw-quality/morning-replay-api-response.json'


@dataclass(frozen=True)
class Screen:
    width: int
    height: int
    touch: bool = True

    @property
    def name(self):
        return f'{self.width}x{self.height}'


SCREENS = [Screen(390, 844), Screen(390, 664), Screen(844, 390),
           Screen(430, 932), Screen(768, 1024), Screen(1440, 960, False)]


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


async def settle(page):
    await page.evaluate('''async () => {
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await frame();
        await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
        await frame();
    }''')


async def saved(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def wait_saved(page, expression):
    await page.wait_for_function('(arg) => {const doc=JSON.parse(localStorage.getItem(arg.key)); return (' + expression + ')}', arg={'key': DRAFT})


async def capture(page, output, filename):
    await settle(page)
    await page.screenshot(path=str(output / filename), animations='disabled')


async def geometry(locator):
    return await locator.evaluate('''n => {
        const r=n.getBoundingClientRect(), s=getComputedStyle(n);
        const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        const points=[[r.width/2,r.height/2],[Math.min(12,r.width/2),r.height/2],[r.width-Math.min(12,r.width/2),r.height/2],[r.width/2,Math.min(12,r.height/2)],[r.width/2,r.height-Math.min(12,r.height/2)]];
        return {x:r.x,y:r.y,width:r.width,height:r.height,font:parseFloat(s.fontSize),
                hit:n===hit||n.contains(hit),hitName:hit?.getAttribute('aria-label')||hit?.tagName,
                hitPoints:points.map(([x,y])=>{const hit=document.elementFromPoint(r.x+x,r.y+y);return {x:r.x+x,y:r.y+y,hit:n===hit||n.contains(hit),hitName:hit?.getAttribute('aria-label')||hit?.textContent?.trim().slice(0,40)||hit?.tagName}}),
                visible:!!n.getClientRects().length&&s.visibility!=='hidden'};
    }''')


def bounded(box, screen, name, gutter=0):
    assert box and box['visible'], f'{name} is not visible: {box}'
    assert box['x'] >= gutter - .5 and box['y'] >= gutter - .5, f'{name} starts outside viewport: {box}'
    assert box['x'] + box['width'] <= screen.width - gutter + .5, f'{name} crosses right edge: {box}'
    assert box['y'] + box['height'] <= screen.height - gutter + .5, f'{name} crosses bottom edge: {box}'


def separate(first, second, name):
    intersection = min(first['x'] + first['width'], second['x'] + second['width']) > max(first['x'], second['x']) and min(first['y'] + first['height'], second['y'] + second['height']) > max(first['y'], second['y'])
    assert not intersection, f'{name} rectangles overlap: {first}, {second}'


async def target(locator, screen, name, minimum=True, hit=True):
    box = await geometry(locator)
    bounded(box, screen, name)
    if minimum and screen.touch:
        assert box['width'] >= 43.5 and box['height'] >= 43.5, f'{name} target is below 44px: {box}'
    if hit:
        assert all(point['hit'] for point in box['hitPoints']), f'{name} is obscured or clipped in its touch area: {box}'
    return box


async def activate(locator, screen):
    if screen.touch:
        await locator.tap()
    else:
        await locator.click()
    await settle(locator.page)


async def tap(page, name, screen):
    control = button(page, name)
    await target(control, screen, name)
    await activate(control, screen)


async def inputs(panel, screen):
    observations = []
    fields = panel.locator('input:not([type="hidden"]):not([type="file"]),textarea,select')
    for field in await fields.all():
        if not await field.is_visible():
            continue
        name = await field.get_attribute('aria-label') or await field.get_attribute('placeholder') or await field.get_attribute('type') or 'field'
        box = await geometry(field)
        if screen.touch:
            assert box['font'] >= 16, f'{name} editable UI font below 16px: {box}'
            kind = await field.get_attribute('type')
            hit_area = await geometry(field.locator('xpath=..')) if kind in ('checkbox', 'radio') else box
            assert hit_area['height'] >= 43.5, f'{name} input target below 44px: {hit_area}'
        observations.append({'name': name, **box})
    return observations


async def panel_controls(panel, screen, selector='button,a[href],select'):
    observations = []
    for control in await panel.locator(selector).all():
        if not await control.is_visible():
            continue
        name = await control.get_attribute('aria-label') or (await control.inner_text()).strip() or 'panel control'
        await control.scroll_into_view_if_needed()
        observations.append({'name': name, **await target(control, screen, name, hit=await control.is_enabled())})
    return observations


async def touch_drag(page, start, end, steps=12):
    session = await page.context.new_cdp_session(page)
    await session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': start[0], 'y': start[1], 'id': 1}]})
    for step in range(1, steps + 1):
        point = {'x': start[0] + (end[0] - start[0]) * step / steps,
                 'y': start[1] + (end[1] - start[1]) * step / steps, 'id': 1}
        await session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [point]})
        await page.wait_for_timeout(20)
    await session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await session.detach()
    await settle(page)


async def draw_tool(page, name, screen):
    control = button(page, name)
    rail = page.locator('.draw-tools-scroll')
    for _ in range(8):
        item, area = await geometry(control), await geometry(rail)
        if item['x'] >= area['x'] - .5 and item['x'] + item['width'] <= area['x'] + area['width'] + .5:
            await tap(page, name, screen)
            return
        if screen.touch:
            left, right = area['x'] + 12, area['x'] + area['width'] - 12
            start, end = (right, left) if item['x'] > area['x'] else (left, right)
            await touch_drag(page, (start, area['y'] + area['height'] / 2), (end, area['y'] + area['height'] / 2))
        else:
            await control.scroll_into_view_if_needed()
    raise AssertionError(f'{name} remained outside the scrolling drawing rail')


async def new_page(browser, url, screen, theme='dark', fresh=False, mode='flowchart'):
    context = await browser.new_context(viewport={'width': screen.width, 'height': screen.height},
                                        has_touch=screen.touch, is_mobile=screen.touch,
                                        device_scale_factor=1, accept_downloads=True,
                                        color_scheme=theme)
    page = await context.new_page()
    page.set_default_timeout(8000)
    page.set_default_navigation_timeout(30000)
    errors, forbidden, ai_requests = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def api(route):
        request = route.request
        if '/api/chat' in request.url:
            if getattr(page, '_mobile_proposal_fixture', False):
                ai_requests.append(request.post_data_json)
                await route.fulfill(status=200, content_type='application/json', body=AI_FIXTURE.read_text())
                return
        forbidden.append({'url': request.url, 'method': request.method})
        await route.abort()

    await page.route('**/api/**', api)
    fixture = copy.deepcopy(FIXTURE)
    fixture['mode'] = mode
    seed = {'fixture': None if fresh else fixture, 'fresh': fresh}
    await page.add_init_script('''config => {
        if (!sessionStorage.getItem('mobile-proof-seeded')) {
            if (config.fixture) localStorage.setItem('flowchart-editor-draft-v3', JSON.stringify(config.fixture));
            if (!config.fresh) localStorage.setItem('flowchart-patch-notes-seen-revision','1');
            sessionStorage.setItem('mobile-proof-seeded','true');
        }
    }'''.replace('config =>', '(' + 'config =>') + ')(' + json.dumps(seed) + ')')
    await page.goto(url, wait_until='domcontentloaded')
    await button(page, 'Draw Mode').wait_for()
    if mode == 'draw' and not fresh:
        await page.get_by_test_id('draw-surface').wait_for()
    await page.evaluate('document.fonts.ready')
    await settle(page)
    actual_dark = await page.locator('.app').evaluate('n=>n.classList.contains("dark-mode")')
    if not fresh and actual_dark != (theme == 'dark'):
        await utility(page, screen, 'Toggle Dark Mode')
        await page.keyboard.press('Escape')
        assert await page.locator('.app').evaluate('n=>n.classList.contains("dark-mode")') == (theme == 'dark'), 'Theme toggle did not change rendered theme'
    page._mobile_errors, page._mobile_forbidden, page._mobile_requests = errors, forbidden, ai_requests
    return context, page


async def clean(context, page):
    assert not page._mobile_errors, f'Browser exceptions: {page._mobile_errors}'
    assert not page._mobile_forbidden, f'Unstubbed API requests: {page._mobile_forbidden}'
    await context.close()


async def more_button(page):
    return page.get_by_role('button', name=re.compile(r'^More(?: actions)?$')).first


async def utility(page, screen, name):
    control = button(page, name)
    if not await control.is_visible():
        more = await more_button(page)
        await target(more, screen, 'More')
        await activate(more, screen)
    await control.scroll_into_view_if_needed()
    await tap(page, name, screen)


async def no_page_overflow(page, screen):
    result = await page.evaluate('''() => ({width:innerWidth,height:innerHeight,
        documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
        coarse:matchMedia('(pointer:coarse)').matches,touch:navigator.maxTouchPoints})''')
    assert result['documentWidth'] <= screen.width + 1, f'Page overflows horizontally: {result}'
    assert result['documentHeight'] <= screen.height + 1, f'Page overflows vertically: {result}'
    assert result['coarse'] == screen.touch and bool(result['touch']) == screen.touch, f'Wrong pointer context: {result}'
    return result


async def negative_control(browser, url, output):
    screen = SCREENS[0]
    context, page = await new_page(browser, url, screen)
    result = {'sourceRevision': BASE_REVISION, 'url': url,
              'verifiedAt': datetime.now(timezone.utc).isoformat(), 'observations': {}}
    controls = result['observations']
    controls['flowchartMode'] = await geometry(button(page, 'Flowchart Mode'))
    controls['undo'] = await geometry(button(page, 'Undo'))
    assert controls['flowchartMode']['x'] < 0, f'Expected offscreen baseline mode was absent: {controls}'
    assert controls['undo']['x'] < 0, f'Expected offscreen baseline Undo was absent: {controls}'
    for theme in ('dark', 'light'):
        await capture(page, output, f'before-390-flowchart-{theme}.png')
        await button(page, 'Draw Mode').tap()
        await page.get_by_test_id('draw-surface').wait_for()
        await capture(page, output, f'before-390-draw-{theme}.png')
        if theme == 'dark':
            await button(page, 'Toggle Dark Mode').tap()
            await page.evaluate('(key)=>{const d=JSON.parse(localStorage.getItem(key));d.mode="flowchart";localStorage.setItem(key,JSON.stringify(d))}', DRAFT)
            await page.reload(wait_until='domcontentloaded')
            await button(page, 'Draw Mode').wait_for()
            await settle(page)
            await button(page, 'Toggle Dark Mode').tap()
    await button(page, 'More drawing tools').tap()
    menu = page.get_by_role('menu', name='More drawing tools', exact=True)
    controls['moreItem'] = await geometry(menu.get_by_role('menuitem', name='Laser pointer'))
    point = controls['moreItem']
    assert not point['hit'], f'Expected baseline More clipping was absent: {point}'
    # A locator tap may first scroll the clipping ancestor. Tap the displayed
    # item's coordinates directly to test what a user's current view can hit.
    await page.touchscreen.tap(point['x'] + point['width'] / 2, point['y'] + point['height'] / 2)
    controls['moreTapActivatedTool'] = 'tool-laser' in (await page.get_by_test_id('draw-surface').get_attribute('class'))
    assert not controls['moreTapActivatedTool'], f'Expected clipped baseline More tap activated tool: {point}'
    await page.reload(wait_until='domcontentloaded')
    await button(page, 'Share').wait_for()
    await settle(page)
    await button(page, 'Share').tap()
    controls['share'] = await geometry(page.get_by_role('dialog', name='Share flowchart', exact=True))
    assert controls['share']['x'] < 0, f'Expected baseline Share overflow was absent: {controls["share"]}'
    await clean(context, page)
    result['desktopSelection'] = {}
    for theme in ('dark', 'light'):
        context, page = await new_page(browser, url, SCREENS[-1], theme)
        await activate(page.locator('.react-flow__controls-fitview'), SCREENS[-1])
        await activate(page.locator('.react-flow__node').first, SCREENS[-1])
        result['desktopSelection'][theme] = {'sourceRevision': BASE_REVISION, 'viewport': SCREENS[-1].name,
                                            'theme': theme, 'toolbar': await geometry(page.locator('.selection-toolbar')),
                                            'edit': await geometry(button(page, 'Edit with AI'))}
        await clean(context, page)
    (output / 'negative-control.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASS baseline discriminates offscreen modes/history, untappable More item, and overflowing Share', flush=True)
    return result


def read_negative_control(path):
    result = json.loads(path.read_text())
    assert result['sourceRevision'] == BASE_REVISION, 'Negative control must identify the clean base revision'
    controls = result['observations']
    assert controls['flowchartMode']['x'] < 0 and controls['undo']['x'] < 0, 'Negative control did not observe offscreen modes/history'
    assert not controls['moreItem']['hit'] and not controls['moreTapActivatedTool'], 'Negative control did not observe More clipping'
    assert controls['share']['x'] < 0, 'Negative control did not observe Share overflow'
    return result


async def graph_checks(page, screen, add_name='Add Step Node'):
    observations = {}
    for name in ('Flowchart Mode', 'Architecture Mode', 'Draw Mode', 'Undo', 'Redo', 'Toggle Explorer', 'Share'):
        observations[name] = await target(button(page, name), screen, name, hit=await button(page, name).is_enabled())
    for name in ('Selection Tool', 'Hand Tool', 'Arrow Tool'):
        observations[name] = await target(button(page, name), screen, name)
    pinned = {name: await geometry(button(page, name)) for name in ('Selection Tool', 'Hand Tool', 'Arrow Tool')}
    palette = page.locator('.graph-palette')
    box = await geometry(palette)
    scroll_before = await palette.evaluate('n=>n.scrollLeft')
    if screen.touch and await palette.evaluate('n=>n.scrollWidth>n.clientWidth+1'):
        await touch_drag(page, (box['x'] + box['width'] - 12, box['y'] + box['height'] / 2),
                         (box['x'] + 12, box['y'] + box['height'] / 2))
        assert await palette.evaluate('n=>n.scrollLeft') > scroll_before, 'Node palette did not respond to a touch swipe'
        for name, original in pinned.items():
            current = await geometry(button(page, name))
            assert abs(original['x'] - current['x']) < 1 and abs(original['y'] - current['y']) < 1, f'{name} moved with palette'
        await button(page, add_name).scroll_into_view_if_needed()
    original_count = len((await saved(page))['nodes'])
    await tap(page, add_name, screen)
    await wait_saved(page, f'doc.nodes.length==={original_count + 1}')
    await tap(page, 'Undo', screen)
    await wait_saved(page, f'doc.nodes.length==={original_count}')
    await tap(page, 'Redo', screen)
    await wait_saved(page, f'doc.nodes.length==={original_count + 1}')
    await tap(page, 'Undo', screen)
    await wait_saved(page, f'doc.nodes.length==={original_count}')
    for control in await page.locator('.react-flow__controls-button').all():
        name = await control.get_attribute('aria-label') or await control.get_attribute('title') or 'Graph navigation'
        await target(control, screen, name, hit=await control.is_enabled())
    navigation = await geometry(page.locator('.react-flow__controls'))
    ai = await target(button(page, 'Open AI Assistant'), screen, 'Graph AI entry')
    separate(navigation, ai, 'Graph navigation and AI entry')
    observations['navigation'] = navigation
    observations['AI entry'] = ai
    return observations


async def graph_selection(page, screen, desktop_baseline=None):
    await activate(page.locator('.react-flow__controls-fitview'), screen)
    await activate(page.locator('.react-flow__node').first, screen)
    selection = page.locator('.selection-toolbar')
    await expect(selection).to_be_visible()
    await settle(page)
    box = await geometry(selection)
    bounded(box, screen, 'Graph selection actions', 4)
    toolbar = await geometry(page.locator('.floating-toolbar'))
    assert box['y'] >= toolbar['y'] + toolbar['height'], f'Selection actions overlap top toolbar: {box}, {toolbar}'
    await inputs(selection, screen)
    if screen.touch:
        await panel_controls(selection, screen)
    else:
        assert desktop_baseline and desktop_baseline['sourceRevision'] == BASE_REVISION, 'A clean-base desktop selection measurement is required'
        current = await geometry(button(page, 'Edit with AI'))
        original = desktop_baseline['edit']
        assert all(abs(current[key] - original[key]) < .01 for key in ('x', 'y', 'width', 'height')), f'Desktop Edit with AI changed from its baseline geometry: {original}, {current}'
        assert current['hit'] == original['hit'] and [point['hit'] for point in current['hitPoints']] == [point['hit'] for point in original['hitPoints']], 'Desktop Edit with AI hit area changed from baseline'
        box['preservedDesktopClipping'] = {'control': 'Edit with AI', 'baseline': original, 'current': current}
        await panel_controls(selection, screen, selector='button:not([aria-label="Edit with AI"]),a[href],select')
    if screen.touch:
        await page.touchscreen.tap(2, screen.height * .6)
    else:
        await page.mouse.click(2, screen.height * .6)
    await expect(selection).to_have_count(0)
    return box


async def chrome_panels(page, screen):
    more = await more_button(page)
    if await more.is_visible():
        await target(more, screen, 'More actions')
        assert await more.get_attribute('aria-controls'), 'More actions has no controlled menu'
        await activate(more, screen)
        await expect(more).to_have_attribute('aria-expanded', 'true')
        menu = page.locator('#' + await more.get_attribute('aria-controls'))
        bounded(await geometry(menu), screen, 'More actions', 4)
        await panel_controls(menu, screen)
        await button(page, 'Close actions').scroll_into_view_if_needed()
        await tap(page, 'Close actions', screen)
        await expect(more).to_have_attribute('aria-expanded', 'false')
        await expect(more).to_be_focused()
        await activate(more, screen)
        await page.keyboard.press('Escape')
        await expect(more).to_have_attribute('aria-expanded', 'false')
        await expect(more).to_be_focused()
        await activate(more, screen)
        await page.touchscreen.tap(2, screen.height - 2)
        await expect(more).to_have_attribute('aria-expanded', 'false')
    await utility(page, screen, 'Export')
    export = page.locator('.export-dropdown')
    if await (await more_button(page)).is_visible():
        bounded(await geometry(page.locator('#toolbar-utilities')), screen, 'More host containing inline Export', 4)
    else:
        bounded(await geometry(export), screen, 'Export menu', 4)
    await inputs(export, screen)
    await panel_controls(export, screen)
    await page.keyboard.press('Escape')
    await utility(page, screen, "What's new")
    notes = page.get_by_role('dialog', name="What's new", exact=True)
    bounded(await geometry(notes.locator('.patch-notes-dialog')), screen, 'Patch notes', 4)
    await panel_controls(notes, screen)
    await activate(notes.get_by_role('button', name='Got it', exact=True), screen)
    await tap(page, 'Share', screen)
    share = page.get_by_role('dialog', name='Share flowchart', exact=True)
    bounded(await geometry(share), screen, 'Share', 4)
    await inputs(share, screen)
    await panel_controls(share, screen)
    await tap(page, 'Close share' if await button(page, 'Close share').is_visible() else 'Share', screen)
    await expect(share).to_have_count(0)
    await tap(page, 'Share', screen)
    await page.keyboard.press('Escape')
    await expect(share).to_have_count(0)
    await tap(page, 'Toggle Explorer', screen)
    explorer = page.locator('.explorer-sidebar')
    bounded(await geometry(explorer), screen, 'Explorer')
    await inputs(explorer, screen)
    close_explorer = explorer.locator('.explorer-close')
    await target(close_explorer, screen, 'Close Explorer')
    await activate(close_explorer, screen)
    await settle(page)


async def draw_checks(page, screen):
    await tap(page, 'Draw Mode', screen)
    await page.get_by_test_id('draw-surface').wait_for()
    properties = page.get_by_label('Drawing properties', exact=True)
    if screen.touch:
        await expect(properties).to_be_hidden()
    else:
        await expect(properties).to_be_visible()
    await tap(page, 'Fit drawing', screen)
    fitted = await geometry(page.locator('[data-draw-viewport]'))
    bounded(fitted, screen, 'Fitted drawing')
    if screen.touch and screen.width <= 430 and screen.height > screen.width:
        assert fitted['width'] >= screen.width * .6, f'Fit leaves this wide drawing below 60% of the phone width: {fitted}'
    fitted['transform'] = await page.locator('[data-draw-viewport]').get_attribute('transform')
    names = ('Zoom out', 'Zoom in', 'Fit drawing', 'Undo drawing', 'Redo drawing', 'Snap to grid', 'Snap to objects', 'Keyboard shortcuts', 'Components', 'More drawing tools', 'Keep tool selected')
    observed = {}
    for name in names:
        observed[name] = await target(button(page, name), screen, name, hit=await button(page, name).is_enabled())
    ai = await target(button(page, 'Open AI Assistant'), screen, 'AI entry')
    for name, box in observed.items():
        separate(ai, box, f'AI entry and {name}')
    navigation = await geometry(page.locator('.draw-bottom-controls'))
    separate(navigation, ai, 'Draw navigation and AI entry')
    separate(navigation, observed['Keyboard shortcuts'], 'Draw navigation and Help')
    await tap(page, 'More drawing tools', screen)
    more = page.get_by_role('menu', name='More drawing tools', exact=True)
    bounded(await geometry(more), screen, 'More drawing tools menu', 4)
    await panel_controls(more, screen)
    laser = more.get_by_role('menuitem', name='Laser pointer')
    await laser.scroll_into_view_if_needed()
    laser_box = await target(laser, screen, 'Laser pointer menuitem')
    right_point = (laser_box['x'] + laser_box['width'] - 12, laser_box['y'] + laser_box['height'] / 2)
    if screen.touch:
        await page.touchscreen.tap(*right_point)
    else:
        await page.mouse.click(*right_point)
    await expect(page.get_by_test_id('draw-surface')).to_have_class(re.compile(r'tool-laser'))
    await expect(more).to_have_count(0)
    await tap(page, 'More drawing tools', screen)
    await page.keyboard.press('Escape')
    await expect(button(page, 'More drawing tools')).to_be_focused()
    await draw_tool(page, 'Frame tool', screen)
    await expect(page.get_by_test_id('draw-surface')).to_have_class(re.compile(r'tool-frame'))
    if screen.touch:
        toggle = page.get_by_role('button', name=re.compile(r'^(?:Appearance|Selection)(?: properties)?$')).first
        await target(toggle, screen, 'Appearance/Selection toggle')
        await activate(toggle, screen)
        await expect(properties).to_be_visible()
    bounded(await geometry(properties), screen, 'Drawing properties')
    field_observations = await inputs(properties, screen)
    width = properties.get_by_role('spinbutton', name='Stroke width', exact=True)
    await width.fill('5')
    await width.press('Tab')
    if screen.touch:
        await tap(page, 'Components', screen)
        await expect(properties).to_be_hidden()
    else:
        await tap(page, 'Components', screen)
    library = page.get_by_role('dialog', name='Your components', exact=True)
    bounded(await geometry(library), screen, 'Components')
    assert not await library.locator('input').evaluate('n=>n===document.activeElement'), 'Opening Components autofocused its name input'
    await inputs(library, screen)
    await panel_controls(library, screen)
    if screen.touch:
        await library.get_by_label('Component name', exact=True).fill('Retained local component name')
        toggle = page.get_by_role('button', name=re.compile(r'^(?:Appearance|Selection)(?: properties)?$')).first
        await activate(toggle, screen)
        await expect(library).to_have_count(0)
        await expect(properties).to_be_visible()
        await expect(width).to_have_value('5')
        await tap(page, 'Components', screen)
        await expect(properties).to_be_hidden()
        await expect(library.get_by_label('Component name', exact=True)).to_have_value('Retained local component name')
    await tap(page, 'Close components', screen)
    if screen.touch:
        toggle = page.get_by_role('button', name=re.compile(r'^(?:Appearance|Selection)(?: properties)?$')).first
        await activate(toggle, screen)
    await expect(width).to_have_value('5')
    if screen.touch:
        await tap(page, 'Close drawing properties', screen)
        await expect(properties).to_be_hidden()
    canvas = page.locator('.draw-canvas')
    canvas_before = await geometry(canvas)
    scroll_before = await canvas.evaluate('n=>n.scrollLeft')
    await tap(page, 'Keyboard shortcuts', screen)
    help_dialog = page.get_by_role('dialog', name='Drawing shortcuts', exact=True)
    if screen.touch:
        await expect(button(page, 'Open AI Assistant')).to_be_hidden()
    help_box = await geometry(help_dialog)
    bounded(help_box, screen, 'Drawing shortcuts', 4)
    help_overlay = await geometry(page.locator('.draw-help-overlay'))
    bounded(help_overlay, screen, 'Drawing shortcuts overlay')
    await panel_controls(help_dialog, screen)
    await tap(page, 'Close keyboard shortcuts', screen)
    await target(button(page, 'Open AI Assistant'), screen, 'AI entry restored after Help')
    canvas_after = await geometry(canvas)
    scroll_after = await canvas.evaluate('n=>n.scrollLeft')
    assert scroll_before == 0 and scroll_after == 0, f'Help horizontally scrolled the drawing canvas: {scroll_before}, {scroll_after}'
    assert all(abs(canvas_before[key] - canvas_after[key]) < .5 for key in ('x', 'y', 'width', 'height')), f'Help moved the drawing canvas: {canvas_before}, {canvas_after}'
    return {'controls': observed, 'navigation': navigation, 'AI entry': ai, 'fit': fitted, 'propertiesInputs': field_observations,
            'help': {'dialog': help_box, 'overlay': help_overlay, 'canvasBefore': canvas_before, 'canvasAfter': canvas_after,
                     'scrollLeftBefore': scroll_before, 'scrollLeftAfter': scroll_after}}


async def drawing_gestures(page, screen):
    await draw_tool(page, 'Rectangle tool', screen)
    before = await saved(page)
    count = len(before['architectureScene']['elements'])
    visible_ids = set(await page.locator('.draw-surface [data-element-id]').evaluate_all('nodes=>nodes.map(n=>n.getAttribute("data-element-id"))'))
    area = await page.evaluate('''() => {
        const surface=document.querySelector('[data-testid="draw-surface"]'), r=surface.getBoundingClientRect();
        for(let y=r.y+80;y<innerHeight-140;y+=40) {
            for(let x=20;x<innerWidth-150;x+=60) {
                const points=[[x,y],[x+130,y],[x,y+65],[x+130,y+65],[x+65,y+32]];
                if(points.every(([px,py])=>surface.contains(document.elementFromPoint(px,py)))) return {left:x,top:y};
            }
        }
        return null;
    }''')
    assert area, 'No unobscured SVG area is available for a130x65 touch drawing'
    left, top = area['left'], area['top']
    await touch_drag(page, (left, top), (left + 130, top + 65))
    await page.wait_for_function('(count)=>document.querySelectorAll(".draw-surface [data-element-id]").length===count', arg=len(visible_ids) + 1)
    current_ids = set(await page.locator('.draw-surface [data-element-id]').evaluate_all('nodes=>nodes.map(n=>n.getAttribute("data-element-id"))'))
    added_id, = current_ids - visible_ids
    await wait_saved(page, 'doc.architectureScene.elements.some(e=>e.id===' + json.dumps(added_id) + ')')
    after = await saved(page)
    added = next(element for element in after['architectureScene']['elements'] if element['id'] == added_id)
    assert added['type'] == 'rectangle' and added['width'] > 0 and added['height'] > 0, f'Touch drawing did not create a rectangle: {added}'
    rendered = await geometry(page.locator('[data-element-id=' + json.dumps(added['id']) + ']'))
    assert rendered['width'] >= 100 and rendered['height'] >= 50, f'Touch gesture created a small rendered rectangle: {rendered}'
    transform = page.locator('[data-draw-viewport]')
    original_transform = await transform.get_attribute('transform')
    await draw_tool(page, 'Hand tool', screen)
    await touch_drag(page, (left + 20, top + 20), (left + 85, top + 45))
    assert await transform.get_attribute('transform') != original_transform, 'Hand touch drag did not pan drawing'
    await page.wait_for_timeout(650)
    assert (await saved(page))['architectureScene']['elements'] == after['architectureScene']['elements'], 'Hand panning mutated drawing elements'
    await tap(page, 'Undo drawing', screen)
    await wait_saved(page, f'doc.architectureScene.elements.length==={count}')
    await tap(page, 'Redo drawing', screen)
    await wait_saved(page, f'doc.architectureScene.elements.length==={len(after["architectureScene"]["elements"])}')
    return {'drawnType': added['type'], 'worldWidth': added['width'], 'worldHeight': added['height'], 'rendered': rendered, 'gestureStart': area, 'handPanChangedViewport': True}


async def draw_ai_editor(page, screen):
    await draw_tool(page, 'Selection tool', screen)
    await tap(page, 'Fit drawing', screen)
    shape = page.locator('[data-element-id="retained-box"]')
    shape_box = await geometry(shape)
    await page.touchscreen.tap(shape_box['x'] + shape_box['width'] / 2, shape_box['y'] + shape_box['height'] * .15)
    await expect(shape).to_have_attribute('data-selected', 'true')
    toggle = button(page, 'Selection')
    await target(toggle, screen, 'Selection properties')
    await activate(toggle, screen)
    properties = page.get_by_label('Drawing properties', exact=True)
    bounded(await geometry(properties), screen, 'Selection properties')
    await inputs(properties, screen)
    await panel_controls(properties, screen)
    editor_entry = properties.get_by_role('button', name='Edit selection with AI', exact=True)
    await editor_entry.scroll_into_view_if_needed()
    await target(editor_entry, screen, 'Edit selection with AI')
    before = await saved(page)
    await activate(editor_entry, screen)
    editor = page.get_by_role('dialog', name='Edit Draw selection with AI', exact=True)
    await expect(editor).to_be_visible()
    await settle(page)
    bounded(await geometry(editor), screen, 'Draw AI editor', 4)
    await inputs(editor, screen)
    await panel_controls(editor, screen)
    await editor.locator('textarea').fill('Keep this selected shape green. This request stays unsent.')
    await activate(editor.get_by_role('button', name='Close Draw AI editor', exact=True), screen)
    await expect(editor).to_have_count(0)
    await page.wait_for_timeout(650)
    assert await saved(page) == before, 'Opening and closing the unsent Draw AI editor changed the document'
    await tap(page, 'Close drawing properties', screen)


async def ai_review_and_import(page, screen, output, screenshot=False):
    await tap(page, 'Open AI Assistant', screen)
    ai = page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)
    bounded(await geometry(ai.locator('.ai-bubble-prompt')), screen, 'AI prompt', 4)
    await inputs(ai, screen)
    await panel_controls(ai, screen)
    await ai.locator('textarea.ai-bubble-input').fill('Review this unsent mobile fixture.')
    await ai.get_by_role('combobox', name='Generate for', exact=True).select_option('draw')
    original = await saved(page)
    page._mobile_proposal_fixture = True
    await activate(ai.locator('button.ai-bubble-send'), screen)
    preview = page.get_by_role('dialog', name='Preview AI Proposal', exact=True)
    await expect(preview).to_be_visible()
    await settle(page)
    bounded(await geometry(preview.locator('.ai-preview-dialog')), screen, 'AI proposal review')
    await inputs(preview, screen)
    await panel_controls(preview, screen)
    assert await saved(page) == original, 'Reviewing proposal changed document before insertion'
    assert len(page._mobile_requests) == 1 and page._mobile_requests[0]['diagramMode'] == 'draw', 'Expected one browser-routed AI fixture'
    if screenshot:
        await capture(page, output, 'after-390-ai-review-dark.png')
    await activate(preview.get_by_role('button', name='Insert into Canvas', exact=True), screen)
    await expect(preview).to_have_count(0)
    await wait_saved(page, f'doc.architectureScene.elements.length>{len(original["architectureScene"]["elements"])}')
    await utility(page, screen, 'Export')
    field = page.get_by_label('Import JSON or Excalidraw file', exact=True)
    fixture = ROOT / 'src/test/fixtures/excalidraw/architecture-complete.excalidraw'
    await field.set_input_files({'name': 'mobile-proof.excalidraw', 'mimeType': 'application/json', 'buffer': fixture.read_bytes()})
    importing = page.get_by_role('dialog', name='Bring your drawing in', exact=True)
    await expect(importing).to_be_visible()
    await settle(page)
    bounded(await geometry(importing), screen, 'Excalidraw import', 4)
    await inputs(importing, screen)
    await panel_controls(importing, screen)
    await page.keyboard.press('Escape')
    await expect(importing).to_have_count(0)


async def fresh_dialogs(browser, url, screen, theme, output):
    context, page = await new_page(browser, url, screen, theme, fresh=True)
    notes = page.get_by_role('dialog', name="What's new", exact=True)
    await expect(notes).to_be_visible()
    bounded(await geometry(notes.locator('.patch-notes-dialog')), screen, 'Fresh patch notes', 4)
    await panel_controls(notes, screen)
    await activate(notes.get_by_role('button', name='Got it', exact=True), screen)
    welcome = page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)
    await expect(welcome).to_be_visible()
    await settle(page)
    bounded(await geometry(welcome), screen, 'Fresh AI welcome', 4)
    await inputs(welcome, screen)
    await panel_controls(welcome, screen)
    await clean(context, page)


async def positive_case(browser, url, screen, theme, output, desktop_baseline=None):
    context, page = await new_page(browser, url, screen, theme)
    result = {'screen': screen.name, 'theme': theme, 'context': await no_page_overflow(page, screen)}
    result['graph'] = await graph_checks(page, screen)
    result['graphSelection'] = await graph_selection(page, screen, desktop_baseline)
    await tap(page, 'Architecture Mode', screen)
    result['architecture'] = await graph_checks(page, screen, add_name='Add Service Node')
    await tap(page, 'Flowchart Mode', screen)
    if screen == SCREENS[0] or screen == SCREENS[2] and theme == 'dark' or not screen.touch and theme == 'dark':
        await capture(page, output, f'after-{screen.name}-flowchart-{theme}.png')
    await chrome_panels(page, screen)
    result['draw'] = await draw_checks(page, screen)
    if screen == SCREENS[0] or screen == SCREENS[2] and theme == 'dark' or not screen.touch and theme == 'dark':
        await capture(page, output, f'after-{screen.name}-draw-{theme}.png')
    if screen in (SCREENS[0], SCREENS[2]) and theme == 'dark':
        result['gestures'] = await drawing_gestures(page, screen)
        await draw_ai_editor(page, screen)
        await ai_review_and_import(page, screen, output, screenshot=screen == SCREENS[0])
    await no_page_overflow(page, screen)
    await clean(context, page)
    print(f'PASS {screen.name} {theme} ({"touch" if screen.touch else "desktop"})', flush=True)
    return result


async def runtime_assets(page, url):
    await page.goto(url, wait_until='domcontentloaded')
    await button(page, 'Draw Mode').wait_for()
    await page.evaluate('document.fonts.ready')
    scripts = await page.locator('script[src],link[rel="stylesheet"][href]').evaluate_all('nodes=>nodes.map(n=>n.src||n.href)')
    assets = []
    for script in scripts:
        if urlsplit(script).netloc != urlsplit(url).netloc:
            continue
        response = await page.request.get(script)
        assert response.ok, f'Entry asset could not be read: {script} ({response.status})'
        assets.append({'url': script, 'status': response.status, 'sha256': hashlib.sha256(await response.body()).hexdigest()})
    return assets


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?')
    parser.add_argument('--source-revision')
    baseline_source = parser.add_mutually_exclusive_group(required=True)
    baseline_source.add_argument('--baseline-url')
    baseline_source.add_argument('--baseline-report', type=Path)
    parser.add_argument('--baseline-only', action='store_true')
    parser.add_argument('--resume-report', type=Path, help='Retain completed cases from the same immutable source revision and URL')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    if args.baseline_only and not args.baseline_url:
        parser.error('--baseline-only requires --baseline-url')
    if not args.baseline_only and (not args.url or not re.fullmatch('[0-9a-f]{40}', args.source_revision or '')):
        parser.error('A URL and full immutable --source-revision are required for final proof')
    args.output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        baseline = await negative_control(browser, args.baseline_url, args.output) if args.baseline_url else read_negative_control(args.baseline_report)
        if args.baseline_only:
            await browser.close()
            return
        report = {'sourceRevision': args.source_revision, 'url': args.url,
                  'verifiedAt': datetime.now(timezone.utc).isoformat(), 'chromium': browser.version,
                  'playwright': version('playwright'), 'negativeControl': baseline, 'cases': [],
                  'aiFixture': {'path': str(AI_FIXTURE.relative_to(ROOT)), 'sha256': hashlib.sha256(AI_FIXTURE.read_bytes()).hexdigest()},
                  'limits': ['Chromium touch emulation only. Native WebKit and physical Safari were unavailable.',
                             'Physical iPhone keyboard, browser chrome, notch, and safe-area behavior are unverified.',
                             'AI responses are browser-routed fixtures. All other API requests are aborted.',
                             'Desktop Edit with AI retains a pre-existing partial right-edge clip. Its geometry and sampled hit area must exactly match the clean base; other desktop controls and all touch controls have strict bounds checks.',
                             'Screenshot device scale is 1; viewport sizes are CSS pixels.']}
        completed = set()
        if args.resume_report:
            previous = json.loads(args.resume_report.read_text())
            assert previous['sourceRevision'] == args.source_revision and previous['url'] == args.url, 'Resume requires the same immutable source revision and URL'
            assert previous['chromium'] == browser.version and previous['playwright'] == version('playwright'), 'Resume requires the same browser and Playwright versions'
            expected = {(screen.name, theme) for screen in SCREENS for theme in ('dark', 'light')}
            completed = {(case['screen'], case['theme']) for case in previous['cases']}
            assert len(completed) == len(previous['cases']) and completed <= expected, 'Resume report contains duplicate or unexpected cases'
            report['cases'] = previous['cases']
            report['continuations'] = previous.get('continuations', []) + [{'resumedAt': datetime.now(timezone.utc).isoformat(), 'retainedCases': sorted(completed)}]
        for screen in SCREENS:
            for theme in ('dark', 'light'):
                if (screen.name, theme) in completed:
                    continue
                try:
                    report['cases'].append(await positive_case(browser, args.url, screen, theme, args.output, baseline.get('desktopSelection', {}).get(theme)))
                except Exception as error:
                    report['failure'] = {'screen': screen.name, 'theme': theme, 'error': str(error)}
                    (args.output / 'failure.json').write_text(json.dumps(report, indent=2) + '\n')
                    raise
        for screen in (SCREENS[0], SCREENS[1], SCREENS[2]):
            await fresh_dialogs(browser, args.url, screen, 'dark', args.output)
        context = await browser.new_context()
        page = await context.new_page()
        await page.route('**/api/**', lambda route: route.abort())
        report['entryAssets'] = await runtime_assets(page, args.url)
        await context.close()
        report['checks'] = ['All named modes, history and primary tools have visible bounded touch targets.',
                            'Graph palette responds to touch while primary tools stay pinned; add/undo/redo preserve document behavior.',
                            'More utilities, Export, Share, Explorer, notes, properties and Components stay bounded.',
                            'Drawing properties and Components coordinate without losing edits; opening Components does not autofocus input.',
                            'More Laser receives a real tap outside the scrolling tool clip; primary Frame stays reachable; touch drawing and hand pan work.',
                            'Draw navigation, Snap and AI hitboxes stay visible and do not overlap.',
                            'Editable UI fields have at least 16px fonts and 44px targets in touch contexts.',
                            'Fresh notes/welcome, AI prompt/proposal and import fixtures fit short viewports without live API calls.']
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        await browser.close()
    print(f'PASS 12 viewport/theme cases plus fresh-dialog and fixture scenarios. Evidence in {args.output}', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
