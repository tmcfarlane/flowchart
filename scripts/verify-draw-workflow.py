"""Real-browser checks for Flowchart AI's first-party Draw mode.

Run a dev server, then pass its URL (default http://localhost:3004).
Requires Python Playwright plus Chromium/CHROMIUM_EXECUTABLE. Artifacts go to
DRAW_VERIFICATION_OUTPUT or /tmp/flowchart-draw-verification. Run workflow first,
then integrations; set DRAW_VERIFY_LIVE_AI=1 for the optional live AI request.
"""
import json,re,os,shutil,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
origin=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:3004').rstrip('/')
out=Path(os.environ.get('DRAW_VERIFICATION_OUTPUT','/tmp/flowchart-draw-verification'));out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1600,'height':1100},accept_downloads=True)
 errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:requests.append(r.url))
 page.goto(origin+'/',wait_until='networkidle')
 for label in ['Flowchart Mode','Architecture Mode','Draw Mode']:assert page.get_by_role('button',name=label,exact=True).count()==1
 page.get_by_role('button',name='Architecture Mode',exact=True).click();page.locator('.react-flow').wait_for()
 assert page.get_by_role('button',name='Add Service Node',exact=True).is_visible()
 assert not page.locator('.draw-canvas').count()
 page.get_by_role('button',name='Draw Mode',exact=True).click();page.get_by_label('Draw canvas',exact=True).wait_for()
 assert not page.locator('.react-flow').count() and not page.locator('.excalidraw').count()
 surface=page.get_by_role('application',name='Drawing surface',exact=True)
 surface.click(position={'x':1250,'y':800})
 for key,label in [('v','Selection'),('1','Selection'),('h','Hand'),('r','Rectangle'),('2','Rectangle'),('d','Diamond'),('3','Diamond'),('o','Ellipse'),('4','Ellipse'),('a','Arrow'),('5','Arrow'),('l','Line'),('6','Line'),('p','Pen'),('7','Pen'),('t','Text'),('8','Text'),('e','Eraser'),('0','Eraser'),('f','Frame')]:
  page.keyboard.press(key)
  assert page.get_by_role('button',name=label+' tool',exact=True).get_attribute('aria-pressed')=='true','Tool alias '+key
 print('THREE SEPARATE MODES + CORE DRAW HOTKEY ALIASES: PASS',flush=True)
 def point(x,y):return page.locator('[data-drawing-layer]').evaluate('(g,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM());return{x:q.x,y:q.y}}',{'x':x,'y':y})
 def drag(key,start,end):
  page.keyboard.press(key);a=point(*start);z=point(*end);page.mouse.move(a['x'],a['y']);page.mouse.down();page.mouse.move(z['x'],z['y'],steps=12);page.mouse.up()
 def doc():return page.evaluate("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')||'{}')")
 def live():return [e for e in doc().get('architectureScene',{}).get('elements',[]) if not e.get('isDeleted')]
 def wait_count(n):page.wait_for_function("n=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')||'{}').architectureScene?.elements.filter(e=>!e.isDeleted).length===n",arg=n)
 drag('r',(350,200),(570,320));wait_count(1)
 rect=live()[0]
 drag('o',(900,200),(1100,340));wait_count(2)
 drag('a',(570,260),(900,270));wait_count(3)
 arrow=next(e for e in live() if e['type']=='arrow');assert arrow.get('startBinding') and arrow.get('endBinding'),'Arrow endpoints not bound'
 page.keyboard.press('p');a=point(400,600);page.mouse.move(a['x'],a['y']);page.mouse.down()
 for xy in [(430,570),(460,600),(490,570),(520,600)]:
  q=point(*xy);page.mouse.move(q['x'],q['y'],steps=4)
 page.mouse.up();wait_count(4)
 page.keyboard.press('t');a=point(350,150);page.mouse.click(a['x'],a['y']);page.get_by_role('textbox',name='Edit drawing text',exact=True).fill('Custom Draw — our own canvas');page.get_by_role('textbox',name='Edit drawing text',exact=True).press('Control+Enter');wait_count(5)
 print('CUSTOM RECTANGLE/ELLIPSE/BOUND ARROW/PEN/TEXT: PASS',flush=True)
 # Select by the object's outline, then move using one keyboard transaction.
 page.keyboard.press('v');a=point(355,210);page.mouse.click(a['x'],a['y'])
 page.keyboard.press('ArrowRight');page.wait_for_function("id=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id===id).x===351",arg=rect['id'])
 changed=next(e for e in live() if e['id']==arrow['id']);assert changed['x']!=arrow['x'],'Bound arrow did not follow moved rectangle'
 page.keyboard.press('Control+z');page.wait_for_function("id=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id===id).x===350",arg=rect['id'])
 page.keyboard.press('Control+Shift+z');page.wait_for_function("id=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id===id).x===351",arg=rect['id'])
 print('BOUND ARROW FOLLOWS + UNIFIED MOVE UNDO/REDO: PASS',flush=True)
 page.get_by_role('combobox',name='Stroke style',exact=True).select_option('dashed')
 page.get_by_role('spinbutton',name='Stroke width',exact=True).fill('3')
 page.get_by_role('spinbutton',name='Rotation',exact=True).fill('15')
 page.wait_for_function("id=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.find(e=>e.id===id).strokeWidth===3",arg=rect['id'])
 styled=next(e for e in live() if e['id']==rect['id']);assert styled['strokeStyle']=='dashed' and abs(styled['angle']-15*3.141592653589793/180)<1e-8
 print('CUSTOM APPEARANCE + ROTATION: PASS',flush=True)
 page.screenshot(path=str(out/'draw-dark-verified.png'),full_page=True)
 (out/'partial-drawing.json').write_text(json.dumps(doc(),indent=2))
 page.get_by_label('Draw canvas',exact=True).focus();before=len(live());page.keyboard.press('Control+d');wait_count(before+1)
 assert len({e['id'] for e in live()})==len(live())
 print('INDEPENDENT DUPLICATION: PASS',flush=True)
 page.get_by_role('button',name='Export',exact=True).click()
 with page.expect_download() as d:page.get_by_role('button',name='Export as JSON',exact=True).click()
 d.value.save_as(str(out/'drawing.json'));exported=json.loads((out/'drawing.json').read_text());assert exported['version']==4 and exported['mode']=='draw'
 for name,file in [('Export as SVG','drawing.svg'),('Export as PNG','drawing.png')]:
  page.get_by_role('button',name='Export',exact=True).click()
  with page.expect_download(timeout=30000) as d:page.get_by_role('button',name=name,exact=True).click()
  d.value.save_as(str(out/file));assert (out/file).stat().st_size>100
 print('APP JSON + CUSTOM SVG/PNG EXPORTS: PASS',flush=True)
 saved=len(live());page.get_by_role('button',name='Architecture Mode',exact=True).click();page.locator('.react-flow').wait_for();page.get_by_role('button',name='Add Service Node',exact=True).click();page.wait_for_function("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).nodes.length===1")
 assert len(live())==saved,'Architecture discarded drawing'
 page.reload(wait_until='networkidle');page.locator('.react-flow').wait_for();assert page.get_by_role('button',name='Architecture Mode',exact=True).get_attribute('aria-pressed')=='true';assert len(live())==saved,'Reload discarded retained drawing'
 page.get_by_role('button',name='Draw Mode',exact=True).click();page.get_by_label('Draw canvas',exact=True).wait_for();assert len(live())==saved
 print('ARCHITECTURE RETAINED + SAVED MODE/SCENE RELOAD: PASS',flush=True)
 page.get_by_role('button',name='Open AI Assistant',exact=True).click();field=page.get_by_placeholder('Describe any process, workflow, or plan...');field.fill('rdoapltqv123456780');field.press('ArrowLeft');assert field.input_value()=='rdoapltqv123456780'
 assert not any('@excalidraw' in url or 'excalidraw-assets' in url for url in requests),'Native editor asset requested'
 assert not errors,errors
 print('TEXT INPUT GUARD / NO EMBEDDED EDITOR / NO BROWSER ERRORS: PASS',flush=True)
 b.close()
