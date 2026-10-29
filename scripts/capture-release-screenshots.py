import argparse
import hashlib
import json
import struct
import subprocess
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'docs/release-screenshots/fixtures'
OUTPUT = ROOT / 'public/releases/v3.0.0'
REPORT = ROOT / 'docs/release-screenshots/manifest.json'
DRAFT = 'flowchart-editor-draft-v3'
FILES = [
    'draw-workspace-dark.png', 'draw-workspace-light.png', 'ai-draw-preview-dark.png',
    'ai-selection-preview-dark.png', 'shape-text-dark.png', 'components-frames-light.png',
    'mobile-draw-light.png', 'architecture-light.png', 'excalidraw-import-dark.png', 'flowchart-light.png',
]


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


def settle(page):
    page.evaluate('''async () => {
        await document.fonts.ready;
        const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        await frame();
        await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
        await frame();
    }''')


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def new_page(browser, origin, document, theme='dark', mobile=False, response=None):
    context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 960},
                                  device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, calls = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route(request):
        url = request.request.url
        if urlsplit(url).path.startswith('/api/'):
            if response and urlsplit(url).path == '/api/chat' and request.request.method == 'POST':
                calls.append({'path': '/api/chat', 'method': 'POST', 'response_fixture': response})
                request.fulfill(status=200, content_type='application/json', body=(FIXTURES / response).read_text())
            else:
                raise AssertionError('Unexpected API request: ' + request.request.method + ' ' + urlsplit(url).path)
        elif urlsplit(url).netloc == urlsplit(origin).netloc:
            request.continue_()
        else:
            request.abort()

    page.route('**/*', route)
    page.add_init_script('''(document => {
        if (!sessionStorage.getItem('release-capture-seeded')) {
            localStorage.clear();
            localStorage.setItem('flowchart-editor-draft-v3',JSON.stringify(document));
            localStorage.setItem('flowchart-patch-notes-seen-revision','999');
            sessionStorage.setItem('release-capture-seeded','true');
        }
    })(''' + json.dumps(document) + ')')
    page.goto(origin, wait_until='networkidle')
    if document['mode'] == 'draw':
        page.get_by_test_id('draw-surface').wait_for()
    else:
        page.locator('.react-flow__node').first.wait_for()
    settle(page)
    if bool(page.locator('.app.dark-mode').count()) != (theme == 'dark'):
        if mobile:
            button(page, 'More actions').click()
            button(page, 'Toggle Dark Mode').click()
            button(page, 'Close actions').click()
        else:
            button(page, 'Toggle Dark Mode').click()
        settle(page)
    page._capture_errors, page._capture_calls = errors, calls
    return context, page


def point(page, x, y):
    return page.locator('[data-draw-viewport]').evaluate('''(layer,point) => {
        const p=new DOMPoint(point.x,point.y).matrixTransform(layer.getScreenCTM());
        return {x:p.x,y:p.y};
    }''', {'x': x, 'y': y})


def click_world(page, x, y, double=False):
    p = point(page, x, y)
    (page.mouse.dblclick if double else page.mouse.click)(p['x'], p['y'])


def pan(page, dx, dy=0):
    button(page, 'Hand tool').click()
    page.mouse.move(1050, 810)
    page.mouse.down()
    page.mouse.move(1050 + dx, 810 + dy, steps=12)
    page.mouse.up()
    button(page, 'Selection tool').click()


def hero_camera(page):
    button(page, 'Fit drawing').click()
    button(page, 'Zoom out').click()
    pan(page, 120)
    settle(page)


