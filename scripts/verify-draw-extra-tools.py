from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/screenshots/draw-extra-tools'
OUTPUT.mkdir(parents=True, exist_ok=True)
ORIGIN = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3034/'
DRAFT = 'flowchart-editor-draft-v3'


def document(page):
    return page.evaluate('(key) => JSON.parse(localStorage.getItem(key) || "{}")', arg=DRAFT)


def elements(page):
    return document(page).get('architectureScene', {}).get('elements', [])


def menu(page, name):
    page.get_by_role('button', name='More drawing tools').click()
    page.get_by_role('menuitem', name=name).click()


def new_drawing(browser):
    page = browser.new_page(viewport={'width': 1680, 'height': 1050}, device_scale_factor=1)
    page.goto(ORIGIN, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you')
    if dismiss.count():
        dismiss.click()
    page.get_by_role('button', name='Draw Mode').click()
    page.get_by_test_id('draw-surface').wait_for()
    return page


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1680, 'height': 1050}, device_scale_factor=1, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(ORIGIN, wait_until='networkidle')
    dismiss = page.get_by_role('button', name='No, thank you')
    if dismiss.count():
        dismiss.click()
    page.get_by_role('button', name='Draw Mode').click()
    surface = page.get_by_test_id('draw-surface')
    surface.wait_for()
    page.get_by_role('button', name='Rectangle tool').click()
    page.mouse.move(680, 340)
    page.mouse.down()
    page.mouse.move(870, 465, steps=12)
    page.mouse.up()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 1', arg=DRAFT)
    page.screenshot(path=str(OUTPUT / '01-filled-shape.png'))

    menu(page, 'Fill')
    page.mouse.click(775, 400)
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements[0].backgroundColor !== "transparent"', arg=DRAFT)
    assert elements(page)[0]['backgroundColor'] == '#b2f2dc'
    page.screenshot(path=str(OUTPUT / '02-fill-tool.png'))

    before_laser = json.dumps(document(page).get('architectureScene'), sort_keys=True)
    menu(page, 'Laser pointer')
    page.mouse.move(990, 300)
    page.mouse.down()
    page.mouse.move(1170, 400, steps=15)
    assert page.locator('.draw-laser-trace').count() == 1
    page.screenshot(path=str(OUTPUT / '03-laser-overlay.png'))
    page.mouse.up()
    assert json.dumps(document(page).get('architectureScene'), sort_keys=True) == before_laser
    page.wait_for_timeout(1050)
    assert page.locator('.draw-laser-trace').count() == 0

    menu(page, 'Eyedropper')
    page.mouse.click(775, 400)
    assert 'sampled' in page.get_by_role('alert').inner_text()

    menu(page, 'Draw to shape')
    page.mouse.move(1000, 500)
    page.mouse.down()
    for x, y in [(1090, 500), (1180, 500), (1180, 555), (1180, 610), (1090, 610), (1000, 610), (1000, 555), (1000, 500)]:
        page.mouse.move(x, y, steps=4)
    page.mouse.up()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 2', arg=DRAFT)
    assert elements(page)[1]['type'] == 'rectangle'
    page.screenshot(path=str(OUTPUT / '04-recognized-shape.png'))

    menu(page, 'Embed URL')
    page.get_by_role('textbox', name='Embed URL').fill('javascript:alert(1)')
    page.get_by_role('button', name='Add card').click()
    assert len(elements(page)) == 2
    page.get_by_role('textbox', name='Embed URL').fill('https://example.com/demo')
    page.get_by_role('button', name='Add card').click()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 3', arg=DRAFT)
    assert elements(page)[2]['link'] == 'https://example.com/demo'
    assert page.locator('iframe[title="Live web embed"]').count() == 0
    page.screenshot(path=str(OUTPUT / '05-static-embed-card.png'))
    page.get_by_role('button', name='Load live content').click()
    assert page.locator('iframe[title="Live web embed"]').get_attribute('sandbox') == 'allow-scripts'
    page.get_by_role('button', name='Close live embed').click()
    page.mouse.move(850, 625)
    page.mouse.down()
    page.mouse.move(1320, 700, steps=12)
    page.mouse.up()

    menu(page, 'Import Mermaid')
    page.get_by_role('textbox', name='Mermaid source').fill('flowchart TB\nA-->B-->C')
    page.get_by_role('button', name='Import shapes').click()
    assert len(elements(page)) == 3
    page.get_by_role('textbox', name='Mermaid source').fill('flowchart LR\nA[Start] -->|go| B{Choose}\nB --> C(Done)')
    page.get_by_role('button', name='Import shapes').click()
    page.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length > 3', arg=DRAFT)
    imported = elements(page)
    assert any(element.get('containerId') for element in imported if element['type'] == 'text')
    page.mouse.move(580, 560)
    page.mouse.down()
    page.mouse.move(390, 560, steps=12)
    page.mouse.up()
    page.mouse.click(1270, 350)
    dismiss_message = page.get_by_role('button', name='Dismiss drawing message')
    if dismiss_message.count():
        dismiss_message.click()
    page.screenshot(path=str(OUTPUT / '06-editable-mermaid.png'))

    count = len(imported)
    page.get_by_role('button', name='Undo drawing').click()
    page.get_by_role('button', name='Undo drawing').click()
    page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key) || "{}").architectureScene?.elements.length < args.count', arg={'key': DRAFT, 'count': count})
    page.get_by_role('button', name='Redo drawing').click()
    page.get_by_role('button', name='Redo drawing').click()
    page.wait_for_function('(args) => JSON.parse(localStorage.getItem(args.key) || "{}").architectureScene?.elements.length === args.count', arg={'key': DRAFT, 'count': count})
    page.reload(wait_until='networkidle')
    page.get_by_test_id('draw-surface').wait_for()
    assert len(elements(page)) == count
    assert page.locator('[data-element-type="embeddable"]').count() == 1
    assert page.locator('[data-element-type="diamond"]').count() == 1
    page.get_by_role('button', name='Export', exact=True).click()
    with page.expect_download() as svg_download:
        page.get_by_role('button', name='Export as SVG').click()
    svg_file = OUTPUT / 'drawing-export.svg'
    svg_download.value.save_as(svg_file)
    svg = svg_file.read_text()
    assert 'example.com' in svg and '<iframe' not in svg
    page.get_by_role('button', name='Export', exact=True).click()
    with page.expect_download() as json_download:
        page.get_by_role('button', name='Export as JSON').click()
    json_file = OUTPUT / 'drawing-roundtrip.json'
    json_download.value.save_as(json_file)
    exported = json.loads(json_file.read_text())
    assert len(exported['architectureScene']['elements']) == count
    page.get_by_role('button', name='Export', exact=True).click()
    page.get_by_label('Import JSON or Excalidraw file').set_input_files(str(json_file))
    page.get_by_test_id('draw-surface').wait_for()
    assert len(elements(page)) == count
    svg_file.unlink()
    json_file.unlink()
    assert not errors, errors
    laser = new_drawing(browser)
    laser.get_by_role('button', name='Rectangle tool').click()
    laser.mouse.move(680, 340)
    laser.mouse.down()
    laser.mouse.move(870, 465, steps=10)
    laser.mouse.up()
    laser.keyboard.press('k')
    laser.mouse.move(990, 300)
    laser.mouse.down()
    laser.mouse.move(1170, 400, steps=12)
    assert laser.locator('.draw-laser-trace:not(.is-fading)').count() == 1
    laser.keyboard.press('Control+z')
    laser.mouse.up()
    laser.wait_for_timeout(1200)
    assert laser.locator('.draw-laser-trace').count() == 0
    assert len(elements(laser)) == 0
    laser.screenshot(path=str(OUTPUT / '07-laser-undo-cancelled.png'))
    laser.keyboard.press('k')
    laser.mouse.move(900, 350)
    laser.mouse.down()
    laser.mouse.move(1000, 420, steps=5)
    laser.get_by_test_id('draw-surface').dispatch_event('pointercancel', {'pointerId': 1})
    laser.mouse.up()
    assert laser.locator('.draw-laser-trace').count() == 0
    laser.close()

    sampler = new_drawing(browser)
    sampler.get_by_role('button', name='Rectangle tool').click()
    sampler.mouse.move(680, 340)
    sampler.mouse.down()
    sampler.mouse.move(870, 465, steps=10)
    sampler.mouse.up()
    menu(sampler, 'Fill')
    sampler.mouse.click(775, 400)
    sampler.keyboard.press('Shift+g')
    sampler.mouse.click(775, 400)
    assert 'Fill sampled:' in sampler.get_by_role('alert').inner_text()
    sampler.keyboard.press('i')
    sampler.mouse.click(775, 400)
    assert 'Stroke sampled:' in sampler.get_by_role('alert').inner_text()
    sampler.keyboard.press('Shift+g')
    menu(sampler, 'Eyedropper')
    sampler.mouse.click(775, 400)
    assert 'Stroke sampled:' in sampler.get_by_role('alert').inner_text()
    sampler.screenshot(path=str(OUTPUT / '08-eyedropper-stroke-reset.png'))
    sampler.close()

    mermaid = new_drawing(browser)
    menu(mermaid, 'Import Mermaid')
    mermaid.get_by_role('textbox', name='Mermaid source').fill('flowchart LR\nA[Start] -->|go| B[End]')
    mermaid.get_by_role('button', name='Import shapes').click()
    mermaid.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 6', arg=DRAFT)
    records = elements(mermaid)
    arrow = next(item for item in records if item['type'] == 'arrow')
    label = next(item for item in records if item['type'] == 'text' and item.get('containerId') == arrow['id'])
    backdrop = mermaid.locator('[data-draw-label-backdrop="true"]')
    assert backdrop.count() == 1
    assert float(backdrop.get_attribute('width')) == label['width'] + 10
    assert label['x'] - 5 - arrow['x'] >= 30
    assert arrow['x'] + arrow['width'] - label['x'] - label['width'] - 5 >= 30
    mermaid.screenshot(path=str(OUTPUT / '09-mermaid-visible-connector.png'))
    mermaid.close()

    long_label = new_drawing(browser)
    menu(long_label, 'Import Mermaid')
    long_label.get_by_role('textbox', name='Mermaid source').fill('flowchart LR\nA[Start] -->|Continue through the review| B[End]')
    long_label.get_by_role('button', name='Import shapes').click()
    long_label.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 6', arg=DRAFT)
    records = elements(long_label)
    arrow = next(item for item in records if item['type'] == 'arrow')
    label = next(item for item in records if item['type'] == 'text' and item.get('containerId') == arrow['id'])
    assert label['x'] - 5 - arrow['x'] >= 30
    assert arrow['x'] + arrow['width'] - label['x'] - label['width'] - 5 >= 30
    assert label['width'] >= len('Continue through the review') * 14
    long_label.screenshot(path=str(OUTPUT / '11-mermaid-long-label.png'))
    long_label.close()

    pending = new_drawing(browser)
    pending.get_by_role('button', name='Arrow tool').click()
    pending.mouse.click(600, 400)
    pending.mouse.move(750, 500)
    assert pending.locator('[data-element-type="arrow"]').count() == 1
    assert len(elements(pending)) == 0
    menu(pending, 'Import Mermaid')
    assert pending.locator('[data-element-type="arrow"]').count() == 0
    pending.get_by_role('textbox', name='Mermaid source').fill('flowchart LR\nA[Start] -->|go| B[End]')
    pending.get_by_role('button', name='Import shapes').click()
    pending.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 6', arg=DRAFT)
    assert len([item for item in elements(pending) if item['type'] == 'arrow']) == 1
    pending.screenshot(path=str(OUTPUT / '10-mermaid-pending-preview-cancelled.png'))
    pending.close()
    pending_embed = new_drawing(browser)
    pending_embed.get_by_role('button', name='Arrow tool').click()
    pending_embed.mouse.click(600, 400)
    pending_embed.mouse.move(750, 500)
    menu(pending_embed, 'Embed URL')
    assert pending_embed.locator('[data-element-type="arrow"]').count() == 0
    pending_embed.get_by_role('textbox', name='Embed URL').fill('https://example.com')
    pending_embed.get_by_role('button', name='Add card').click()
    pending_embed.wait_for_function('(key) => JSON.parse(localStorage.getItem(key) || "{}").architectureScene?.elements.length === 1', arg=DRAFT)
    assert elements(pending_embed)[0]['type'] == 'embeddable'
    pending_embed.close()
    browser.close()
    print(f'Verified {count} retained elements, undo/redo, export/import roundtrip, reload, four regressions, and eleven screenshots.')
