from PIL import Image

suit = Image.open('public/models/driver_textures/4_img_4.png')
print('Suit size:', suit.size, suit.mode)
# Sample a few pixels from the torso area
w, h = suit.size
print('Top left:', suit.getpixel((10, 10)))
print('Center:', suit.getpixel((w // 2, h // 2)))

helmet = Image.open('public/models/driver_textures/1_img_1.png')
print('Helmet size:', helmet.size, helmet.mode)
print('Helmet center:', helmet.getpixel((helmet.width // 2, helmet.height // 2)))
