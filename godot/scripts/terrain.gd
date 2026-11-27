extends Node2D
## Destructible terrain. Split into columns so a crater only re-uploads the pieces it touches.

const WIDTH := 1800
const HEIGHT := 760
const CHUNK := 200

var solid := PackedByteArray()
var _images: Array[Image] = []
var _textures: Array[ImageTexture] = []


func generate() -> void:
	solid.resize(WIDTH * HEIGHT)
	solid.fill(0)
	_images.clear()
	_textures.clear()
	for child in get_children():
		child.queue_free()
	var phase_a := randf() * TAU
	var phase_b := randf() * TAU
	var stops := [Color("594430"), Color("413124"), Color("29201a"), Color("171210")]
	var offsets := [0.0, 0.28, 0.68, 1.0]
	var row_colors: Array[Color] = []
	for y in HEIGHT:
		var k: float = clamp((y - HEIGHT * 0.42) / (HEIGHT * 0.58), 0.0, 1.0)
		var color: Color = stops[0]
		for i in 3:
			if k >= offsets[i]:
				color = stops[i].lerp(stops[i + 1], clamp((k - offsets[i]) / (offsets[i + 1] - offsets[i]), 0.0, 1.0))
		row_colors.append(color)

	for chunk in range(0, WIDTH, CHUNK):
		var image := Image.create(CHUNK, HEIGHT, false, Image.FORMAT_RGBA8)
		for local_x in CHUNK:
			var x := chunk + local_x
			var top := int(HEIGHT * 0.62 + sin(x / 250.0 + phase_a) * 56.0 + sin(x / 95.0 + phase_b) * 20.0 + sin(x / 36.0) * 4.0)
			for y in range(top, HEIGHT):
				var color: Color = row_colors[y]
				if y - top < 3:
					color = Color("73b85a")
				elif y - top < 9:
					color = Color("4b8b3b")
				image.set_pixel(local_x, y, color)
				solid[y * WIDTH + x] = 1
		var texture := ImageTexture.create_from_image(image)
		_images.append(image)
		_textures.append(texture)
		var sprite := Sprite2D.new()
		sprite.centered = false
		sprite.position = Vector2(chunk, 0)
		sprite.texture = texture
		add_child(sprite)


func is_solid(x: float, y: float) -> bool:
	if x < 0.0 or x >= WIDTH or y < 0.0 or y >= HEIGHT:
		return false
	return solid[int(y) * WIDTH + int(x)] == 1


func ground_y(x: float) -> float:
	var y := 0
	while y < HEIGHT and not is_solid(x, y):
		y += 1
	return y


func carve(center: Vector2, radius: float) -> void:
	var rim := radius + 5.0
	var dirty: Dictionary = {}
	for y in range(max(0, int(center.y - rim)), min(HEIGHT, int(center.y + rim) + 1)):
		for x in range(max(0, int(center.x - rim)), min(WIDTH, int(center.x + rim) + 1)):
			var distance := Vector2(x + 0.5, y + 0.5).distance_to(center)
			if distance > rim or solid[y * WIDTH + x] == 0:
				continue
			var chunk := int(x / float(CHUNK))
			if distance <= radius:
				solid[y * WIDTH + x] = 0
				_images[chunk].set_pixel(x - chunk * CHUNK, y, Color(0, 0, 0, 0))
			else:
				_images[chunk].set_pixel(x - chunk * CHUNK, y, Color("1c140f"))
			dirty[chunk] = true
	for chunk in dirty:
		_textures[chunk].update(_images[chunk])
