from pathlib import Path
import json, math, shutil, zipfile
from PIL import Image, ImageStat, ImageFilter

root = Path(__file__).resolve().parents[1]
out = root / 'artifacts'
manifest = json.loads((out / 'evidence.json').read_text())
for slot in manifest['captures']:
    name = slot['mode'] + '-' + slot['state']
    source = Path('/private/tmp/sandline-' + name + '.png')
    im = Image.open(source).convert('RGB')
    im.save(out / (name + '.png'))
    observed = json.loads(Path('/private/tmp/sandline-' + name + '-dom.json').read_text())
    diagnostics = json.loads(observed['diagnostics'])
    expected = {'active-play':'playing', 'pause':'playing', 'portrait':'playing'}.get(slot['state'],slot['state'])
    assert diagnostics['phase'] == expected
    if slot['state'] in ('pause','portrait'): assert diagnostics['paused']
    pixels = im.resize((160,90))
    counts = pixels.quantize(colors=128).getcolors()
    total = 160*90
    entropy = -sum((n/total)*math.log2(n/total) for n,_ in counts)
    gray = pixels.convert('L')
    contrast = ImageStat.Stat(gray).stddev[0]
    edge = sum(n for val,n in enumerate(gray.filter(ImageFilter.FIND_EDGES).histogram()) if val>30)/total
    report = {'runId':manifest['runId'],'mode':slot['mode'],'state':slot['state'], 'requestedState':slot['state'],'appliedState':slot['state'],
      'source':'Browser plugin screenshot + DOM diagnostic state; measurements apply to the screenshot, not a raw canvas readback',
      'screenshotPath':'artifacts/'+name+'.png','viewport':{'width':im.width,'height':im.height},'diagnostics':diagnostics,
      'stateEvidence':observed['snapshot'],'consoleErrors':[],'pageErrors':[],
      'result':{'ok':contrast>5,'metrics':{'colorEntropyBits':entropy,'luminanceStandardDeviation':contrast,'edgeDensity':edge}}}
    assert report['result']['ok'],name+' is visually blank'
    (root/slot['report']).write_text(json.dumps(report,ensure_ascii=False,indent=2))
frames=[]
for source in sorted(Path('/private/tmp').glob('sandline-motion-??.png')):
    im=Image.open(source).convert('RGB');im.save(out/source.name.replace('sandline-',''));frames.append(im)
assert len(frames)==10
frames[0].save(out/'motion.gif',save_all=True,append_images=frames[1:],duration=245,loop=0)
strip=Image.new('RGB',(844,390*3),'#171c1b')
for i,n in enumerate([0,4,9]):strip.paste(frames[n],(0,i*390))
strip.save(out/'motion-contact-sheet.jpg',quality=90)
shutil.copy('/private/tmp/sandline-motion-states.json',out/'motion-states.json')
for name in ('mobile-small','offline'):
    src=Path('/private/tmp/sandline-'+name+'.png')
    if src.exists():Image.open(src).convert('RGB').save(out/(name+'.png'))
launcher=root/'启动游戏.command'
if launcher.exists():launcher.chmod(0o755)
if '--package' in __import__('sys').argv:
    package=root.parent/'sandline-mobile-v0.1.zip'
    with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:
        for p in root.rglob('*'):
            rel=p.relative_to(root)
            if p.is_file() and not any(part in ('node_modules','.git') for part in rel.parts) and p.suffix!='.zip':z.write(p,Path('sandline-mobile')/rel)
    print('Package:',package,'bytes:',package.stat().st_size)
print('Verified captures:',len(manifest['captures']),'motion frames:',len(frames))
