from PIL import Image
import numpy as np

img = Image.open('public/symbol.png').convert('RGBA')
arr = np.array(img)

# Let's check the alpha channel instead of color difference
alpha = arr[:, :, 3]

for threshold in [1, 10, 50, 100, 150, 200, 250]:
    mask = alpha > threshold
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if np.any(rows):
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        print(f"Threshold {threshold}: cmin={cmin}, rmin={rmin}, cmax={cmax}, rmax={rmax}, width={cmax-cmin}, height={rmax-rmin}")
    else:
        print(f"Threshold {threshold}: empty")

