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
out=Path(os.environ.get('DRAW_VERIFICATION_OUTPUT','/tmp/flowchart-draw-verification'));out.mkdir(parents=True,exist_ok=True);seed=(out/'drawing.json').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1600,'height':1100},accept_downloads=True)
 page=ctx.new_page();page.add_init_script('localStorage.setItem("flowchart-editor-draft-v3",'+json.dumps(seed)+')')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(origin+'/',wait_until='networkidle');page.get_by_label('Draw canvas',exact=True).wait_for()
 def doc():return page.evaluate("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3'))")
 def live():return [e for e in doc()['architectureScene']['elements'] if not e.get('isDeleted')]
 rect=next(e for e in live() if e['type']=='rectangle')
 point=page.locator('[data-drawing-layer]').evaluate('(g,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(g.getScreenCTM());return{x:q.x,y:q.y}}',{'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2})
 page.mouse.click(point['x'],point['y'])
 page.get_by_role('button',name='Components',exact=True).click();page.get_by_label('Component name',exact=True).fill('Reusable API')
 page.get_by_role('button',name=re.compile('^Save selection')).click()
 before=len(live());page.get_by_role('button',name='Insert Reusable API',exact=True).click()
 page.wait_for_function("n=>JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).architectureScene.elements.filter(e=>!e.isDeleted).length===n",arg=before+1)
 page.get_by_role('button',name='Close components',exact=True).click()
 assert len({e['id'] for e in live()})==len(live())
 print('OWN COMPONENTS SAVE + INDEPENDENT INSERT: PASS',flush=True)
 page.get_by_label('Draw canvas',exact=True).focus()
 copied=page.evaluate("()=>{const d=new DataTransfer();document.querySelector('.draw-canvas').dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:d}));return d.getData('application/x-flowchart-drawing')||d.getData('text/plain')}")
 assert copied,'Copy did not write portable scene data'
 ctx2=b.new_context(viewport={'width':1600,'height':1100});other=ctx2.new_page();other.on('pageerror',lambda e:errors.append(str(e)))
 other.goto(origin+'/',wait_until='networkidle');other.get_by_role('button',name='Draw Mode',exact=True).click();other.get_by_label('Draw canvas',exact=True).wait_for();other.get_by_label('Draw canvas',exact=True).focus()
 pasted=other.evaluate("text=>{const d=new DataTransfer();d.setData('application/x-flowchart-drawing',text);return document.querySelector('.draw-canvas').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}))}",copied)
 other.wait_for_function("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')||'{}').architectureScene?.elements.some(e=>!e.isDeleted)")
 print('PORTABLE CLIPBOARD BETWEEN INDEPENDENT BROWSER CONTEXTS: PASS',flush=True)
 ctx2.close()
 if os.environ.get('DRAW_VERIFY_LIVE_AI')=='1':
  # Live AI insertion keeps the custom drawing intact.
  old_ids={e['id'] for e in live()}
  page.get_by_role('button',name='Open AI Assistant',exact=True).click();page.get_by_placeholder('Describe any process, workflow, or plan...').fill('Create exactly two step nodes: Receive request, then Save result. Connect them with one edge.')
  with page.expect_response(lambda r:'/api/chat' in r.url and r.request.method=='POST',timeout=90000) as info:page.get_by_role('button',name='Generate Flowchart',exact=True).click()
  response=info.value;data=response.json();assert response.status==200,data
  page.get_by_role('dialog',name='Preview AI Proposal').wait_for();page.get_by_role('button',name='Insert into Canvas',exact=True).click()
  page.wait_for_function("JSON.parse(localStorage.getItem('flowchart-editor-draft-v3')).nodes.length===2")
  assert old_ids<={e['id'] for e in live()},'AI insertion removed custom drawing'
  page.wait_for_function("[...document.querySelectorAll('[data-element-id]')].some(e=>e.textContent.includes('Receive request'))")
  print('LIVE AZURE AI → OWN DRAW CANVAS, EXISTING DRAWING RETAINED: PASS',flush=True)
 else:
  print('LIVE AI: skipped (set DRAW_VERIFY_LIVE_AI=1 to include configured provider)',flush=True)
 # REST/shared clients restore the explicit mode rather than inferring from a retained scene.
 scene=doc()['architectureScene'];root=origin
 result=ctx.request.post(root+'/api/flows',data={'title':'Custom Draw mode integration','mode':'draw','nodes':[{'id':'shared-api','type':'service','label':'Shared API','position':{'x':500,'y':400}}],'edges':[],'architectureScene':scene})
 assert result.status==201,result.text();created=result.json();shared_id=created['id']
 shared=ctx.new_page();shared.on('pageerror',lambda e:errors.append(str(e)));shared.goto(root+'/f/'+shared_id+'#edit='+created['editToken'],wait_until='networkidle');shared.get_by_label('Draw canvas',exact=True).wait_for()
 with shared.expect_response(lambda r:r.request.method=='PUT' and '/api/flows/' in r.url,timeout=15000) as info:shared.get_by_role('button',name='Architecture Mode',exact=True).click()
 saved=info.value.json();assert saved['mode']=='architecture' and saved['architectureScene']['elements'],'Mode-only save lost drawing'
 shared.reload(wait_until='networkidle');shared.locator('.react-flow').wait_for();assert shared.get_by_role('button',name='Architecture Mode',exact=True).get_attribute('aria-pressed')=='true'
 with shared.expect_response(lambda r:r.request.method=='PUT' and '/api/flows/' in r.url,timeout=15000) as info:shared.get_by_role('button',name='Draw Mode',exact=True).click()
 assert info.value.json()['mode']=='draw';shared.get_by_label('Draw canvas',exact=True).wait_for()
 shared.wait_for_timeout(1400);v=ctx.request.get(root+'/api/flows/'+shared_id).json()['version'];shared.wait_for_timeout(1800);assert ctx.request.get(root+'/api/flows/'+shared_id).json()['version']==v,'Mode/scene autosave loop'
 print('SHARED DRAW↔ARCHITECTURE MODE-ONLY SAVE + RELOAD + IDLE STABILITY: PASS',flush=True)
 assert not errors,errors
 print('OWN DRAW INTEGRATION VERIFICATION: PASS; no browser errors',flush=True)
 b.close()
