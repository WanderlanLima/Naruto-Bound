extends Node2D
## Player for the Spine 3.8 particle packs (region attachments only), drawn by the GPU.
## A canvas item has a single blend mode, so each run of equal blend slots gets its own item.

static var _materials: Dictionary = {}

var ninja: RefCounted
var pack: Dictionary
var anim_name: String
var unit: float = 1.0
var direction: float = 1.0
var _items: Array[RID] = []


func setup(owner_ninja: RefCounted, spine_pack: Dictionary, animation_name: String, facing: float) -> void:
	ninja = owner_ninja
	pack = spine_pack
	anim_name = animation_name
	unit = owner_ninja.char_scale
	direction = facing


func duration_ms() -> float:
	return max(180.0, round(float(pack["dur"].get(anim_name, 0.7)) * 1000.0))


func _exit_tree() -> void:
	for rid in _items:
		RenderingServer.free_rid(rid)
	_items.clear()


static func _material(blend: String) -> CanvasItemMaterial:
	if not _materials.has(blend):
		var material := CanvasItemMaterial.new()
		if blend == "additive" or blend == "screen":
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		elif blend == "multiply":
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_MUL
		else:
			material.blend_mode = CanvasItemMaterial.BLEND_MODE_MIX
		_materials[blend] = material
	return _materials[blend]


func _item(index: int, blend: String) -> RID:
	while _items.size() <= index:
		var created := RenderingServer.canvas_item_create()
		RenderingServer.canvas_item_set_parent(created, get_canvas_item())
		RenderingServer.canvas_item_set_draw_index(created, _items.size())
		_items.append(created)
	RenderingServer.canvas_item_set_material(_items[index], _material(blend).get_rid())
	return _items[index]


func show_at(world_position: Vector2, elapsed_sec: float) -> void:
	position = world_position
	for rid in _items:
		RenderingServer.canvas_item_clear(rid)
	var animation: Dictionary = pack["anims"].get(anim_name, {})
	if animation.is_empty():
		return
	var bones := _pose(animation.get("bones", {}), elapsed_sec)
	var slot_timelines: Dictionary = animation.get("slots", {})
	var item_index := -1
	var item_blend := ""
	var item := RID()

	for slot in pack["slots"]:
		var timeline: Dictionary = slot_timelines.get(slot["name"], {})
		var attachment_name = slot.get("attachment")
		if timeline.has("attachment"):
			var current = null
			for key in timeline["attachment"]:
				if float(key.get("time", 0.0)) <= elapsed_sec:
					current = key
				else:
					break
			if current != null:
				attachment_name = current.get("name")
		if attachment_name == null:
			continue
		var skin: Dictionary = pack["sk"].get(slot["name"], {})
		if not skin.has(attachment_name):
			continue
		var attachment: Dictionary = skin[attachment_name]
		var region_name = attachment.get("path", attachment.get("name", attachment_name))
		if not pack["rg"].has(region_name):
			continue
		var region: Dictionary = pack["rg"][region_name]
		var page := int(region["p"])
		if page >= pack["pages"].size():
			continue

		var color := _hex(slot.get("color"))
		if timeline.has("color"):
			color = _color_at(timeline["color"], elapsed_sec, "color")
		elif timeline.has("twoColor"):
			color = _color_at(timeline["twoColor"], elapsed_sec, "light")
		color *= _hex(attachment.get("color"))
		if color.a < 0.01:
			continue
		if not pack["bi"].has(slot["bone"]):
			continue

		var blend: String = slot.get("blend") if slot.get("blend") != null else "normal"
		if item_index < 0 or blend != item_blend:
			item_index += 1
			item_blend = blend
			item = _item(item_index, blend)

		var bone: Transform2D = bones[int(pack["bi"][slot["bone"]])]
		var angle := deg_to_rad(float(attachment.get("rotation", 0.0)))
		var sx := float(attachment.get("scaleX", 1.0))
		var sy := float(attachment.get("scaleY", 1.0))
		var local := Transform2D(Vector2(cos(angle) * sx, sin(angle) * sx),
			Vector2(-sin(angle) * sy, cos(angle) * sy),
			Vector2(attachment.get("x", 0.0), attachment.get("y", 0.0)))
		var flip := Transform2D(Vector2(1, 0), Vector2(0, -1), Vector2.ZERO)
		var world := Transform2D(Vector2(unit * direction, 0), Vector2(0, -unit), Vector2.ZERO) * bone * local * flip

		var original_w = float(region.get("ow", region["w"]))
		var original_h = float(region.get("oh", region["h"]))
		var kx = float(attachment.get("width", original_w)) / max(1.0, original_w)
		var ky = float(attachment.get("height", original_h)) / max(1.0, original_h)
		var dx = (-original_w / 2.0 + float(region.get("ox", 0))) * kx
		var dy = -((-original_h / 2.0 + float(region.get("oy", 0))) * ky + float(region["h"]) * ky)
		var w = float(region["w"])
		var h = float(region["h"])
		var tex: Texture2D = ninja.texture(pack["pages"][page])
		if tex == null:
			continue
		var rotate = region.get("rotate", false)
		var rotated: bool = (rotate is bool and rotate) or (rotate is float and int(rotate) == 90)
		if rotated:
			# The atlas stores this region turned 90 degrees: draw it turned back
			var turned := world * Transform2D(-PI / 2.0, Vector2(dx, dy + h * ky))
			RenderingServer.canvas_item_add_set_transform(item, turned)
			RenderingServer.canvas_item_add_texture_rect_region(item, Rect2(0, 0, h * ky, w * kx),
				tex.get_rid(), Rect2(region["x"], region["y"], h, w), color)
		else:
			RenderingServer.canvas_item_add_set_transform(item, world)
			RenderingServer.canvas_item_add_texture_rect_region(item, Rect2(dx, dy, w * kx, h * ky),
				tex.get_rid(), Rect2(region["x"], region["y"], w, h), color)


