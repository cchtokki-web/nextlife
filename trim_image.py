from PIL import Image, ImageChops

def trim(im):
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        # Add 5% padding
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        pad_x = int(width * 0.05)
        pad_y = int(height * 0.05)
        
        new_bbox = (
            max(0, bbox[0] - pad_x),
            max(0, bbox[1] - pad_y),
            min(im.size[0], bbox[2] + pad_x),
            min(im.size[1], bbox[3] + pad_y)
        )
        return im.crop(new_bbox)
    return im

try:
    img = Image.open('public/favicon-image.png')
    img = img.convert("RGBA")
    
    # Create a white background to paste the image on, so we can reliably trim transparency or white
    white_bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    white_bg.paste(img, mask=img)
    
    # We want to trim white space. So we get bounding box of non-white
    bg = Image.new("RGBA", white_bg.size, (255,255,255,255))
    diff = ImageChops.difference(white_bg, bg)
    bbox = diff.getbbox()
    
    if bbox:
        # Make the crop square
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        max_dim = max(width, height)
        
        center_x = (bbox[0] + bbox[2]) // 2
        center_y = (bbox[1] + bbox[3]) // 2
        
        pad = int(max_dim * 0.05)
        half_dim = (max_dim // 2) + pad
        
        new_bbox = (
            max(0, center_x - half_dim),
            max(0, center_y - half_dim),
            min(img.size[0], center_x + half_dim),
            min(img.size[1], center_y + half_dim)
        )
        cropped_img = img.crop(new_bbox)
        cropped_img.save('public/favicon-image.png')
        print("Cropped successfully to", cropped_img.size)
    else:
        print("No bounding box found")
except Exception as e:
    print(f"Error: {e}")
