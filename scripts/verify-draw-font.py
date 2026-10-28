import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


parser = argparse.ArgumentParser()
parser.add_argument('url', nargs='?', default='http://127.0.0.1:3061')
parser.add_argument('--output', default='/workspace/scratch/draw-quality-implementation/font-proof')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
key = 'flowchart-editor-draft-v3'

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1500, 'height': 1400}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='networkidle')
    fixture = page.evaluate('''async () => {
      const font = await import('/src/shared/drawFont.ts');
      const cases = [
        ['wide-latin', 'WWW MMM @#% & 12345', 18],
        ['minimum-accents', 'Ǘj Ē̄ ÀÁÇgjℊ', 12],
        ['combining', 'Café e\\u0301 naïve — punctuation…', 18],
        ['unknown', '配送先 😀', 18],
        ['multiline', 'Ǘj Wide WWW\\nCafé e\\u0301 naïve', 12],
        ['wide-overhang', 'jjj', 48],
        ['center-overhang', 'jjj', 48, 'center'],
        ['right-overhang', 'jjj', 48, 'right'],
      ];
      const base = {angle:0,strokeColor:'#0f766e',backgroundColor:'transparent',strokeWidth:2,strokeStyle:'solid',fillStyle:'solid',roughness:0,opacity:100,groupIds:[],isDeleted:false,locked:false};
      const elements=cases.map(([id,text,fontSize,alignment],i)=>({...base,id,type:'text',x:330,y:180+i*105,...font.measureDrawText(text,fontSize),text,originalText:text,fontSize,fontFamily:2,textAlign:alignment??'left',verticalAlign:'top',lineHeight:font.DRAW_LINE_HEIGHT,autoResize:true,customData:{flowchartFont:font.DRAW_FONT_MARKER}}));
      elements.unshift({...base,id:'generated-frame',type:'frame',x:315,y:140,width:550,height:950,name:'Ǘj Generated frame',customData:{flowchartFont:font.DRAW_FONT_MARKER}});
      elements.push({...base,id:'legacy',type:'text',x:330,y:1115,width:300,height:40,text:'Existing unmarked text',fontSize:20,fontFamily:2});
      const fixture={version:4,mode:'draw',nodes:[],edges:[],architectureScene:{version:1,files:{},elements,appState:{viewBackgroundColor:'#ffffff'}}};
      localStorage.setItem('flowchart-editor-draft-v3',JSON.stringify(fixture));return fixture;
    }''')
    page.reload(wait_until='networkidle')
    page.get_by_role('region', name='Draw canvas').wait_for()
    page.get_by_role('region', name='Draw canvas').focus()
    page.keyboard.press('Control+0')
    page.wait_for_function("document.querySelector('[data-draw-viewport]')?.getAttribute('transform')?.endsWith('scale(1)')")
    loaded = page.evaluate('''async () => { const faces=await document.fonts.load('18px "Flowchart Diagram Sans"');await document.fonts.ready;const c=document.createElement('canvas').getContext('2d');c.font='18px "Flowchart Diagram Sans"';c.fontKerning='none';return {faces:faces.map(f=>({family:f.family,status:f.status})),www:c.measureText('WWW').width}; }''')
    assert len(loaded['faces']) > 0 and all(f['status'] == 'loaded' for f in loaded['faces']), loaded
    assert abs(loaded['www'] - 50.22) < 0.02, loaded
    reports = page.evaluate('''elements => elements.filter(e=>e.type==='text').map(e=>{const t=document.querySelector(`[data-element-id="${e.id}"] text`),b=t.getBBox();return {id:e.id,box:{x:b.x,y:b.y,width:b.width,height:b.height},record:{width:e.width,height:e.height},font:t.getAttribute('font-family'),fits:b.x>=-0.05&&b.y>=-0.05&&b.x+b.width<=e.width+0.05&&b.y+b.height<=e.height+0.05};})''', fixture['architectureScene']['elements'])
    for report in reports:
        if report['id'] != 'legacy':
            assert report['fits'], report
            assert 'Flowchart Diagram Sans' in report['font'], report
        else:
            assert 'Inter' in report['font'] and 'Flowchart Diagram Sans' not in report['font'], report
    frame_title = page.evaluate('''async()=>{const f=JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id==='generated-frame'),{measureDrawText}=await import('/src/shared/drawFont.ts'),t=document.querySelector('[data-element-id="generated-frame"] text'),b=t.getBBox();return {box:{x:b.x,y:b.y,width:b.width,height:b.height},expected:measureDrawText(f.name,13),font:t.getAttribute('font-family')};}''')
    assert frame_title['box']['x']>=0 and frame_title['box']['x']+frame_title['box']['width']<=frame_title['expected']['width'], frame_title
    assert frame_title['box']['y']>=-24 and frame_title['box']['y']+frame_title['box']['height']<=0, frame_title
    assert 'Flowchart Diagram Sans' in frame_title['font'], frame_title
    page.screenshot(path=str(out / 'generated-font-browser.png'))
    point = page.locator('[data-element-id="wide-latin"] text').evaluate('(text)=>{const b=text.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}}')
    page.mouse.click(point['x'], point['y'])
    page.keyboard.press('Enter')
    editor = page.get_by_role('textbox', name='Edit drawing text')
    editor.wait_for()
    style = editor.evaluate('(input)=>({font:getComputedStyle(input).fontFamily,lineHeight:getComputedStyle(input).lineHeight,fontSize:getComputedStyle(input).fontSize})')
    assert 'Flowchart Diagram Sans' in style['font'], style
    assert abs(float(style['lineHeight'][:-2]) / float(style['fontSize'][:-2]) - 1.5) < 0.01, style
    value = 'Edited WWW Café e\u0301\nǗj centered metrics'
    editor.fill(value)
    page.screenshot(path=str(out / 'generated-font-native-edit.png'))
    editor.press('Control+Enter')
    page.wait_for_function('''value=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id==='wide-latin').text===value''', arg=value)
    edited = page.evaluate('''async () => { const e=JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id==='wide-latin'),{measureDrawText}=await import('/src/shared/drawFont.ts');return {element:e,expected:measureDrawText(e.text,e.fontSize)}; }''')
    assert edited['element']['width'] == edited['expected']['width'] and edited['element']['height'] == edited['expected']['height'], edited
    assert edited['element']['customData']['flowchartFont'] == 'noto-sans-v1', edited
    page.get_by_role('button', name='Export', exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button', name='Export as SVG', exact=True).click()
    svg_path = out / 'generated-font-standalone.svg'
    download.value.save_as(svg_path)
    svg = svg_path.read_text()
    assert 'data:font/woff;base64,' in svg and 'https://' not in svg.replace('http://www.w3.org/2000/svg','').replace('http://www.w3.org/1999/xlink',''), 'Export must embed its font bytes'
    standalone = context.new_page()
    standalone_url = 'https://draw-font-proof.invalid/generated.svg'
    standalone.route(standalone_url, lambda route: route.fulfill(status=200, content_type='image/svg+xml', body=svg))
    standalone.goto(standalone_url, wait_until='load')
    standalone_loaded = standalone.evaluate('''async()=>{const f=await document.fonts.load('18px "Flowchart Diagram Sans"');await document.fonts.ready;return f.map(x=>({family:x.family,status:x.status}));}''')
    assert len(standalone_loaded) > 0 and all(f['status'] == 'loaded' for f in standalone_loaded), standalone_loaded
    export_reports = standalone.evaluate('''()=>Array.from(document.querySelectorAll('[data-draw-generated-font="true"]')).map(t=>{const b=t.getBBox();return {id:t.closest('[data-element-id]').getAttribute('data-element-id'),box:{x:b.x,y:b.y,width:b.width,height:b.height},font:t.getAttribute('font-family')};})''')
    current = page.evaluate('''()=>Array.from(document.querySelectorAll('[data-draw-generated-font="true"]')).map(t=>{const b=t.getBBox();return {id:t.closest('[data-element-id]').getAttribute('data-element-id'),box:{x:b.x,y:b.y,width:b.width,height:b.height},font:t.getAttribute('font-family')};})''')
    records = page.evaluate("()=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements")
    for exported, preview in zip(export_reports, current):
        assert exported['id'] == preview['id'] and exported['font'] == preview['font'], {'export':exported,'preview':preview}
        assert all(abs(exported['box'][axis]-preview['box'][axis])<1 for axis in ['x','y','width','height']), {'export':exported,'preview':preview}
        record = next(e for e in records if e['id']==exported['id'])
        b = exported['box']
        assert b['x']>=0 and b['y']>=0 and b['x']+b['width']<=record['width'] and b['y']+b['height']<=record['height'], {'export':exported,'record':record}
    standalone.screenshot(path=str(out / 'generated-font-standalone.png'))
    assert not errors, errors
    result = {'fontLoad': loaded, 'textBounds': reports, 'frameTitle': frame_title, 'nativeEditor': style, 'nativeEdit': edited, 'standaloneFontLoad': standalone_loaded, 'standaloneBounds': export_reports, 'svgBytes': svg_path.stat().st_size, 'errors': errors}
    (out / 'report.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps({'textCases':len(reports)-1,'font':loaded,'nativeEdit':'canonical metrics retained','standaloneSvg':'embedded font loaded; text bounds contained with subpixel rounding tolerance','output':str(out)},ensure_ascii=False))
    browser.close()