def capture(page, name, report):
    settle(page)
    page.mouse.move(1430 if page.viewport_size['width'] > 390 else 385, 820)
    assert not page._capture_errors, page._capture_errors
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
    page.screenshot(path=str(OUTPUT / name), animations='disabled')
    report['captures'].append({'file': name, 'viewport': page.viewport_size, 'device_scale_factor': 1,
                               'api_calls': list(page._capture_calls), 'browser_errors': list(page._capture_errors)})
    print('Captured ' + name, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:3120/')
    args = parser.parse_args()
    if urlsplit(args.url).hostname not in ('127.0.0.1', 'localhost'):
        parser.error('Capture only a local first-party development server.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'captured_at_utc': datetime.now(timezone.utc).isoformat(), 'playwright_version': version('playwright'),
              'api_policy': 'Only browser-routed public /api/chat response fixtures. All other API requests fail. External requests abort.',
              'captures': []}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        report['browser_version'] = browser.version
        context, page = new_page(browser, args.url, fixture('garden-draw.json'))
        hero_camera(page)
        capture(page, FILES[0], report)
        button(page, 'Toggle Dark Mode').click()
        capture(page, FILES[1], report)
        button(page, 'Toggle Dark Mode').click()
        click_world(page, 335, 210, double=True)
        editor = page.get_by_role('textbox', name='Edit drawing text', exact=True)
        editor.wait_for()
        editor.fill('Pick a project')
        capture(page, FILES[4], report)
        editor.press('Escape')
        button(page, 'Toggle Dark Mode').click()
        button(page, 'Fit drawing').click()
        button(page, 'Zoom out').click()
        button(page, 'Zoom out').click()
        pan(page, 120)
        click_world(page, 115, 210)
        page.keyboard.down('Shift')
        click_world(page, 335, 210)
        page.keyboard.up('Shift')
        button(page, 'Components').click()
        page.get_by_role('textbox', name='Component name').fill('Gather ideas + project')
        page.get_by_role('button', name='Save selection').click()
        button(page, 'Insert Gather ideas + project').wait_for()
        capture(page, FILES[5], report)
        context.close()
        context, page = new_page(browser, args.url, fixture('garden-draw.json'), response='recorded-draw-response.json')
        button(page, 'Open AI Assistant').click()
        prompt = page.locator('.ai-bubble-overlay')
        prompt.get_by_role('combobox', name='Generate for').select_option('draw')
        prompt.locator('textarea.ai-bubble-input').fill('Plan a product-launch workshop with exploration, a readiness decision, and a clear handoff.')
        prompt.locator('button.ai-bubble-send').click()
        preview = page.get_by_role('dialog', name='Preview AI Proposal', exact=True)
        preview.wait_for()
        assert page.locator('[data-draw-scene]').count() >= 1
        assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', DRAFT) == fixture('garden-draw.json')
        capture(page, FILES[2], report)
        context.close()
        context, page = new_page(browser, args.url, fixture('garden-selection.json'), response='selection-response.json')
        button(page, 'Fit drawing').click()
        click_world(page, 330, 250)
        button(page, 'Edit selection with AI').click()
        dialog = page.get_by_role('dialog', name='Edit Draw selection with AI')
        dialog.get_by_role('textbox', name='What should change?').fill('Make the project card blue and shorten its label to Our project.')
        button(dialog, 'Preview changes').click()
        page.wait_for_function('document.querySelector(".ai-draw-edit .apply")?.disabled === false')
        capture(page, FILES[3], report)
        assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).architectureScene.elements.find(e=>e.id==="projects").backgroundColor', DRAFT) == '#d1fae5'
        context.close()
        context, page = new_page(browser, args.url, fixture('garden-mobile.json'), theme='light', mobile=True)
        button(page, 'Fit drawing').click()
        button(page, 'Zoom out').click()
        capture(page, FILES[6], report)
        context.close()
        for filename, board in [(FILES[7], 'library-architecture.json'), (FILES[9], 'garden-flowchart.json')]:
            context, page = new_page(browser, args.url, fixture(board), theme='light')
            page.locator('.react-flow__controls-fitview').click()
            page.wait_for_timeout(700)
            capture(page, filename, report)
            context.close()
        context, page = new_page(browser, args.url, fixture('garden-draw.json'))
        button(page, 'Export').click()
        page.get_by_label('Import JSON or Excalidraw file', exact=True).set_input_files(str(FIXTURES / 'community-library.excalidraw'))
        dialog = page.get_by_role('dialog', name='Bring your drawing in')
        dialog.get_by_role('button', name='Open as new diagram', exact=False).click()
        dialog.wait_for(state='hidden')
        page.wait_for_timeout(500)
        button(page, 'Fit drawing').click()
        button(page, 'Zoom out').click()
        pan(page, 120)
        capture(page, FILES[8], report)
        context.close()
        browser.close()
    report['fixtures'] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}
    report['files'] = {}
    for name in FILES:
        path = OUTPUT / name
        data = path.read_bytes()
        width, height = struct.unpack('>II', data[16:24])
        assert (width, height) == ((390, 844) if name == FILES[6] else (1440, 960)), (name, width, height)
        report['files'][name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'width': width, 'height': height}
    assert set(report['files']) == set(FILES)
    (OUTPUT / 'SHA256SUMS').write_text(''.join(report['files'][name]['sha256'] + '  ' + name + '\n' for name in sorted(FILES)))
    REPORT.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
