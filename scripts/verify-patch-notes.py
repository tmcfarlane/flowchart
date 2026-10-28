import argparse
import asyncio
import copy
import json
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urljoin

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/patch-notes'
DRAFT = 'flowchart-editor-draft-v3'
SEEN = 'flowchart-patch-notes-seen-revision'
LATEST = '1'
FIXTURE = {
    'version': 4,
    'mode': 'flowchart',
    'nodes': [{
        'id': 'retained-flow-node', 'type': 'step',
        'position': {'x': 160, 'y': 160},
        'data': {'label': 'Retained customer workflow'},
        'style': {'width': 230, 'height': 90},
    }],
    'edges': [],
    'architectureScene': {
        'version': 1,
        'elements': [
            {'id': 'retained-box', 'type': 'rectangle', 'x': 160, 'y': 200,
             'width': 250, 'height': 130, 'angle': 0, 'strokeColor': '#087f5b',
             'backgroundColor': '#b2f2dc', 'strokeWidth': 2, 'opacity': 100,
             'groupIds': [], 'boundElements': None, 'locked': False},
            {'id': 'retained-note', 'type': 'text', 'x': 185, 'y': 245,
             'width': 200, 'height': 30, 'angle': 0,
             'text': 'Saved release planning', 'originalText': 'Saved release planning',
             'fontSize': 18, 'fontFamily': 2, 'strokeColor': '#087f5b',
             'groupIds': [], 'boundElements': None},
        ],
        'files': {},
        'appState': {'viewBackgroundColor': '#ffffff'},
    },
}


def notes(page):
    return page.get_by_role('dialog', name="What's new", exact=True)


async def document(page):
    return await page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', DRAFT)


async def marker(page):
    return await page.evaluate('(key) => localStorage.getItem(key)', SEEN)


async def settle(page):
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


async def await_draft_save(page):
    await page.wait_for_timeout(650)


async def screenshot(page, filename):
    await settle(page)
    await page.screenshot(path=str(OUTPUT / filename), animations='disabled')


async def new_page(browser, url, seen=None, fixture=FIXTURE, compact=False, blocked=False):
    context = await browser.new_context(viewport={'width': 390, 'height': 667} if compact else {'width': 1440, 'height': 960})
    page = await context.new_page()
    errors, ai_requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def block_ai(route):
        ai_requests.append(route.request.url)
        await route.abort()

    await page.route('**/api/chat', block_ai)
    config = {'draftKey': DRAFT, 'seenKey': SEEN, 'seen': seen, 'fixture': fixture, 'blocked': blocked}
    await page.add_init_script('''(config => {
        if (!sessionStorage.getItem('patch-notes-proof-seeded')) {
            if (config.fixture) localStorage.setItem(config.draftKey, JSON.stringify(config.fixture));
            if (config.seen !== null) localStorage.setItem(config.seenKey, config.seen);
            sessionStorage.setItem('patch-notes-proof-seeded', 'true');
        }
        if (config.blocked) {
            const read = Storage.prototype.getItem;
            const write = Storage.prototype.setItem;
            Storage.prototype.getItem = function(key) {
                if (key === config.seenKey) throw new DOMException('Storage blocked', 'SecurityError');
                return read.call(this, key);
            };
            Storage.prototype.setItem = function(key, value) {
                if (key === config.seenKey) throw new DOMException('Storage blocked', 'SecurityError');
                return write.call(this, key, value);
            };
        }
        window.__proofVisibleDialogs = [];
        const record = () => {
            for (const node of document.querySelectorAll('dialog, [role="dialog"]')) {
                if (!node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') continue;
                const name = node.getAttribute('aria-label') || document.getElementById(node.getAttribute('aria-labelledby'))?.textContent;
                if (name && !window.__proofVisibleDialogs.includes(name)) window.__proofVisibleDialogs.push(name);
            }
        };
        new MutationObserver(record).observe(document, {subtree: true, childList: true, attributes: true});
    })(''' + json.dumps(config) + ')')
    if url:
        await page.goto(url, wait_until='networkidle')
        await page.get_by_role('button', name="What's new", exact=True).wait_for()
    return context, page, errors, ai_requests


async def clean(context, page, errors, ai_requests):
    await settle(page)
    assert not errors, f'Browser exceptions: {errors}'
    assert not ai_requests, f'Unexpected AI requests: {ai_requests}'
    await context.close()