func _pose(bone_timelines: Dictionary, t: float) -> Array:
	var result: Array = []
	for bone in pack["bones"]:
		var timeline: Dictionary = bone_timelines.get(bone["name"], {})
		var x := float(bone.get("x", 0.0))
		var y := float(bone.get("y", 0.0))
		var r := float(bone.get("rotation", 0.0))
		var sx := float(bone.get("scaleX", 1.0))
		var sy := float(bone.get("scaleY", 1.0))
		var hx := float(bone.get("shearX", 0.0))
		var hy := float(bone.get("shearY", 0.0))
		if timeline.has("translate"):
			var v := _sample(timeline["translate"], t, ["x", "y"], [0.0, 0.0], false)
			x += v[0]
			y += v[1]
		if timeline.has("rotate"):
			r += _sample(timeline["rotate"], t, ["angle"], [0.0], true)[0]
		if timeline.has("scale"):
			var v := _sample(timeline["scale"], t, ["x", "y"], [1.0, 1.0], false)
			sx *= v[0]
			sy *= v[1]
		if timeline.has("shear"):
			var v := _sample(timeline["shear"], t, ["x", "y"], [0.0, 0.0], false)
			hx += v[0]
			hy += v[1]
		var local := Transform2D(
			Vector2(cos(deg_to_rad(r + hx)) * sx, sin(deg_to_rad(r + hx)) * sx),
			Vector2(cos(deg_to_rad(r + 90.0 + hy)) * sy, sin(deg_to_rad(r + 90.0 + hy)) * sy),
			Vector2(x, y))
		var parent = bone.get("parent")
		if parent != null:
			local = result[int(pack["bi"][parent])] * local
		result.append(local)
	return result


static func _sample(frames: Array, t: float, fields: Array, defaults: Array, is_angle: bool) -> Array:
	if frames.is_empty():
		return defaults
	var first: Dictionary = frames[0]
	var first_time := float(first.get("time", 0.0))
	if t < first_time - 0.00001:
		return defaults
	var out: Array = []
	var last: Dictionary = frames[frames.size() - 1]
	if t <= first_time or t >= float(last.get("time", 0.0)):
		var key: Dictionary = first if t <= first_time else last
		for j in fields.size():
			out.append(float(key.get(fields[j], defaults[j])))
		return out
	var i := 0
	while i < frames.size() - 2 and float(frames[i + 1].get("time", 0.0)) <= t:
		i += 1
	var a: Dictionary = frames[i]
	var b: Dictionary = frames[i + 1]
	var span = max(0.0001, float(b.get("time", 0.0)) - float(a.get("time", 0.0)))
	var progress := _curve(a, (t - float(a.get("time", 0.0))) / span)
	for j in fields.size():
		var from := float(a.get(fields[j], defaults[j]))
		var delta := float(b.get(fields[j], defaults[j])) - from
		if is_angle:
			delta -= floor((delta + 180.0) / 360.0) * 360.0
		out.append(from + delta * progress)
	return out


static func _curve(key: Dictionary, t: float) -> float:
	if not key.has("curve"):
		return t
	var curve = key["curve"]
	if curve is String:
		return 0.0 if curve == "stepped" else t
	var x1 := float(curve)
	var y1 := float(key.get("c2", 0.0))
	var x2 := float(key.get("c3", 1.0))
	var y2 := float(key.get("c4", 1.0))
	var low := 0.0
	var high := 1.0
	var s := t
	for i in 14:
		s = (low + high) / 2.0
		var q := 1.0 - s
		if 3.0 * q * q * s * x1 + 3.0 * q * s * s * x2 + s * s * s < t:
			low = s
		else:
			high = s
	var u := 1.0 - s
	return 3.0 * u * u * s * y1 + 3.0 * u * s * s * y2 + s * s * s


static func _hex(value: Variant) -> Color:
	var text: String = value if value is String else "ffffffff"
	var channels := [1.0, 1.0, 1.0, 1.0]
	for i in 4:
		if text.length() >= (i + 1) * 2:
			channels[i] = text.substr(i * 2, 2).hex_to_int() / 255.0
	return Color(channels[0], channels[1], channels[2], channels[3])


static func _color_at(frames: Array, t: float, field: String) -> Color:
	if frames.is_empty():
		return Color.WHITE
	var first: Dictionary = frames[0]
	var first_time := float(first.get("time", 0.0))
	if t < first_time - 0.00001:
		return Color.WHITE
	if t <= first_time:
		return _hex(first.get(field))
	var last: Dictionary = frames[frames.size() - 1]
	if t >= float(last.get("time", 0.0)):
		return _hex(last.get(field))
	var i := 0
	while i < frames.size() - 2 and float(frames[i + 1].get("time", 0.0)) <= t:
		i += 1
	var a: Dictionary = frames[i]
	var b: Dictionary = frames[i + 1]
	var span = max(0.0001, float(b.get("time", 0.0)) - float(a.get("time", 0.0)))
	var progress := _curve(a, (t - float(a.get("time", 0.0))) / span)
	var from := _hex(a.get(field))
	var to := _hex(b.get(field))
	return Color(from.r + (to.r - from.r) * progress, from.g + (to.g - from.g) * progress,
		from.b + (to.b - from.b) * progress, from.a + (to.a - from.a) * progress)
