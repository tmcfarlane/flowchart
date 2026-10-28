import argparse
import json
import math
from PIL import Image, ImageChops
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3040')
parser.add_argument('--expect-bug', action='store_true')
args = parser.parse_args()
out = Path(__file__).resolve().parents[1] / 'docs/screenshots/draw-ai-text-layout'
out.mkdir(parents=True, exist_ok=True)
key = 'flowchart-editor-draft-v3'
sentence = 'Review incoming customer orders, validate each delivery address, reserve warehouse inventory, and send a clear confirmation to the customer.'


def element(identifier, kind, x, y, width, height, **extra):
    return dict(id=identifier, type=kind, x=x, y=y, width=width, height=height, angle=0,
                strokeColor='#0f766e', backgroundColor='transparent', strokeWidth=2,
                strokeStyle='solid', fillStyle='solid', roughness=0, opacity=100,
                groupIds=[], frameId=None, isDeleted=False, locked=False, boundElements=None, **extra)


def saved(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).architectureScene', key)


def text_bounds(svg, identifier):
    return svg.evaluate('''(svg,id) => {
        const text = svg.querySelector(`[data-element-id="${id}"] text`), box = text.getBBox();
        const matrix = svg.getScreenCTM().inverse().multiply(text.getScreenCTM());
        const corners = [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix));
        const xs=corners.map(p=>p.x), ys=corners.map(p=>p.y), view=svg.viewBox.baseVal;
        const bounds={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
        return {bounds,view:{x:view.x,y:view.y,width:view.width,height:view.height},lines:text.querySelectorAll('tspan').length,
            fontSize:text.getAttribute('font-size'),fontFamily:text.getAttribute('font-family'),
            fits:bounds.left>=view.x && bounds.right<=view.x+view.width && bounds.top>=view.y && bounds.bottom<=view.y+view.height};
    }''', identifier)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    reports = []
    for name in (['standalone', 'bound'] if args.expect_bug else ['standalone', 'bound', 'wide-glyphs', 'ordinary-canvas', 'connector']):
        bound = name in ['bound', 'connector']
        host = element('host', 'rectangle', 300, 230, 300, 150)
        host['boundElements'] = [{'id': 'label', 'type': 'text'}]
        label = element('label', 'text', 350, 292.5, 200 if bound else 100, 25,
                        text='Original', originalText='Original', fontSize=28 if bound else 20,
                        fontFamily=3 if bound else 2, textAlign='center' if bound else 'left',
                        verticalAlign='middle' if bound else 'top', containerId='host' if bound else None)
        if name == 'connector':
            host.update(type='arrow', points=[[0, 0], [0, 150], [300, 150]], endArrowhead='arrow')
            label.update(x=275, y=367.5)
        if name == 'bound':
            host['angle'] = label['angle'] = 0.35
            label['lineHeight'] = 1.8
        other = element('untouched', 'ellipse', 800, 600, 160, 80, customData={'retain': ['exact', 123]})
        original = dict(version=1, elements=([host] if bound else []) + [label, other], files={}, appState={'viewBackgroundColor': '#ffffff'})
        fixture = dict(version=4, mode='draw', nodes=[], edges=[], architectureScene=original)
        value = sentence + ('\nKeep the customer informed.\nDispatch the shipment.' if bound else '')
        if name in ['wide-glyphs', 'ordinary-canvas']:
            value = 'W' * 100 + '\n' + '配送先を確認する' * 8
        if name == 'connector':
            value = 'Dispatch confirmed orders'
        proposal = {'summary': 'Expand the selected text.', 'operations': [{'op': 'update_element', 'id': 'label', 'changes': {'text': value}}]}
        context = browser.new_context(viewport={'width': 1540, 'height': 1000}, accept_downloads=True)
        if name == 'ordinary-canvas':
            context.add_init_script('delete window.OffscreenCanvas')
        context.add_init_script('if (!localStorage.getItem(' + json.dumps(key) + ')) localStorage.setItem(' + json.dumps(key) + ',' + json.dumps(json.dumps(fixture)) + ')')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/chat', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'message': json.dumps(proposal)})))
        page.goto(args.url, wait_until='networkidle')
        if name == 'ordinary-canvas':
            assert page.evaluate("typeof OffscreenCanvas === 'undefined' && typeof CanvasRenderingContext2D !== 'undefined'")
        page.get_by_role('region', name='Draw canvas').wait_for()
        page.get_by_role('button', name='Zoom out', exact=True).click()
        point = page.locator('[data-draw-viewport]').evaluate('(layer) => { const p=new DOMPoint(450,305).matrixTransform(layer.getScreenCTM()); return {x:p.x,y:p.y}; }')
        if not bound:
            point = page.locator('[data-draw-viewport]').evaluate('(layer) => { const p=new DOMPoint(375,300).matrixTransform(layer.getScreenCTM()); return {x:p.x,y:p.y}; }')
        if name == 'connector':
            point = page.locator('[data-draw-viewport]').evaluate('(layer)=>{const p=new DOMPoint(300,270).matrixTransform(layer.getScreenCTM());return {x:p.x,y:p.y}}')
        page.mouse.click(point['x'], point['y'])
        action = page.get_by_role('button', name='Edit selection with AI')
        action.scroll_into_view_if_needed()
        colors = action.evaluate('(button) => {const s=getComputedStyle(button);return {color:s.color,background:s.backgroundColor,panel:getComputedStyle(button.parentElement).backgroundColor,height:button.getBoundingClientRect().height}}')
        page.screenshot(path=str(out / f'{name}-action{"-before" if args.expect_bug else ""}.png'))
        action.hover()
        hover = action.evaluate('(button)=>getComputedStyle(button).backgroundColor')
        if not args.expect_bug:
            assert hover == 'rgb(39, 72, 61)', hover
        action.click()
        dialog = page.get_by_role('dialog', name='Edit Draw selection with AI')
        dialog.get_by_role('textbox').fill('Expand this label into the provided long text.')
        dialog.get_by_role('button', name='Preview changes', exact=True).click()
        page.wait_for_function('document.querySelector(".ai-draw-edit .apply")?.disabled === false')
        assert saved(page) == original
        preview = text_bounds(dialog.get_by_role('img', name='Proposed', exact=True), 'label')
        page.screenshot(path=str(out / f'{name}-preview{"-before" if args.expect_bug else ""}.png'))
        if args.expect_bug:
            assert not preview['fits'], preview
            reports.append({'case': name, 'preview': preview, 'button': colors})
            context.close()
            continue
        assert preview['fits'], preview
        assert preview['lines'] == len(value.split('\n'))
        assert preview['fontSize'] == str(label['fontSize'])
        assert ('monospace' in preview['fontFamily']) == bound
        assert colors['height'] >= 29
        def luminance(color):
            channels = [int(n) / 255 for n in color.removeprefix('rgb(').removesuffix(')').split(',')]
            linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
            return sum(v * weight for v, weight in zip(linear, [0.2126, 0.7152, 0.0722]))
        background = colors['panel'] if colors['background'] == 'rgba(0, 0, 0, 0)' else colors['background']
        contrast = (luminance(colors['color']) + 0.05) / (luminance(background) + 0.05)
        assert contrast >= 4.5, contrast
        dialog.get_by_role('button', name='Apply changes').click()
        page.wait_for_function('(args)=>JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e=>e.id==="label").text===args.value', arg={'key': key, 'value': value})
        after = saved(page)
        updated = next(item for item in after['elements'] if item['id'] == 'label')
        allowed = {'text', 'originalText', 'width', 'height'} | ({'x', 'y'} if bound else set())
        assert {k:v for k,v in updated.items() if k not in allowed} == {k:v for k,v in label.items() if k not in allowed}
        assert [e for e in after['elements'] if e['id'] != 'label'] == [e for e in original['elements'] if e['id'] != 'label']
        assert after['files'] == original['files'] and after['appState'] == original['appState']
        assert updated['width'] > label['width']
        if bound:
            center = (375, 380) if name == 'connector' else (host['x']+host['width']/2, host['y']+host['height']/2)
            assert abs(updated['x'] + updated['width']/2 - center[0]) < 0.001
            assert abs(updated['y'] + updated['height']/2 - center[1]) < 0.001
        page.get_by_role('button', name='Fit drawing', exact=True).click()
        page.screenshot(path=str(out / f'{name}-applied.png'))
        page.get_by_role('button', name='Undo drawing', exact=True).click()
        page.wait_for_function('(args)=>JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e=>e.id==="label").text==="Original"', arg={'key': key})
        assert saved(page) == original
        page.get_by_role('button', name='Redo drawing', exact=True).click()
        page.wait_for_function('(args)=>JSON.parse(localStorage.getItem(args.key)).architectureScene.elements.find(e=>e.id==="label").text===args.value', arg={'key': key, 'value': value})
        assert saved(page) == after
        page.reload(wait_until='networkidle')
        assert saved(page) == after
        exports = {}
        for extension in ['svg', 'png']:
            page.get_by_role('button', name='Export', exact=True).click()
            with page.expect_download() as download:
                page.get_by_role('button', name='Export as ' + extension.upper(), exact=True).click()
            target = out / f'{name}-export.{extension}'
            download.value.save_as(target)
            exports[extension] = target
        export_page = context.new_page()
        export_page.set_content(exports['svg'].read_text())
        exported = text_bounds(export_page.locator('svg'), 'label')
        assert exported['fits'], exported
        assert exported['lines'] == preview['lines']
        assert exported['fontSize'] == preview['fontSize'] and exported['fontFamily'] == preview['fontFamily']
        raster = Image.open(exports['png']).convert('RGB')
        occupied = ImageChops.difference(raster, Image.new('RGB', raster.size, raster.getpixel((0, 0)))).getbbox()
        assert occupied and min(occupied[0], occupied[1], raster.width-occupied[2], raster.height-occupied[3]) >= 8, occupied
        view = exported['view']
        scale_x, scale_y = raster.width / view['width'], raster.height / view['height']
        for scale in (scale_x, scale_y):
            assert math.isfinite(scale) and scale > 0
        last_line = export_page.locator('[data-element-id="label"] tspan').last
        last_bounds = last_line.evaluate('''(line) => {
            const box=line.getBBox(), matrix=line.getCTM();
            const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
            return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
        }''')
        crop_box = (max(0, math.floor(last_bounds['left']*scale_x)), max(0, math.floor(last_bounds['top']*scale_y)), min(raster.width, math.ceil(last_bounds['right']*scale_x)), min(raster.height, math.ceil(last_bounds['bottom']*scale_y)))
        crop = raster.crop(crop_box)
        assert ImageChops.difference(crop, Image.new('RGB', crop.size, raster.getpixel((0, 0)))).getbbox(), 'PNG lost the final text line'
        export_page.close()
        point = page.locator('[data-draw-viewport]').evaluate('(layer,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(layer.getScreenCTM());return {x:q.x,y:q.y}}', {'x': host['x'] + host['width']/2 if bound else updated['x']+30, 'y': host['y'] + host['height']/2 if bound else updated['y']+10})
        page.mouse.click(point['x'], point['y'])
        action = page.get_by_role('button', name='Edit selection with AI')
        page.get_by_title('Light Mode', exact=True).click()
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Control+a')
        light = action.evaluate('(button)=>({text:getComputedStyle(button).color,panel:getComputedStyle(button.parentElement).backgroundColor})')
        light_values = [luminance(light['text']), luminance(light['panel'])]
        light_contrast = (max(light_values)+0.05)/(min(light_values)+0.05)
        assert light_contrast >= 4.5, light_contrast
        page.get_by_title('Dark Mode', exact=True).click()
        page.get_by_role('region', name='Draw canvas').focus()
        page.keyboard.press('Control+a')
        page.get_by_role('button', name='Lock', exact=True).click()
        assert action.is_disabled()
        disabled = action.evaluate('(button)=>({opacity:getComputedStyle(button).opacity,cursor:getComputedStyle(button).cursor})')
        assert disabled == {'opacity': '0.45', 'cursor': 'default'}, disabled
        assert not errors, errors
        reports.append({'case': name, 'preview': preview, 'button': colors, 'savedText': updated, 'exportedSvg': exported, 'png': {'width': raster.width, 'height': raster.height, 'contentBounds': occupied, 'lastLineCrop': crop_box}, 'contrastRatio': contrast, 'lightContrastRatio': light_contrast, 'hoverBackground': hover, 'disabledStyle': disabled})
        context.close()
    (out / ('before.json' if args.expect_bug else 'verification.json')).write_text(json.dumps(reports, indent=2) + '\n')
    print(json.dumps(reports, indent=2))
    browser.close()
