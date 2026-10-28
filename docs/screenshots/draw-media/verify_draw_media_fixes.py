import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


BASE = Path(__file__).resolve().parent
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3039/'
DRAFT = 'flowchart-editor-draft-v3'


def shape(identifier, kind, x, y, width, height, **extra):
    item = dict(id=identifier, type=kind, x=x, y=y, width=width, height=height,
                angle=0, strokeColor='#087f5b', backgroundColor='#d3f9e8',
                strokeWidth=2, opacity=100, groupIds=[])
    item.update(extra)
    return item


def payload(width=320, height=200, **image_properties):
    data = io.BytesIO()
    Image.new('RGB', (width, height), '#f00000').save(data, format='PNG')
    image_options = {'fileId': 'asset', 'scale': [1, 1], **image_properties}
    return {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {
        'version': 1,
        'files': {'asset': {'id': 'asset', 'mimeType': 'image/png',
                            'dataURL': 'data:image/png;base64,' + base64.b64encode(data.getvalue()).decode()}},
        'elements': [shape('image', 'image', 400, 200, 200, 200 * height / width,
                           **image_options),
                     shape('other', 'rectangle', 850, 200, 100, 100)],
        'appState': {'viewBackgroundColor': '#ffffff'}}}


def saved(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene', DRAFT)


def point(page, x, y):
    return page.locator('[data-draw-viewport]').evaluate(
        '(layer,p) => {const q=new DOMPoint(p.x,p.y).matrixTransform(layer.getScreenCTM()); return {x:q.x,y:q.y}}',
        {'x': x, 'y': y})


def click(page, x, y):
    p = point(page, x, y)
    page.mouse.click(p['x'], p['y'])


def load(page, document):
    page.goto(ORIGIN, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you', exact=True)
    if dismiss.count():
        dismiss.click()
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files({
        'name': 'draw-media-review.json', 'mimeType': 'application/json', 'buffer': json.dumps(document).encode()})
    page.get_by_test_id('draw-surface').wait_for()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 2', arg=DRAFT)
    page.wait_for_function('(height) => { const image=JSON.parse(localStorage.getItem("flowchart-editor-draft-v3") || "{}").architectureScene?.elements?.[0]; return image?.id === "image" && image.height === height && !image.crop }', arg=document['architectureScene']['elements'][0]['height'])


def open_crop(page):
    click(page, 450, 240)
    page.get_by_role('region', name='Draw canvas').focus()
    page.keyboard.press('Enter')
    page.get_by_role('dialog', name='Crop image').wait_for()


def drag_corner(page, distance=10):
    svg = page.get_by_role('img', name='Image crop preview')
    scale = svg.evaluate('(el) => ({x:el.getScreenCTM().a,y:el.getScreenCTM().d})')
    box = page.locator('[data-crop-handle="se"]').bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x - distance, y - distance)
    page.mouse.up()
    return scale


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1680, 'height': 1120})
        context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN.rstrip('/'))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        load(page, payload())
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('a')
        click(page, 600, 450)
        p = point(page, 750, 500)
        page.mouse.move(p['x'], p['y'])
        assert len(saved(page)['elements']) == 2
        assert page.locator('[data-draw-content] [data-element-id]').count() == 3
        page.evaluate('navigator.clipboard.writeText("hello")')
        page.keyboard.press('Control+Shift+V')
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 3', arg=DRAFT)
        assert [item['type'] for item in saved(page)['elements']] == ['image', 'rectangle', 'text']
        page.keyboard.press('Escape')
        assert page.locator('[data-draw-content] [data-element-id]').count() == len(saved(page)['elements']) == 3
        page.screenshot(path=str(BASE / '05-pending-connector-paste.png'), full_page=True)

        load(page, payload())
        click(page, 450, 240)
        page.get_by_role('region', name='Draw canvas').focus()
        page.evaluate('Object.defineProperty(navigator.clipboard,"readText",{configurable:true,value:()=>new Promise(resolve=>window.finishRead=resolve)})')
        page.keyboard.press('Control+Shift+V')
        page.keyboard.press('Enter')
        dialog = page.get_by_role('dialog', name='Crop image')
        dialog.wait_for()
        assert page.evaluate('document.activeElement.getAttribute("aria-label")') == 'Crop x'
        page.keyboard.press('Tab')
        assert page.evaluate('document.activeElement.getAttribute("aria-label")') == 'Crop y'
        page.get_by_label('Crop width').fill('250')
        page.evaluate('window.finishRead("delayed paste")')
        page.wait_for_timeout(300)
        assert len(saved(page)['elements']) == 2
        assert saved(page)['elements'][0].get('crop') is None
        page.screenshot(path=str(BASE / '06-keyboard-crop-preview.png'), full_page=True)
        page.get_by_role('button', name='Cancel crop').focus()
        page.keyboard.press('Enter')
        assert not dialog.is_visible()
        assert len(saved(page)['elements']) == page.locator('[data-draw-content] [data-element-id]').count() == 2
        assert saved(page)['elements'][0].get('crop') is None

        for width, height, crop_width, crop_height, name in [(200, 800, 150, 600, 'portrait'), (800, 200, 600, 150, 'landscape')]:
            load(page, payload(width, height))
            open_crop(page)
            page.get_by_label('Crop width').fill(str(crop_width))
            page.get_by_label('Crop height').fill(str(crop_height))
            scale = drag_corner(page)
            actual_width = float(page.get_by_label('Crop width').input_value())
            actual_height = float(page.get_by_label('Crop height').input_value())
            assert abs(actual_width - (crop_width - 10 / scale['x'])) < 1.2, (name, actual_width, scale)
            assert abs(actual_height - (crop_height - 10 / scale['y'])) < 1.2, (name, actual_height, scale)
            assert saved(page)['elements'][0].get('crop') is None
            page.screenshot(path=str(BASE / f'07-{name}-crop-drag.png'), full_page=True)
            page.get_by_label('Crop width').focus()
            page.keyboard.press('Enter')
            assert not page.get_by_role('dialog', name='Crop image').is_visible()
            page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.[0]?.crop?.width > 0', arg=DRAFT)
            assert abs(saved(page)['elements'][0]['crop']['width'] - actual_width) < 0.01

        load(page, payload(320, 200, scale=[-1, 1], angle=1.5707963267948966))
        open_crop(page)
        page.get_by_label('Crop width').fill('250')
        page.get_by_label('Crop width').press('Enter')
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.[0]?.crop?.width === 250', arg=DRAFT)
        final_image = saved(page)['elements'][0]
        assert final_image['crop']['width'] == 250
        assert final_image['scale'] == [-1, 1] and final_image['angle'] == 1.5707963267948966
        assert not errors, errors
        print(json.dumps({'status': 'PASS', 'scenarios': 5, 'screenshots': 4}))
        browser.close()


if __name__ == '__main__':
    main()
