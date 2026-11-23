from PIL import Image, ImageEnhance
import os

suit = Image.open('public/models/driver_textures/4_img_4.png').convert('RGB')
w, h = suit.size

# Let's see: the red channel is high on red fabric, while white logos have high R, G, B, and dark shadows have low R, G, B.
# Let's convert to grayscale / luminance
gray = suit.convert('L')
# Enhance contrast slightly to keep highlights and shadows crisp
enhancer = ImageEnhance.Contrast(gray)
crisp_gray = enhancer.enhance(1.15).convert('RGB')

out_path = 'public/models/driver_textures/suit_grayscale.png'
crisp_gray.save(out_path)
print(f"Saved grayscale suit texture to {out_path} ({os.path.getsize(out_path)} bytes)")

# Test tinting with a few team colors:
# 1. Mercedes teal: #00D7B6 (0, 215, 182)
# 2. McLaren papaya: #FF8000 (255, 128, 0)
# 3. Ferrari red: #E8002D (232, 0, 45)
# 4. Aston Martin green: #00665E (0, 102, 94)

teams = {
    'mercedes': (0, 215, 182),
    'mclaren': (255, 128, 0),
    'ferrari': (232, 0, 45),
    'aston_martin': (0, 102, 94),
}

for name, rgb in teams.items():
    tinted = Image.new('RGB', (w, h))
    # Multiply grayscale by team color normalized
    g_data = crisp_gray.load()
    t_data = tinted.load()
    rf, gf, bf = rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0
    for y in range(h):
        for x in range(w):
            lum = g_data[x, y][0]
            t_data[x, y] = (int(lum * rf), int(lum * gf), int(lum * bf))
    t_path = f'public/models/driver_textures/suit_{name}.png'
    tinted.save(t_path)
    print(f"Saved tinted suit for {name} to {t_path}")
