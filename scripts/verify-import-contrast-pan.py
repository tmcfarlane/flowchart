"""Verify real-file import contrast and held-right-button panning on our Draw UI.

Use --expect-bug once before a renderer/controller fix to record the regression.
Normal runs assert WCAG text contrast, transient grabbing state, viewport-only
movement, unchanged drawing data, and readable imports in dark and light themes.
"""
from pathlib import Path
import argparse
import json
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'src/test/fixtures/excalidraw/dark-pastel-contrast.excalidraw'
DRAFT = 'flowchart-editor-draft-v3'
parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:3016/')
parser.add_argument('--expect-bug', action='store_true')
args = parser.parse_args()
OUTPUT = ROOT / 'docs/screenshots/excalidraw-import' if not args.expect_bug else Path('/workspace/scratch/excalidraw-import-regression')
OUTPUT.mkdir(parents=True, exist_ok=True)


def rgb(value):
    value = value.strip().lower()
    if value.startswith('#'):
        value = value[1:]
        if len(value) == 3:
            value = ''.join(character * 2 for character in value)
        return [int(value[index:index + 2], 16) / 255 for index in [0, 2, 4]]
    numbers = re.findall(r'[\d.]+', value)
    if value.startswith('rgb') and len(numbers) >= 3:
        return [float(number) / 255 for number in numbers[:3]]
    raise AssertionError(f'Expected a concrete rendered color, got {value}')


def luminance(value):
    channels = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in rgb(value)]
    return sum(weight * channel for weight, channel in zip([0.2126, 0.7152, 0.0722], channels))


def contrast(foreground, background):
    a, b = sorted([luminance(foreground), luminance(background)])
    return (b + 0.05) / (a + 0.05)


def document(page):
    return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)||"{}")', DRAFT)


def matrix(page):
    return page.evaluate('()=>{const m=document.querySelector("[data-drawing-layer]").getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f];}')


def colors(page):
    scene = document(page)['architectureScene']
    elements = {element['id']: element for element in scene['elements']}
    canvas = scene['appState']['viewBackgroundColor']
    result = []
    for element in scene['elements']:
        if element['type'] != 'text':
            continue
        host = elements.get(element.get('containerId'))
        background = host['backgroundColor'] if host and host['type'] in ['rectangle', 'ellipse', 'diamond'] else canvas
        rendered = page.locator(f'[data-element-id="{element["id"]}"] text').evaluate('(text)=>getComputedStyle(text).fill')
        result.append({'text': element['text'], 'role': element.get('customData', {}).get('fixtureRole'), 'source': element['strokeColor'], 'rendered': rendered, 'background': background, 'contrast': round(contrast(rendered, background), 3)})
    return result