async def fresh_visit(browser, url, checks):
    context, page, errors, requests = await new_page(browser, url, fixture=None)
    await expect(notes(page)).to_be_visible()
    await expect(page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)).to_have_count(0)
    await expect(page.get_by_role('button', name='Open AI Assistant', exact=True)).to_have_count(0)
    assert not any(name.startswith('FlowChart') for name in await page.evaluate('window.__proofVisibleDialogs')), 'AI welcome appeared before patch notes'
    assert await marker(page) is None, 'Opening automatically acknowledged an unseen release'
    await screenshot(page, '01-unseen-dark.png')
    await page.keyboard.press('Escape')
    await expect(notes(page)).to_have_count(0)
    await expect(page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)).to_be_visible()
    assert await marker(page) == LATEST
    await page.reload(wait_until='networkidle')
    await expect(notes(page)).to_have_count(0)
    await expect(page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)).to_be_visible()
    checks.append('Unseen notes precede the AI welcome; Escape acknowledges them without dismissing the welcome; a seen reload stays closed')
    await clean(context, page, errors, requests)


async def visitor_records(browser, url, checks):
    for seen, opens in [('0', True), ('1', False), ('2', False), ('broken', True), ('-1', True), ('1.5', True), ('9007199254740992', True), ('', True)]:
        context, page, errors, requests = await new_page(browser, url, seen=seen)
        if opens:
            await expect(notes(page)).to_be_visible()
        else:
            await expect(notes(page)).to_have_count(0)
        assert await marker(page) == seen, f'Reading or opening changed the stored record {seen!r}'
        if seen == '2':
            await page.get_by_role('button', name="What's new", exact=True).click()
            await notes(page).get_by_role('button', name='Got it', exact=True).click()
            assert await marker(page) == '2', 'Manual acknowledgment downgraded a future revision'
        await clean(context, page, errors, requests)
    checks.append('Older and malformed records open; equal and future records stay closed; reading and opening never acknowledge a release')


async def dismissals(browser, url, checks):
    fixture = copy.deepcopy(FIXTURE)
    fixture['mode'] = 'draw'
    for method in ['Escape', 'Close patch notes', 'Got it', 'backdrop']:
        context, page, errors, requests = await new_page(browser, url, fixture=fixture)
        await expect(notes(page)).to_be_visible()
        await page.get_by_test_id('draw-surface').wait_for()
        before = await document(page)
        assert before['nodes'][0]['data']['label'] == 'Retained customer workflow'
        assert any(element.get('text') == 'Saved release planning' for element in before['architectureScene']['elements'])
        await notes(page).get_by_role('heading', name='Draw with more clarity', exact=True).click()
        await expect(notes(page)).to_be_visible()
        assert await marker(page) is None, 'A click inside the card acknowledged the release'
        if method == 'Escape':
            await page.keyboard.press('Escape')
        elif method == 'backdrop':
            await page.mouse.click(8, 8)
        else:
            await notes(page).get_by_role('button', name=method, exact=True).click()
        await expect(notes(page)).to_have_count(0)
        assert await marker(page) == LATEST, f'{method} did not persist the release'
        await await_draft_save(page)
        assert await document(page) == before, f'{method} changed the saved board'
        await page.reload(wait_until='networkidle')
        await page.get_by_test_id('draw-surface').wait_for()
        await expect(notes(page)).to_have_count(0)
        assert await document(page) == before, f'{method} or reload changed the saved board'
        await clean(context, page, errors, requests)
    checks.append('Escape, close, Got it, and backdrop persist acknowledgment; card clicks keep notes open; the saved graph and Draw board survive every route and reload')


