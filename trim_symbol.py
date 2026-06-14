from PIL import Image
import numpy as np

try:
    img = Image.open('public/symbol.png').convert('RGBA')
    arr = np.array(img)
    
    bg_color = arr[0, 0]
    
    diff = np.abs(arr.astype(int) - bg_color.astype(int))
    mask = np.any(diff > 15, axis=2)
    
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    
    if not np.any(rows):
        print("No bounding box found (empty image)")
        exit(0)
        
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    
    pad = int(max(cmax-cmin, rmax-rmin) * 0.02)
    
    cmin = max(0, cmin - pad)
    rmin = max(0, rmin - pad)
    cmax = min(arr.shape[1], cmax + pad)
    rmax = min(arr.shape[0], rmax + pad)
    
    width = cmax - cmin
    height = rmax - rmin
    side = max(width, height)
    center_c = (cmin + cmax) // 2
    center_r = (rmin + rmax) // 2
    
    new_cmin = max(0, center_c - side//2)
    new_rmin = max(0, center_r - side//2)
    new_cmax = min(arr.shape[1], new_cmin + side)
    new_rmax = min(arr.shape[0], new_rmin + side)
    
    cropped_img = img.crop((new_cmin, new_rmin, new_cmax, new_rmax))
    cropped_img.save('public/symbol.png')
    # also update favicon
    cropped_img.save('src/app/icon.png')
    
    print("Cropped successfully to", cropped_img.size)
except Exception as e:
    import traceback
    traceback.print_exc()