def pick(page, scene):
    if not page.get_by_label('Import JSON or Excalidraw file').count():
        page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files({'name': 'pastel-contrast.excalidraw', 'mimeType': '', 'buffer': json.dumps(scene).encode()})
    page.get_by_role('button', name='Open as new diagram').click()
    page.get_by_role('application', name='Drawing surface').wait_for()
    page.wait_for_function('({key,count,background})=>{const doc=JSON.parse(localStorage.getItem(key)||"{}");return doc.mode==="draw"&&doc.architectureScene?.elements.length===count&&doc.architectureScene?.appState?.viewBackgroundColor===background;}', arg={'key': DRAFT, 'count': len(scene['elements']), 'background': scene['appState']['viewBackgroundColor']})


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='networkidle')
    scene = json.loads(FIXTURE.read_text())
    pick(page, scene)
    dark = colors(page)
    page.screenshot(path=str(OUTPUT / ('before-dark-contrast.png' if args.expect_bug else '06-dark-pastel-contrast.png')), full_page=True)
    print('DARK IMPORT CONTRAST:', json.dumps(dark), flush=True)
    if not args.expect_bug:
        assert all(item['contrast'] >= 4.5 for item in dark), dark

    # Panning must win over an active drawing tool while the RIGHT button is
    # physically held, including when the drag starts on an imported object.
    page.get_by_role('button', name='Rectangle tool', exact=True).click()
    before = document(page)
    client = next(element for element in before['architectureScene']['elements'] if element.get('customData', {}).get('fixtureRole') == 'pastel-client')
    start = page.evaluate('(point)=>{const p=new DOMPoint(point.x,point.y).matrixTransform(document.querySelector("[data-drawing-layer]").getScreenCTM());return {x:p.x,y:p.y};}', {'x': client['x'] + client['width'] * 0.25, 'y': client['y'] + client['height'] * 0.2})
    surface = page.get_by_role('application', name='Drawing surface')
    page.evaluate('()=>{window.__rightPanProbe={buttons:[],context:null};document.querySelector("[data-testid=draw-surface]").addEventListener("pointermove",event=>window.__rightPanProbe.buttons.push(event.buttons));document.addEventListener("contextmenu",event=>{window.__rightPanProbe.context=event;},true);}')
    before_matrix = matrix(page)
    page.mouse.move(start['x'], start['y'])
    page.mouse.down(button='right')
    page.mouse.move(start['x'] + 120, start['y'] + 75, steps=12)
    while_held = matrix(page)
    cursor_held = surface.evaluate('(svg)=>getComputedStyle(svg).cursor')
    page.screenshot(path=str(OUTPUT / ('before-right-hold.png' if args.expect_bug else '08-right-held-pan.png')), full_page=True)
    page.mouse.up(button='right')
    page.wait_for_timeout(650)
    pan = {
        'deltaX': while_held[4] - before_matrix[4], 'deltaY': while_held[5] - before_matrix[5],
        'scaleBefore': before_matrix[0], 'scaleDuring': while_held[0],
        'cursorDuring': cursor_held, 'cursorAfter': surface.evaluate('(svg)=>getComputedStyle(svg).cursor'),
        'documentUnchanged': document(page) == before,
        'rectangleToolRetained': page.get_by_role('button', name='Rectangle tool', exact=True).get_attribute('aria-pressed') == 'true',
        'buttonsDuringMove': page.evaluate('window.__rightPanProbe.buttons'),
        'contextMenuPrevented': page.evaluate('window.__rightPanProbe.context?.defaultPrevented ?? null'),
    }
    print('RIGHT-HOLD PAN:', json.dumps(pan), flush=True)
    if args.expect_bug:
        assert any(item['contrast'] < 4.5 for item in dark), 'Expected the old import contrast bug to be present'
        assert abs(pan['deltaX']) < 1 or not pan['documentUnchanged'], 'Expected the old right-button gesture bug to be present'
        print('BEFORE REGRESSIONS REPRODUCED', flush=True)
    else:
        assert abs(pan['deltaX'] - 120) < 0.002 and abs(pan['deltaY'] - 75) < 0.002, pan
        assert abs(pan['scaleBefore'] - pan['scaleDuring']) < 0.00001, pan
        assert pan['cursorDuring'] == 'grabbing' and pan['cursorAfter'] != 'grabbing', pan
        assert pan['documentUnchanged'] and pan['rectangleToolRetained'], pan
        assert 2 in pan['buttonsDuringMove'] and all(value in [0, 2] for value in pan['buttonsDuringMove']), pan
        assert pan['contextMenuPrevented'] is True, pan
        page.get_by_role('button', name='Toggle Dark Mode').click()
        light_scene = {**scene, 'appState': {**scene['appState'], 'viewBackgroundColor': '#f8fafc'}}
        pick(page, light_scene)
        light = colors(page)
        assert all(item['contrast'] >= 4.5 for item in light), light
        page.screenshot(path=str(OUTPUT / '07-light-pastel-contrast.png'), full_page=True)
        print('LIGHT IMPORT CONTRAST:', json.dumps(light), flush=True)
        assert not errors, errors
        print('CONTRAST + RIGHT-HOLD REGRESSIONS: PASS; browser errors:', errors, flush=True)
    browser.close()