async def manual_and_history(browser, url, checks):
    context, page, errors, requests = await new_page(browser, url, seen=LATEST)
    await expect(notes(page)).to_have_count(0)
    original = await document(page)
    await page.get_by_role('button', name='Add Step Node', exact=True).click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).nodes.length === 2', arg=DRAFT)
    edited = await document(page)
    selection_tool_class = await page.get_by_role('button', name='Selection Tool', exact=True).get_attribute('class')
    await expect(page.get_by_role('button', name='Undo', exact=True)).to_be_enabled()
    await expect(page.get_by_role('button', name='Redo', exact=True)).to_be_disabled()
    await screenshot(page, '02-manual-entry-dark.png')
    entry = page.get_by_role('button', name="What's new", exact=True)
    await entry.focus()
    await entry.press('Enter')
    dialog = notes(page)
    await expect(dialog).to_be_visible()
    assert await dialog.evaluate('(node) => node.contains(document.activeElement)'), 'Opening did not focus a dialog control'
    buttons = dialog.get_by_role('button')
    first, last = buttons.first, buttons.last
    await first.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(last).to_be_focused()
    await page.keyboard.press('Tab')
    await expect(first).to_be_focused()
    for key in ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']:
        await page.keyboard.press(key)
        assert await dialog.evaluate('(node) => node.contains(document.activeElement)'), f'{key} escaped the dialog'
    await dialog.get_by_role('listitem').first.click()
    text_focus = await page.evaluate('''() => ({tag: document.activeElement.tagName, label: document.activeElement.getAttribute('aria-label'), insideNotes: !!document.activeElement.closest('dialog, [role="dialog"]')})''')
    await page.keyboard.press('Control+z')
    await settle(page)
    text_click_undid_visible_graph = await page.locator('.react-flow__node').count() != 2
    text_click_enabled_redo = await page.get_by_role('button', name='Redo', exact=True).is_enabled()
    await await_draft_save(page)
    text_click_undid_diagram = text_click_undid_visible_graph or text_click_enabled_redo or await document(page) != edited
    await page.keyboard.press('Escape')
    await settle(page)
    text_click_blocked_escape = await notes(page).count() != 0
    print('OBSERVE release-text click ' + json.dumps({'focus': text_focus, 'undoChangedDraft': text_click_undid_diagram, 'escapeLeftNotesOpen': text_click_blocked_escape}), flush=True)
    assert not text_click_undid_diagram, 'Control+z after a release-text click changed the saved diagram'
    assert not text_click_blocked_escape, 'Escape after a release-text click did not dismiss notes'
    await expect(entry).to_be_focused()
    await entry.press('Enter')
    await expect(dialog).to_be_visible()
    highlight = dialog.get_by_role('listitem').first
    bounds = await highlight.bounding_box()
    assert bounds, 'Release highlight has no selectable text area'
    await page.mouse.move(bounds['x'] + 5, bounds['y'] + 10)
    await page.mouse.down()
    await page.mouse.move(bounds['x'] + bounds['width'] * .65, bounds['y'] + 10, steps=12)
    await page.mouse.up()
    assert await page.evaluate('window.getSelection().toString().length > 0'), 'Release text cannot be selected'
    await entry.focus()
    await settle(page)
    assert await dialog.evaluate('(node) => node.contains(document.activeElement)'), 'Programmatic outside focus escaped the modal'
    for key in ['Delete', 'Backspace', 'Control+a', 'Control+x', 'Control+v', 'Control+d', 'Control+z', 'Control+Shift+z', 's', 'h', 'a', 'ArrowRight']:
        await page.keyboard.press(key)
        await settle(page)
        assert await page.locator('.react-flow__node').count() == 2, f'{key} after a release-text click changed the visible graph'
        await expect(page.get_by_role('button', name='Undo', exact=True)).to_be_enabled()
        await expect(page.get_by_role('button', name='Redo', exact=True)).to_be_disabled()
        await expect(page.get_by_role('button', name='Selection Tool', exact=True)).to_have_class(selection_tool_class)
        await await_draft_save(page)
        assert await document(page) == edited, f'{key} after release-text selection mutated the saved diagram after autosave'
    await page.evaluate('window.getSelection().removeAllRanges()')
    await screenshot(page, '03-manual-dialog-dark.png')
    await page.keyboard.press('Escape')
    await expect(entry).to_be_focused()
    await expect(page.get_by_role('button', name='Undo', exact=True)).to_be_enabled()
    await expect(page.get_by_role('button', name='Redo', exact=True)).to_be_disabled()
    await page.get_by_role('button', name='Undo', exact=True).click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).nodes.length === 1', arg=DRAFT)
    assert await document(page) == original, 'Notes altered the existing undo transaction'
    await page.get_by_role('button', name='Redo', exact=True).click()
    await page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).nodes.length === 2', arg=DRAFT)
    assert await document(page) == edited, 'Notes altered the existing redo transaction'
    await page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
    await entry.click()
    await expect(notes(page)).to_be_visible()
    await screenshot(page, '04-manual-dialog-light.png')
    await notes(page).get_by_role('button', name='Got it', exact=True).click()
    for mode in ['Architecture Mode', 'Draw Mode', 'Flowchart Mode']:
        await page.get_by_role('button', name=mode, exact=True).click()
        await page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key)).mode === args.mode', arg={'key': DRAFT, 'mode': mode.split()[0].lower()})
        if mode == 'Draw Mode':
            await page.get_by_test_id('draw-surface').wait_for()
        await await_draft_save(page)
        before = await document(page)
        await entry.click()
        await expect(notes(page)).to_be_visible()
        await notes(page).get_by_role('button', name='Close patch notes', exact=True).click()
        await await_draft_save(page)
        assert await document(page) == before, f'Manual notes changed the document in {mode}'
    checks.append('Manual toolbar access works in every mode and both themes; focus stays inside after Tab, text clicks, text selection, and outside focus attempts; closing restores the entry and shortcuts preserve the draft and undo/redo transactions')
    await clean(context, page, errors, requests)


