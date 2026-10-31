from pathlib import Path
from PIL import Image, ImageDraw
import json,zipfile,shutil

root=Path(__file__).resolve().parents[1];out=root/'artifacts/v02';tmp=Path('/private/tmp')
manifest=json.loads((out/'evidence.json').read_text());logs=json.loads((tmp/'sandline-v02-browser-logs.json').read_text());assert not logs,logs
for slot in manifest['captures']:
 name=slot['mode']+'-'+slot['state'];im=Image.open(tmp/f'sandline-v02-{name}.png').convert('RGB');im.save(out/f'{name}.png')
 observed=json.loads((tmp/f'sandline-v02-{name}.json').read_text());d=json.loads(observed['diagnostics']);state=slot['state']
 assert d['phase']==('matchEnd' if state=='matchEnd' else 'playing')
 assert d['frozen'] and d['character']['loaded'] and d['environment']['loaded']==10 and not d['environment']['failed']
 if state=='reload':assert d['viewmodel']['phase']=='magazine-out' and d['viewmodel']['magazineOffset']<-.15
 if state=='explosion':assert d['effects']['particles']>20
 if state=='pause':assert d['paused']
 metrics=d['canvas'];assert metrics['colorEntropyBits']>3 and metrics['luminance']['contrast']>60
 report={'runId':manifest['runId'],'mode':slot['mode'],'state':state,'requestedState':state,'appliedState':state,'screenshotPath':f'artifacts/v02/{name}.png','viewport':{'width':im.width,'height':im.height},'diagnostics':d,'stateEvidence':observed['snapshot'],'source':'Browser screenshot plus visible game diagnostic panel. Pixel metrics are sampled by game debug code using WebGL readPixels after world and viewmodel render; HUD is excluded. Standalone Playwright inspector was not run.','consoleErrors':[],'pageErrors':[],'result':{'ok':True,'metrics':metrics,'renderBudget':{'tier':slot['mode'],'actual':d['renderer'],'mobileLimits':{'calls':150,'triangles':300000,'geometries':200,'textures':40}}}}
 (root/slot['report']).write_text(json.dumps(report,ensure_ascii=False,indent=2))
for seq,duration in [('reload',200),('locomotion',230)]:
 frames=[]
 for p in sorted(tmp.glob(f'sandline-v02-{seq}-??.png')):
  im=Image.open(p).convert('RGB');im.save(out/p.name.replace('sandline-v02-',''));frames.append(im)
 assert len(frames)>=12
 frames[0].save(out/f'{seq}.gif',save_all=True,append_images=frames[1:],duration=duration,loop=0)
 states=json.loads((tmp/f'sandline-v02-{seq}-frames.json').read_text());assert all(not s['frozen'] for s in states)
 shutil.copy(tmp/f'sandline-v02-{seq}-frames.json',out/f'{seq}-frames.json')
 strip=Image.new('RGB',(844*2,390*2),'#151f20')
 for i,n in enumerate([0,4,8,len(frames)-1]):strip.paste(frames[n],((i%2)*844,(i//2)*390))
 strip.save(out/f'{seq}-contact.jpg',quality=90)
for name in ['mobile-small','mobile-portrait','weapon-smg','weapon-shotgun','weapon-pistol','offline']:
 p=tmp/f'sandline-v02-{name}.png'
 if p.exists():Image.open(p).convert('RGB').save(out/f'{name}.png')
shutil.copy(tmp/'sandline-v02-audio-runtime.json',out/'audio-runtime.json')
shutil.copy(tmp/'sandline-v02-browser-logs.json',out/'browser-logs.json')
shutil.copy(tmp/'sandline-v02-offline.json',out/'offline.json')
before=Image.open(root/'artifacts/mobile-active-play.png').convert('RGB');after=Image.open(out/'mobile-active-play.png').convert('RGB');comparison=Image.new('RGB',(844*2,422),'#172323');comparison.paste(before,(0,32));comparison.paste(after,(844,32));draw=ImageDraw.Draw(comparison);draw.text((16,10),'v0.1',fill='#eee1c9');draw.text((860,10),'v0.2',fill='#eee1c9');comparison.save(out/'before-after.jpg',quality=94)
if '--package' in __import__('sys').argv:
 package=root.parent/'sandline-mobile-v0.2.zip'
 with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as archive:
  for p in root.rglob('*'):
   rel=p.relative_to(root)
   if p.is_file() and not any(part in ('node_modules','.git') for part in rel.parts) and p.suffix!='.zip':archive.write(p,Path('sandline-mobile')/rel)
 print('Packaged',package,package.stat().st_size)
print('Verified',len(manifest['captures']),'captures and two motion sequences.')
