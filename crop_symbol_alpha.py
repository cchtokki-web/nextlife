from PIL import Image
import numpy as np

img = Image.open('public/symbol.png').convert('RGBA')
arr = np.array(img)

alpha = arr[:, :, 3]
mask = alpha > 10

rows = np.any(mask, axis=1)
cols = np.any(mask, axis=0)

rmin, rmax = np.where(rows)[0][[0, -1]]
cmin, cmax = np.where(cols)[0][[0, -1]]

width = cmax - cmin
height = rmax - rmin

# Make a square bounding box based on the max dimension
side = max(width, height)
center_c = (cmin + cmax) // 2
center_r = (rmin + rmax) // 2

# Add 2% padding
pad = int(side * 0.02)
side += pad * 2

new_cmin = max(0, center_c - side//2)
new_rmin = max(0, center_r - side//2)
new_cmax = min(arr.shape[1], new_cmin + side)
new_rmax = min(arr.shape[0], new_rmin + side)

cropped_img = img.crop((new_cmin, new_rmin, new_cmax, new_rmax))
cropped_img.save('public/symbol.png')
cropped_img.save('src/app/icon.png')

print("Properly cropped successfully to", cropped_img.size)