async def ai_prompt(browser, url, checks):
    context, page, errors, requests = await new_page(browser, url, seen=LATEST)
    await page.get_by_role('button', name='Open AI Assistant', exact=True).click()
    ai = page.get_by_role('dialog', name='FlowChart by Zero Click Dev', exact=True)
    await expect(ai).to_be_visible()
    prompt = 'Keep this unsent release planning prompt.'
    await ai.locator('textarea').fill(prompt)
    await ai.get_by_role('button', name='Close', exact=True).click()
    await expect(ai).to_have_count(0)
    await page.get_by_role('button', name="What's new", exact=True).click()
    await expect(notes(page)).to_be_visible()
    await expect(ai).to_have_count(0)
    await expect(page.get_by_role('button', name='Open AI Assistant', exact=True)).to_have_count(0)
    await notes(page).get_by_role('button', name='Got it', exact=True).click()
    await page.get_by_role('button', name='Open AI Assistant', exact=True).click()
    await expect(ai.locator('textarea')).to_have_value(prompt)
    checks.append('Closing the AI assistant, opening manual notes, and reopening the assistant preserves an unsent prompt; notes hide the floating AI entry')
    await clean(context, page, errors, requests)


async def compact_layout(browser, url, checks):
    context, page, errors, requests = await new_page(browser, url, compact=True)
    await expect(notes(page)).to_be_visible()
    for theme, filename in [('dark', '05-compact-dark.png'), ('light', '06-compact-light.png')]:
        dialog = notes(page)
        box = await page.locator('.patch-notes-dialog').bounding_box()
        assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= 391 and box['y'] + box['height'] <= 668, f'{theme} dialog is outside the compact viewport: {box}'
        for name in ['Close patch notes', 'Got it']:
            button = dialog.get_by_role('button', name=name, exact=True)
            await button.scroll_into_view_if_needed()
            bounds = await button.bounding_box()
            assert bounds and bounds['x'] >= 0 and bounds['y'] >= 0 and bounds['x'] + bounds['width'] <= 391 and bounds['y'] + bounds['height'] <= 668, f'{theme} {name} is unreachable: {bounds}'
        await screenshot(page, filename)
        await dialog.get_by_role('button', name='Got it', exact=True).click()
        await expect(notes(page)).to_have_count(0)
        if theme == 'dark':
            await page.get_by_role('button', name='Toggle Dark Mode', exact=True).click()
            entry = page.get_by_role('button', name="What's new", exact=True)
            await entry.scroll_into_view_if_needed()
            await screenshot(page, '07-compact-manual-entry-light.png')
            await entry.click()
            await expect(notes(page)).to_be_visible()
    checks.append('At 390 by 667, both themes keep the dialog and dismiss controls within the viewport, and the manual toolbar entry remains reachable')
    await clean(context, page, errors, requests)


async def blocked_storage(browser, url, checks):
    context, page, errors, requests = await new_page(browser, url, blocked=True)
    await expect(notes(page)).to_be_visible()
    before = await document(page)
    await notes(page).get_by_role('button', name='Got it', exact=True).click()
    await expect(notes(page)).to_have_count(0)
    await await_draft_save(page)
    assert await document(page) == before, 'Unavailable patch-note storage changed the saved diagram'
    for mode in ['Architecture Mode', 'Draw Mode', 'Flowchart Mode']:
        await page.get_by_role('button', name=mode, exact=True).click()
        await page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key)).mode === args.mode', arg={'key': DRAFT, 'mode': mode.split()[0].lower()})
        await expect(notes(page)).to_have_count(0)
    before = await document(page)
    await page.get_by_role('button', name="What's new", exact=True).click()
    await expect(notes(page)).to_be_visible()
    await page.keyboard.press('Escape')
    await expect(notes(page)).to_have_count(0)
    await await_draft_save(page)
    assert await document(page) == before, 'Unavailable patch-note storage changed the saved diagram'
    checks.append('When reads and writes of the acknowledgment key throw SecurityError, explicit dismissal remains effective throughout the page session and manual reopening still works')
    await clean(context, page, errors, requests)


