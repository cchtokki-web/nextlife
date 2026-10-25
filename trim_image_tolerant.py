from PIL import Image
import numpy as np

try:
    img = Image.open('public/favicon-image.png').convert('RGBA')
    arr = np.array(img)
    
    # Get the background color from top-left pixel
    bg_color = arr[0, 0]
    
    # Calculate color difference from background
    # Allow some tolerance for anti-aliasing/noise
    diff = np.abs(arr.astype(int) - bg_color.astype(int))
    mask = np.any(diff > 15, axis=2) # True for foreground pixels (diff > 15)
    
    # Find bounding box
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    
    print(f"Original bounding box found: cmin={cmin}, rmin={rmin}, cmax={cmax}, rmax={rmax}")
    
    # Add 5% padding relative to the original image or bounding box size
    pad = int(max(cmax-cmin, rmax-rmin) * 0.02)
    
    cmin = max(0, cmin - pad)
    rmin = max(0, rmin - pad)
    cmax = min(arr.shape[1], cmax + pad)
    rmax = min(arr.shape[0], rmax + pad)
    
    # Make square
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
    cropped_img.save('public/favicon-image.png')
    print("Cropped successfully to", cropped_img.size)
except Exception as e:
    import traceback
    traceback.print_exc()
