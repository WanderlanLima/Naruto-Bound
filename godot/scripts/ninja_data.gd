extends RefCounted
## Ninja data exported from the web game (assets/ninjas/<folder>/ninja.json).

const ROOT := "res://assets/ninjas/"

var data: Dictionary
var folder: String
var id: String
var display_name: String
var combat: Dictionary
var facing_sign: float = 1.0
var char_scale: float = 1.0
var body_height: float = 82.0
var body_width: float = 40.0
var textures: Dictionary = {}
var _spine_lookup: Dictionary = {}


static func load_index() -> Array:
	return _read_json(ROOT + "index.json")


static func _read_json(path: String) -> Variant:
	var text = FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("Arquivo ausente: " + path)
		return null
	return JSON.parse_string(text)


func open(ninja_folder: String) -> void:
	folder = ninja_folder
	data = _read_json(ROOT + folder + "/ninja.json")
	id = data["id"]
	display_name = data["name"]
	combat = data["combat"]
	facing_sign = -1.0 if data["facing"] == "left" else 1.0
	char_scale = data["charWorldScale"]
	body_height = data["bodyHeight"]
	body_width = data["bodyWidth"]
	for key in data["spine"]:
		_spine_lookup[String(key).to_lower()] = data["spine"][key]


## Every texture this ninja can ever draw (loaded before the match, never during it).
func texture_paths() -> Array:
	var found: Dictionary = {}
	for group in ["animations", "sheetEffects", "spine"]:
		for key in data[group]:
			for page in data[group][key]["pages"]:
				found[ROOT + page] = true
	return found.keys()


func texture(page: String) -> Texture2D:
	var path = ROOT + page
	if not textures.has(path):
		textures[path] = load(path)
	return textures[path]


func animation(slug: String) -> Dictionary:
	var all: Dictionary = data["animations"]
	if all.has(slug):
		return all[slug]
	return all[data["roles"].get("idle", all.keys()[0])]


## Same role resolution as the web version (resolveRoleAnimationSlug).
func role_slug(role: String, preferred: String = "") -> String:
	var all: Dictionary = data["animations"]
	if preferred != "" and all.has(preferred):
		return preferred
	var roles: Dictionary = data["roles"]
	if role == "skill":
		for s in roles.get("skills", []):
			if all.has(s) and not ("chase" in s.to_lower() or "unique" in s.to_lower()):
				return s
	var chains := {
		"idle": ["idle"], "move": ["move", "idle"], "fly": ["fly", "jump", "hurt", "idle"],
		"fall": ["fall", "hurt", "idle"], "attack": ["attack", "idle"], "skill": ["attack", "idle"],
		"ultimate": ["ultimate", "attack", "idle"], "chase": ["chase", "attack", "idle"],
		"hurt": ["hurt", "fall", "idle"], "die": ["die", "fall", "idle"], "win": ["win", "idle"]
	}
	for key in chains.get(role, ["idle"]):
		var slug = roles.get(key, "")
		if slug is String and all.has(slug):
			return slug
	return all.keys()[0]


func action_events(role: String) -> Variant:
	return data["actionEvents"].get(role)


func sheet_effect(spine_id: String, anim_name: String) -> Variant:
	var wanted = (spine_id + "/" + anim_name).to_lower()
	for key in data["sheetEffects"]:
		if String(key).to_lower() == wanted:
			return data["sheetEffects"][key]
	return null


func spine(spine_id: String) -> Variant:
	return _spine_lookup.get(spine_id.to_lower())


func sound_path(sound_name: String) -> String:
	var stem = sound_name.to_lower()
	for ext in [".mp3", ".ogg", ".wav"]:
		stem = stem.trim_suffix(ext)
	if data["sounds"].has(stem):
		return ROOT + data["sounds"][stem]
	return ""


func video_path(key: String) -> String:
	var videos: Dictionary = data["videos"]
	if videos.has(key.to_lower()):
		return ROOT + videos[key.to_lower()]
	if videos.size() > 0:
		return ROOT + videos.values()[0]
	return ""


static func frame_index(anim: Dictionary, elapsed_ms: float, looping: bool) -> int:
	var count = anim["frames"].size()
	if count <= 1:
		return 0
	var duration = max(1.0, float(anim["durationMs"]))
	var t = max(0.0, elapsed_ms)
	var progress = fmod(t, duration) / duration if looping else min(0.99999, t / duration)
	return int(min(count - 1, floor(progress * count)))


## Draws one spritesheet frame on a CanvasItem, anchored at the ninja's feet.
func draw_frame(canvas: CanvasItem, anim: Dictionary, elapsed_ms: float, looping: bool,
		feet: Vector2, direction: float, tint: Color) -> void:
	if anim["frames"].is_empty():
		return
	var frame: Dictionary = anim["frames"][frame_index(anim, elapsed_ms, looping)]
	var tex = texture(anim["pages"][int(frame["pageIndex"])])
	if tex == null:
		return
	var anchor: Dictionary = anim["anchor"]
	var unit = char_scale / max(0.05, float(anchor.get("worldToPixelScale", 1.0)))
	var sss: Dictionary = frame["spriteSourceSize"]
	var ratio := 1.0
	var authored = float(anim.get("sheetWidth", 0))
	if authored > 0.0 and absf(tex.get_width() - authored) > authored * 0.01:
		ratio = tex.get_width() / authored
	var source = Rect2(frame["x"] * ratio, frame["y"] * ratio, frame["w"] * ratio, frame["h"] * ratio)
	var target = Rect2(sss["x"] - anchor["pivotPxX"], sss["y"] - anchor["pivotPxY"], sss["w"], sss["h"])
	canvas.draw_set_transform(feet, 0.0, Vector2(direction * facing_sign * unit, unit))
	canvas.draw_texture_rect_region(tex, target, source, tint)
	canvas.draw_set_transform(Vector2.ZERO)