async def shared_loading(browser, url, checks):
    context, page, errors, requests = await new_page(browser, None, fixture=None)
    requested, release = asyncio.Event(), asyncio.Event()
    chart = {
        'id': 'ProofNotes1', 'version': 1, 'title': 'Saved shared release plan',
        'mode': 'flowchart',
        'nodes': [{'id': 'shared-node', 'type': 'step', 'label': 'Loaded shared workflow', 'position': {'x': 100, 'y': 100}}],
        'edges': [], 'createdAt': '2026-10-28T00:00:00.000Z',
        'updatedAt': '2026-10-28T00:00:00.000Z', 'updatedVia': 'web',
    }

    async def shared_response(route):
        requested.set()
        await release.wait()
        await route.fulfill(status=200, content_type='application/json', body=json.dumps(chart))

    await page.route('**/api/flows/ProofNotes1*', shared_response)
    await page.goto(urljoin(url, '/f/ProofNotes1'), wait_until='domcontentloaded')
    await asyncio.wait_for(requested.wait(), timeout=15)
    await expect(page.get_by_role('heading', name='Opening shared flowchart…', exact=True)).to_be_visible()
    await expect(notes(page)).to_have_count(0)
    assert await marker(page) is None, 'Loading marked an unseen release as read'
    release.set()
    await expect(notes(page)).to_be_visible()
    await notes(page).get_by_role('button', name='Got it', exact=True).click()
    await expect(page.get_by_text('Loaded shared workflow', exact=True)).to_be_visible()
    await page.get_by_role('button', name='Enter Preview Mode', exact=True).click()
    await expect(page.locator('.preview-mode.fullscreen')).to_be_visible()
    await expect(notes(page)).to_have_count(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.preview-mode.fullscreen')).to_have_count(0)
    await expect(notes(page)).to_have_count(0)
    checks.append('Shared loading defers unseen notes without acknowledging them, completion opens them, and an acknowledged release does not interrupt presentation or its exit')
    await clean(context, page, errors, requests)


async def shared_error(browser, url, checks):
    context, page, errors, requests = await new_page(browser, None, fixture=None)

    async def unavailable(route):
        await route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'Proof server unavailable'}))

    await page.route('**/api/flows/ProofError*', unavailable)
    await page.goto(urljoin(url, '/f/ProofError'), wait_until='networkidle')
    await expect(page.get_by_role('heading', name="Couldn't open this flowchart", exact=True)).to_be_visible()
    await expect(notes(page)).to_have_count(0)
    assert await marker(page) is None
    checks.append('A failed shared load keeps unseen notes deferred and leaves the acknowledgment absent')
    await clean(context, page, errors, requests)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:3081/')
    parser.add_argument('--source-revision', required=True)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for check in [fresh_visit, visitor_records, dismissals, manual_and_history, ai_prompt, compact_layout, blocked_storage, shared_loading, shared_error]:
            await check(browser, args.url, checks)
            print(f'PASS {checks[-1]}', flush=True)
        report = {
            'sourceRevision': args.source_revision,
            'url': args.url,
            'verifiedAt': datetime.now(timezone.utc).isoformat(),
            'chromium': browser.version,
            'playwright': version('playwright'),
            'checks': checks,
            'negativeControl': {
                'sourceRevision': 'f3b3651c6dcf70621223b41622f8f87370691dbe',
                'observedOn': '2026-10-28',
                'action': 'Click a release highlight, press Control+z, wait 600ms, and press Escape',
                'focusAfterClick': 'BODY outside the dialog',
                'visibleNodes': {'before': 2, 'after': 1},
                'persistedDraftNodes': {'before': 2, 'after': 1},
                'redoEnabled': {'before': False, 'after': True},
                'escapeLeftNotesOpen': True,
            },
            'limits': [
                'Presentation is exercised after explicit acknowledgment. Pending unseen notes during presentation need controller and App tests.',
                'Shared responses are browser-routed fixtures. No live AI or shared backend calls are made.',
                'The existing full AI overlay blocks toolbar clicks. Prompt preservation uses its Close control before opening notes, then reopens the assistant.',
                'Acknowledgment is local to one browser profile and origin. When its storage is unavailable, page-session dismissal may repeat after a full reload.',
            ],
        }
        (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        await browser.close()
    print(f'PASS {len(checks)} browser scenarios; screenshots and report in {OUTPUT}', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
