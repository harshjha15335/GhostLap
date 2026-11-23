from PIL import Image

helmet = Image.open('public/models/driver_textures/1_img_1.png')
print('Helmet size:', helmet.size, helmet.mode)

# Save a grayscale version for tinting as well
gray_helmet = helmet.convert('L').convert('RGB')
gray_helmet.save('public/models/driver_textures/helmet_grayscale.png')
print('Saved helmet_grayscale.png')
