import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3030/'
LIVE = '--live' in sys.argv[2:]
SCRIPTS = [
    'docs/screenshots/draw-commands/verify_draw_commands.py',
    'scripts/verify-draw-command-focus.py',
    'scripts/verify-draw-geometry.py',
    'docs/screenshots/draw-media/verify_draw_media.py',
    'docs/screenshots/draw-media/verify_draw_media_fixes.py',
    'scripts/verify-draw-extra-tools.py',
    'scripts/verify-draw-selection-ai.py',
    'scripts/verify-draw-ai-text-layout.py',
]


for script in SCRIPTS:
    command = [sys.executable, str(ROOT / script), URL]
    if LIVE and script.endswith('verify-draw-selection-ai.py'):
        command.append('--live')
    print(f'Running {script}', flush=True)
    subprocess.run(command, cwd=ROOT, check=True)

print('PASS: combined Draw browser verifiers', flush=True)
