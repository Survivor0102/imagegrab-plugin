"""Run on the authorized Shop server after packing this directory as a zip."""
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path('/root/Shop')
SOURCE = Path(__file__).resolve().parent
targets = ['backend/web/models/user.py', 'backend/web/urls.py', 'frontend/src/router/index.js', 'frontend/src/components/NavBar.vue']
baseline = json.loads((SOURCE / 'baseline-hashes.json').read_text())
for name in targets:
    digest = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    if digest != baseline[name]:
        raise SystemExit(f'Concurrent change detected; no edits made: {name}')
backup = ROOT / '.imagegrab-you/backups' / datetime.now().strftime('%Y%m%d-%H%M%S')
for name in targets + ['backend/static/frontend/index.html']:
    old = ROOT / name
    if old.exists():
        dest = backup / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(old, dest)

def edit(name, old, new):
    path = ROOT / name
    data = path.read_text()
    if data.count(old) != 1:
        raise RuntimeError(f'Expected one matching anchor: {name}')
    path.write_text(data.replace(old, new))

files = [
    'backend/web/models/imagegrab_you.py',
    'backend/web/views/goods/imagegrab_you.py',
    'backend/web/views/goods/imagegrab_you_evidence.py',
    'frontend/src/views/goods/ImageGrabYou.vue',
    'backend/web/migrations/0078_imagegrab_you.py',
    'backend/web/migrations/0079_imagegrab_you_sourcing_links.py',
    'backend/web/migrations/0080_imagegrab_you_candidate_pool.py',
]
for name in files:
    dest = ROOT / name
    if dest.exists():
        raise RuntimeError(f'Unexpected existing target: {name}')
for name in files:
    dest = ROOT / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / name, dest)

model = ROOT / targets[0]
with model.open('a') as stream:
    stream.write('\n\n# ImageGrab research is stored independently of existing 1688 candidates.\nfrom web.models.imagegrab_you import ImageGrabYouProduct, ImageGrabYouOffer, ImageGrabYouJob, ImageGrabYouRequest, ImageGrabYouCandidate  # noqa: F401,E402\n')
edit(targets[1], 'urlpatterns = [', 'from web.views.goods.imagegrab_you import ImageGrabYouView\n\nurlpatterns = [\n    path(\'api/goods/imagegrab-you/\', ImageGrabYouView.as_view(), name=\'imagegrab-you\'),')
route = "    { path: '/goods/Sourcing1688', name: 'goods-sourcing-1688', meta: { requiresAuth: true }, component: () => import('../views/goods/Sourcing1688.vue') },"
edit(targets[2], route, route + "\n    { path: '/goods/ImageGrabYou', name: 'goods-imagegrab-you', meta: { requiresAuth: true, requiresAdmin: true }, component: () => import('../views/goods/ImageGrabYou.vue') },")
guard = "    } else if (to.meta.requiresSuperuser && localStorage.getItem('is_superuser') !== '1') {"
edit(targets[2], guard, "    } else if (to.meta.requiresAdmin && localStorage.getItem('role') !== 'admin') {\n      next({ name: 'homepage-index' })\n" + guard)
nav = "  ...(user.isAdmin() ? [{ id: 'sourcing1688', icon: '⇄', name: '1688', routeName: 'goods-sourcing-1688' }] : []),"
edit(targets[3], nav, nav + "\n  ...(user.isAdmin() ? [{ id: 'imagegrabyou', icon: '◇', name: '1688_you', routeName: 'goods-imagegrab-you' }] : []),")
print(json.dumps({'backup': str(backup), 'new_files': files, 'edited_files': targets}))
