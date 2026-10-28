import argparse
import io
import json
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/draw-arrowheads'
DRAFT = 'flowchart-editor-draft-v3'


def element(identifier, kind, x, y, width, height, stroke_width=2, **extra):
    value = dict(id=identifier, type=kind, x=x, y=y, width=width, height=height,
                 angle=0, strokeColor='#0f766e', backgroundColor='transparent',
                 strokeWidth=stroke_width, strokeStyle='solid', fillStyle='solid',
                 roughness=0, opacity=100, groupIds=[], frameId=None,
                 isDeleted=False, locked=False)
    value.update(extra)
    return value


def fixture():
    items = []
    cases = [
        ('thin', 1, 'arrow', None, None),
        ('regular', 2, 'arrow', None, None),
        ('wide', 4, 'arrow', None, None),
        ('reverse', 1, 'triangle', 'arrow', None),
        ('curved', 2, 'triangle_outline', 'triangle', 'curved'),
        ('elbow', 2, 'diamond', 'diamond_outline', 'elbow'),
        ('dots', 2, 'dot', 'dot_outline', None),
        ('circles', 2, 'circle', 'circle_outline', None),
        ('crowfoot', 2, 'crowfoot_one_or_many', 'crowfoot_many', None),
        ('bar', 1, 'bar', 'crowfoot_one', None),
    ]
    for index, (name, stroke_width, end, start, route) in enumerate(cases):
        y = 110 + index * 92
        source, target = f'{name}-source', f'{name}-target'
        items.append(element(source, 'rectangle', 320, y - 35, 130, 70,
                             backgroundColor='#194f44', roundness={'type': 3}))
        items.append(element(target, 'diamond', 720, y - 40, 110, 80,
                             backgroundColor='#194f44', strokeColor='#e8f4ee'))
        points = [[0, 0], [270, 0]]
        if route == 'curved':
            points = [[0, 0], [135, -25], [270, 0]]
        if route == 'elbow':
            points = [[0, 0], [135, 0], [135, -25], [270, -25], [270, 0]]
        items.append(element(name, 'arrow', 450, y, 270, 0, stroke_width,
                             points=points, startArrowhead=start, endArrowhead=end,
                             startBinding={'elementId': source, 'focus': 0, 'gap': 0},
                             endBinding={'elementId': target, 'focus': 0, 'gap': 0},
                             curved=route == 'curved', elbowed=route == 'elbow'))
        items.append(element(f'{name}-label', 'text', 333, y - 15, 100, 30,
                             text=name, originalText=name, fontSize=16, fontFamily=2,
                             textAlign='center', verticalAlign='middle', containerId=source,
                             strokeColor='#ffffff'))
    return {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [],
            'architectureScene': {'version': 1, 'files': {}, 'elements': items,
                                  'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}}}


def saved_scene(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).architectureScene', DRAFT)


def set_zoom(page, zoom):
    page.get_by_role('region', name='Draw canvas').focus()
    page.keyboard.press('Control+0')
    page.wait_for_function("document.querySelector('[data-draw-viewport]')?.getAttribute('transform')?.endsWith('scale(1)')")
    if zoom != 1:
        page.locator('[data-testid="draw-surface"]').evaluate('''(surface, zoom) => {
          const layer = document.querySelector('[data-draw-viewport]');
          const p = new DOMPoint(585, 380).matrixTransform(layer.getScreenCTM());
          surface.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, ctrlKey: true,
            clientX: p.x, clientY: p.y, deltaY: -Math.log(zoom) / 0.002,
          }));
        }''', zoom)
        page.wait_for_function("z => document.querySelector('[data-draw-viewport]')?.getAttribute('transform')?.endsWith(`scale(${z})`)", arg=zoom)


def marker_pixels(with_marker, without_marker, point):
    left = Image.open(io.BytesIO(with_marker)).convert('RGB')
    right = Image.open(io.BytesIO(without_marker)).convert('RGB')
    x0, x1 = max(0, int(point['x']) - 38), min(left.width, int(point['x']) + 39)
    y0, y1 = max(0, int(point['y']) - 38), min(left.height, int(point['y']) + 39)
    changed = [(x, y) for y in range(y0, y1) for x in range(x0, x1)
               if max(abs(a - b) for a, b in zip(left.getpixel((x, y)), right.getpixel((x, y)))) >= 12]
    if not changed:
        return {'pixels': 0, 'width_px': 0, 'height_px': 0}
    return {'pixels': len(changed),
            'width_px': max(x for x, _ in changed) - min(x for x, _ in changed) + 1,
            'height_px': max(y for _, y in changed) - min(y for _, y in changed) + 1}


def measure(page, name, end):
    attribute = 'marker-end' if end else 'marker-start'
    path = page.locator(f'[data-element-id="{name}"] path[{attribute}]')
    point = path.evaluate('''(path, end) => {
      const position = path.getPointAtLength(end ? path.getTotalLength() : 0);
      const screen = position.matrixTransform(path.getScreenCTM());
      const surface = document.querySelector('[data-testid="draw-surface"]').getBoundingClientRect();
      return {x: screen.x - surface.left, y: screen.y - surface.top};
    }''', end)
    surface = page.locator('[data-testid="draw-surface"]')
    original = path.get_attribute(attribute)
    handle = path.element_handle()
    with_marker = surface.screenshot()
    handle.evaluate('(node, attribute) => node.removeAttribute(attribute)', attribute)
    without_marker = surface.screenshot()
    handle.evaluate('(node, value) => node.setAttribute(value.attribute, value.original)',
                    {'attribute': attribute, 'original': original})
    return {'name': name, 'end': end, 'endpoint_px': point,
            'marker_diff': marker_pixels(with_marker, without_marker, point)}


def export_files(page, output):
    results = {}
    for extension in ('svg', 'png'):
        page.get_by_role('button', name='Export', exact=True).click()
        with page.expect_download() as download:
            page.get_by_role('button', name=f'Export as {extension.upper()}').click()
        target = output / f'after-export.{extension}'
        download.value.save_as(target)
        if extension == 'svg':
            tree = ET.parse(target)
            markers = tree.findall('.//{http://www.w3.org/2000/svg}marker')
            assert len(markers) >= 10, len(markers)
            assert all(marker.get('refX') == '0' and marker.get('refY') == '0' for marker in markers)
            results['svg_markers'] = len(markers)
        else:
            image = Image.open(target)
            assert image.width > 100 and image.height > 100
            assert len(image.convert('RGB').getcolors(maxcolors=1_000_000) or []) > 2
            results['png_size'] = [image.width, image.height]
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:3050/')
    parser.add_argument('--phase', choices=('before', 'after'), required=True)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=shutil.which('chromium'),
                                             headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1500, 'height': 1450},
                                device_scale_factor=1, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        document = fixture()
        page.add_init_script(f'localStorage.setItem({json.dumps(DRAFT)}, {json.dumps(json.dumps(document))})')
        page.goto(args.url)
        page.locator('[data-testid="draw-surface"]').wait_for(timeout=15000)
        assert saved_scene(page) == document['architectureScene']
        for theme in ('dark', 'light'):
            if theme == 'light':
                page.get_by_role('button', name='Toggle Dark Mode').click()
            for zoom in (1.0, 0.5):
                set_zoom(page, zoom)
                page.locator('[data-testid="draw-surface"]').screenshot(
                    path=str(OUTPUT / f'{args.phase}-{theme}-{zoom:.2f}.png'))
                for name in ('thin', 'regular', 'wide', 'reverse', 'curved', 'elbow',
                             'dots', 'circles', 'crowfoot', 'bar'):
                    for end in ((False, True) if name in ('reverse', 'curved', 'elbow',
                                                          'dots', 'circles', 'crowfoot', 'bar') else (True,)):
                        results.append({'theme': theme, 'zoom': zoom, **measure(page, name, end)})
        assert saved_scene(page) == document['architectureScene']
        export = export_files(page, OUTPUT) if args.phase == 'after' else {}
        assert saved_scene(page) == document['architectureScene']
        assert not errors, errors
        browser.close()
    (OUTPUT / f'{args.phase}.json').write_text(json.dumps(results, indent=2) + '\n')
    if args.phase == 'after':
        before = json.loads((OUTPUT / 'before.json').read_text())
        assert len(before) == len(results) == 68
        pairs = zip(before, results)
        for earlier, later in pairs:
            assert (earlier['theme'], earlier['zoom'], earlier['name'], earlier['end']) == (
                later['theme'], later['zoom'], later['name'], later['end'])
            assert all(abs(earlier['endpoint_px'][axis] - later['endpoint_px'][axis]) < 0.001
                       for axis in ('x', 'y')), (earlier, later)
            if later['name'] == 'wide':
                assert later['marker_diff'] == earlier['marker_diff'], (earlier, later)
            else:
                old, new = earlier['marker_diff'], later['marker_diff']
                assert new['pixels'] > 0 and (new['pixels'] > old['pixels'] or
                                             new['width_px'] > old['width_px'] or
                                             new['height_px'] > old['height_px']), (earlier, later)
        summary = {
            'base_commit': '85ec3050aa39248686f31a183420a0b2996d20b1',
            'browser': 'Chromium',
            'theme_zoom_pairs': 4,
            'marker_measurements': len(results),
            'reduced_zoom_dark': {
                name: {
                    phase: next(item['marker_diff'] for item in values
                                if item['theme'] == 'dark' and item['zoom'] == 0.5 and
                                item['name'] == name and item['end'])
                    for phase, values in (('before', before), ('after', results))
                }
                for name in ('thin', 'regular', 'wide')
            },
            'endpoint_positions_unchanged': True,
            'saved_scene_unchanged': True,
            'svg_markers': export['svg_markers'],
            'png_size': export['png_size'],
            'browser_errors': errors,
        }
        (OUTPUT / 'verification.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'phase': args.phase, 'measurements': len(results),
                      'thin_reduced_zoom': [item for item in results if item['name'] == 'thin' and item['zoom'] == 0.5],
                      'regular_reduced_zoom': [item for item in results if item['name'] == 'regular' and item['zoom'] == 0.5],
                      'wide_unchanged': [item for item in results if item['name'] == 'wide' and item['zoom'] == 0.5],
                      'exports': export, 'scene_unchanged': True, 'browser_errors': errors}, indent=2))


if __name__ == '__main__':
    main()
