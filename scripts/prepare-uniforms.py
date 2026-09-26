from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'public/assets/characters'
source = Image.open(root / 'soldier-texture-1.jpg').convert('RGB')
for team, fabric, under in [('ct', (104, 126, 146), (63, 76, 87)), ('insurgent', (141, 126, 94), (78, 81, 63))]:
    result = source.copy()
    pixels = []
    for r, g, b in source.getdata():
        lum = (r * .2126 + g * .7152 + b * .0722) / 255
        red = r > g * 1.5 and r > b * 1.4 and r > 55
        tan = r > g * 1.045 and g > b * 1.025 and lum > .18
        if tan or red:
            light = min(1.2, max(.34, lum / .61)) if not red else .74
            tint = fabric
        else:
            light = min(1.2, max(.045, lum / .24))
            tint = under
        pixels.append(tuple(min(255, round(c * light)) for c in tint))
    result.putdata(pixels)
    result.save(root / f'{team}-uniform.jpg', quality=92)
    print(team, (root / f'{team}-uniform.jpg').stat().st_size)
