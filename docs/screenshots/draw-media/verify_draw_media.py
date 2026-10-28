import json
import base64
import io
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw


BASE = Path(__file__).resolve().parent
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3033/'
DRAFT = 'flowchart-editor-draft-v3'


def shape(identifier, kind, x, y, width, height, **extra):
    item = dict(id=identifier, type=kind, x=x, y=y, width=width, height=height,
                angle=0, strokeColor='#087f5b', backgroundColor='#d3f9e8',
                strokeWidth=2, opacity=100, groupIds=[])
    item.update(extra)
    return item


def scene(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene', DRAFT)


def point(page, x, y):
    return page.locator('[data-draw-viewport]').evaluate(
        '(layer,p) => {const q=new DOMPoint(p.x,p.y).matrixTransform(layer.getScreenCTM()); return {x:q.x,y:q.y}}',
        {'x': x, 'y': y})


def click(page, x, y):
    p = point(page, x, y)
    page.mouse.click(p['x'], p['y'])


def main():
    imported = json.loads(Path('src/test/fixtures/excalidraw/native-editor-roundtrip.excalidraw').read_text())
    image = next(item for item in imported['elements'] if item['type'] == 'image')
    picture = Image.new('RGB', (320, 200), '#d3f9e8')
    paint = ImageDraw.Draw(picture)
    for index, color in enumerate(('#b2f2bb', '#99e9f2', '#a5d8ff', '#d0bfff')):
        paint.rectangle((index * 80, 0, index * 80 + 79, 199), fill=color)
    for line in range(0, 321, 40):
        paint.line((line, 0, line, 200), fill='#0f766e', width=2)
    for line in range(0, 201, 40):
        paint.line((0, line, 320, line), fill='#0f766e', width=2)
    data = io.BytesIO()
    picture.save(data, format='PNG')
    asset = {'id': image['fileId'], 'mimeType': 'image/png',
             'dataURL': 'data:image/png;base64,' + base64.b64encode(data.getvalue()).decode()}
    payload = {'version': 4, 'mode': 'draw', 'nodes': [], 'edges': [], 'architectureScene': {
        'version': 1, 'files': {image['fileId']: asset}, 'elements': [
            shape('sample-image', 'image', 740, 200, 220, 160, fileId=image['fileId'], scale=[1, 1], crop=None, backgroundColor='transparent'),
            shape('source', 'rectangle', 250, 230, 240, 150),
            shape('source-label', 'text', 300, 275, 130, 32, containerId='source', text='Selected PNG', originalText='Selected PNG', fontSize=20, fontFamily=2, backgroundColor='transparent'),
            shape('other', 'rectangle', 1050, 230, 220, 150, backgroundColor='#d0ebff'),
        ], 'appState': {'viewBackgroundColor': '#ffffff', 'gridSize': 20}}}
    payload['architectureScene']['elements'][1]['boundElements'] = [{'id': 'source-label', 'type': 'text'}]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1680, 'height': 1120}, device_scale_factor=1)
        context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=ORIGIN.rstrip('/'))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(ORIGIN, wait_until='networkidle')
        dismiss = page.get_by_role('button', name='No, thank you', exact=True)
        if dismiss.count():
            dismiss.click()
        page.get_by_role('button', name='Export', exact=True).click()
        page.get_by_label('Import JSON or Excalidraw file').set_input_files({
            'name': 'draw-media.json', 'mimeType': 'application/json', 'buffer': json.dumps(payload).encode()})
        page.get_by_test_id('draw-surface').wait_for()
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 4', arg=DRAFT)

        page.evaluate('(value) => navigator.clipboard.writeText(value)', 'Literal {"type":"flowchart-drawing"}\nSecond line')
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Control+Shift+V')
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 5', arg=DRAFT)
        assert any(item.get('text') == 'Literal {"type":"flowchart-drawing"}\nSecond line' for item in scene(page)['elements'])
        page.screenshot(path=str(BASE / '01-plain-text-paste.png'), full_page=True)

        click(page, 350, 245)
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Shift+Alt+C')
        page.wait_for_timeout(1200)
        page.wait_for_function('async () => (await navigator.clipboard.read()).some(item => item.types.includes("image/png"))')
        png = page.evaluate('''async () => {
            const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'));
            const blob = await item.getType('image/png');
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return {size: bytes.length, header: Array.from(bytes.slice(0, 8))};
        }''')
        assert png['size'] > 100 and png['header'] == [137, 80, 78, 71, 13, 10, 26, 10], png
        page.screenshot(path=str(BASE / '02-selected-png-clipboard.png'), full_page=True)

        click(page, 810, 330)
        assert page.locator('[data-element-id="sample-image"]').get_attribute('data-selected') == 'true'
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Enter')
        dialog = page.get_by_role('dialog', name='Crop image')
        dialog.wait_for()
        assert page.get_by_role('img', name='Image crop preview').is_visible()
        before = next(item for item in scene(page)['elements'] if item['id'] == 'sample-image')
        page.get_by_label('Crop width').fill('250')
        page.get_by_label('Crop height').fill('150')
        corner = page.locator('[data-crop-handle="se"]')
        box = corner.bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] / 2 - 70, box['y'] + box['height'] / 2 - 40, steps=8)
        page.mouse.up()
        page.screenshot(path=str(BASE / '04-crop-preview.png'), full_page=True)
        assert float(page.get_by_label('Crop width').input_value()) < 250
        assert next(item for item in scene(page)['elements'] if item['id'] == 'sample-image') == before
        page.get_by_role('button', name='Finish crop').click()
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.find(item => item.id === "sample-image")?.crop?.width > 0', arg=DRAFT)
        cropped = next(item for item in scene(page)['elements'] if item['id'] == 'sample-image')
        assert cropped['crop']['width'] < cropped['crop']['naturalWidth']
        click(page, cropped['x'] + cropped['width'] / 2, cropped['y'] + cropped['height'] / 2)
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Enter')
        dialog.wait_for()
        page.get_by_label('Crop height').fill(str(float(page.get_by_label('Crop height').input_value()) - 1))
        page.get_by_role('button', name='Cancel crop').click()
        assert next(item for item in scene(page)['elements'] if item['id'] == 'sample-image') == cropped
        crop_center = point(page, cropped['x'] + cropped['width'] / 2, cropped['y'] + min(20, cropped['height'] * 0.2))
        page.locator('[data-element-id="sample-image"]').dispatch_event('dblclick', {'button': 0, 'clientX': crop_center['x'], 'clientY': crop_center['y']})
        dialog.wait_for()
        page.keyboard.press('Escape')
        assert not dialog.is_visible()
        assert next(item for item in scene(page)['elements'] if item['id'] == 'sample-image') == cropped
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Control+V')
        page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements?.length === 6', arg=DRAFT)
        assert len([item for item in scene(page)['elements'] if item['type'] == 'image']) == 2
        page.screenshot(path=str(BASE / '03-external-png-paste.png'), full_page=True)
        assert not errors, errors
        print(json.dumps({'status': 'PASS', 'png_bytes': png['size'], 'screenshots': 4}))
        browser.close()


if __name__ == '__main__':
    main()
