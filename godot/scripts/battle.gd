extends Node2D
## Turn-based artillery battle with team chase chains (port of battleEngine.ts).

signal exit_requested
signal rematch_requested

const Fighter := preload("res://scripts/fighter.gd")
const Terrain := preload("res://scripts/terrain.gd")
const Painter := preload("res://scripts/painter.gd")
const SpineEffect := preload("res://scripts/spine_effect.gd")
const Hud := preload("res://scripts/hud.gd")
const Audio := preload("res://scripts/audio.gd")

const WORLD_W := 1800.0
const WORLD_H := 760.0
const GRAVITY := 720.0
const FIGHTER_GRAVITY := 940.0
const TURN_TIME := 30.0
const MOVE_BUDGET := 190.0
const MAX_TEAM_CHAIN := 9
const SPAWN_MARGIN := 110.0
const NATURE_COLORS := {"wind": Color("34d399"), "thunder": Color("a78bfa"), "water": Color("38bdf8"), "fire": Color("fb923c"), "earth": Color("d6a15c")}
const STATE_LABELS := {"popup": "Flutuação baixa", "launcher": "Flutuação alta", "back": "Empurrão", "fall": "Queda"}
const LAUNCH_VY := {"popup": -380.0, "launcher": -630.0, "back": -180.0, "fall": 0.0}
const EMPTY_EVENTS := {"hits": [], "particles": [], "sounds": [], "videos": []}

var mode := "ia"  # "ia", "local" or "auto" (AI on both sides, used by the tests)
var team_size := 1
var fighters: Array = []
var phase := "aim"
var turn_index := 0
var active_team := 0
var turn_cursor := [-1, -1]
var round_number := 0
var winner_team := -1
var wind := 0.0
var timer_sec := TURN_TIME
var after_timer := 0.0
var now_ms := 0.0
var move_dir := 0.0
var aim: Variant = null
var ai_plan: Variant = null
var projectile: Variant = null
var dash: Variant = null
var cut_in: Variant = null
var effects: Array = []
var sparks: Array = []
var numbers: Array = []
var callouts: Array = []
var banner_text := ""
var banner_timer := 0.0
var hits := 0
var hits_timer := 0.0
var shake := 0.0

var cam_pos := Vector2.ZERO
var cam_zoom := 1.0
var cam_free := false
var cam_sky := 0.0
var cam_zoom_before_jump := -1.0

var terrain: Node2D
var camera: Camera2D
var fx_back: Node2D
var fx_front: Node2D
var fighter_layer: Node2D
var overlay: Node2D
var hud: CanvasLayer
var audio: Node

var _gesture := ""
var _touches: Dictionary = {}
var _pinch_distance := 0.0
var _pinch_zoom := 1.0
var _stars: Array = []


func setup(teams: Array, game_mode: String) -> void:
	mode = game_mode
	team_size = teams[0].size()
	_build_nodes()
	terrain.generate()
	for team in 2:
		for ninja in teams[team]:
			audio.preload_ninja(ninja)
	var spawn := _spawn_positions(team_size * 2)
	for team in 2:
		for ninja in teams[team]:
			var f = Fighter.new()
			f.index = fighters.size()
			f.team = team
			f.ninja = ninja
			f.x = spawn[f.index]
			f.y = terrain.ground_y(f.x)
			f.dir = 1.0 if team == 0 else -1.0
			f.max_hp = int(ninja.combat["maxHp"])
			f.hp = f.max_hp
			f.anim_slug = ninja.role_slug("idle")
			fighters.append(f)
	for f in fighters:
		var foe = _nearest_enemy(f)
		if foe != null:
			f.dir = 1.0 if foe.x >= f.x else -1.0
	cam_zoom = _default_zoom()
	cam_pos = fighters[0].pos() + Vector2(80, -95)
	hud.setup(self)
	_start_turn(true)
	_apply_camera()


func _build_nodes() -> void:
	var sky_layer := CanvasLayer.new()
	sky_layer.layer = -10
	add_child(sky_layer)
	var sky := Painter.new()
	sky.paint = _paint_sky
	sky_layer.add_child(sky)
	for i in 65:
		_stars.append([randf(), randf() * 0.58, 0.7 + randf() * 1.5, 0.25 + randf() * 0.6])
	terrain = Terrain.new()
	add_child(terrain)
	fx_back = Node2D.new()
	add_child(fx_back)
	fighter_layer = Painter.new()
	fighter_layer.paint = _paint_fighters
	add_child(fighter_layer)
	fx_front = Node2D.new()
	add_child(fx_front)
	overlay = Painter.new()
	overlay.paint = _paint_overlay
	add_child(overlay)
	camera = Camera2D.new()
	add_child(camera)
	camera.make_current()
	audio = Audio.new()
	add_child(audio)
	hud = Hud.new()
	add_child(hud)


func _spawn_positions(count: int) -> Array:
	if count <= 2:
		return [320.0, WORLD_W - 320.0]
	var lane := (WORLD_W - SPAWN_MARGIN * 2.0) / count
	var xs: Array = []
	for i in count:
		xs.append(round(SPAWN_MARGIN + lane * (i + 0.5) + (randf() - 0.5) * lane * 0.5))
	xs.shuffle()
	return xs


# ---------- Team helpers ----------

func _members(team: int) -> Array:
	return fighters.filter(func(f): return f.team == team)


func _enemies_of(f: RefCounted) -> Array:
	return fighters.filter(func(o): return o.team != f.team and o.hp > 0)


func _nearest_enemy(f: RefCounted) -> Variant:
	var best = null
	for o in _enemies_of(f):
		if best == null or absf(o.x - f.x) < absf(best.x - f.x):
			best = o
	return best


func _team_alive(team: int) -> bool:
	return _members(team).any(func(f): return f.hp > 0)


func is_ai_turn() -> bool:
	return mode == "auto" or (mode == "ia" and active_team == 1)


func active_fighter() -> RefCounted:
	return fighters[turn_index]


func _off_map(f: RefCounted) -> bool:
	return f.y > WORLD_H + 70.0


# ---------- Animation timeline ----------

func play_role(f: RefCounted, role: String, looping := false, lock := -1.0, preferred := "",
		fallback_events := "", silent := false, strike: Variant = null) -> Dictionary:
	var slug: String = f.ninja.role_slug(role, preferred)
	var anim: Dictionary = f.ninja.animation(slug)
	f.anim_slug = slug
	f.anim_start_ms = now_ms
	f.anim_loop = looping
	f.lock_sec = lock if lock >= 0.0 else (0.0 if looping else float(anim["durationMs"]) / 1000.0)

	var own: Dictionary = anim["eventsMs"]
	var events: Dictionary = own
	var has_own: bool = own["hits"].size() + own["particles"].size() + own["sounds"].size() + own["videos"].size() > 0
	if silent:
		events = EMPTY_EVENTS
	elif not has_own:
		var fallback = f.ninja.action_events(fallback_events) if fallback_events != "" else null
		events = fallback if fallback != null else EMPTY_EVENTS

	if strike != null:
		var times: Array = []
		if anim.has("impactMs") and anim["impactMs"] != null:
			times = anim["impactMs"].duplicate()
		else:
			for h in events["hits"]:
				times.append(h["timeMs"])
		if times.is_empty():
			var latest := 0.0
			for p in events["particles"]:
				latest = max(latest, float(p["timeMs"]))
			if latest >= 80.0:
				for p in events["particles"]:
					times.append(max(80.0, float(p["timeMs"])))
			else:
				times = [clamp(float(anim["durationMs"]) * 0.42, 150.0, 620.0)]
		times.sort()
		var grouped: Array = []
		for ms in times:
			if grouped.is_empty() or ms - grouped.back() > 40:
				grouped.append(ms)
		strike["times"] = grouped
		strike["fired"] = {}
		strike["done"] = false

	f.timeline = {"events": events, "fired": {}, "strike": strike}
	_tick_timeline(f)
	return anim


func _tick_timeline(f: RefCounted) -> void:
	if f.timeline == null:
		return
	var timeline: Dictionary = f.timeline
	var elapsed: float = max(0.0, now_ms - f.anim_start_ms)
	var strike = timeline["strike"]
	for kind in ["particles", "hits", "sounds"]:
		var list: Array = timeline["events"][kind]
		for i in list.size():
			var key = kind + str(i)
			if timeline["fired"].has(key) or elapsed < float(list[i]["timeMs"]):
				continue
			timeline["fired"][key] = true
			if kind == "sounds":
				audio.play(f.ninja.sound_path(list[i]["soundName"]))
				continue
			var anchor = f
			if kind == "hits":
				anchor = fighters[strike["target"]] if strike != null else _nearest_enemy(f)
				if anchor == null:
					anchor = f
			_spawn_effect(f, list[i], anchor, kind == "particles")
	if strike != null and f.timeline == timeline:
		var total: int = strike["times"].size()
		for beat in total:
			if strike["fired"].has(beat) or elapsed < float(strike["times"][beat]):
				continue
			strike["fired"][beat] = true
			_deliver_hit(f, fighters[strike["target"]], strike, total, beat == total - 1)


func _spawn_effect(source: RefCounted, event: Dictionary, anchor: RefCounted, follows_attacker: bool) -> void:
	var layer: String = event.get("layer", "front") if event.get("layer") != null else "front"
	var parent: Node2D = fx_back if layer == "behind" else fx_front
	var entry := {"start": now_ms, "anchor": anchor.index, "follows_attacker": follows_attacker,
		"dir": source.dir, "source": source.ninja}
	var sheet = source.ninja.sheet_effect(event["spineId"], event["effectAnim"])
	if sheet != null:
		var node := Painter.new()
		node.paint = func(canvas: CanvasItem):
			source.ninja.draw_frame(canvas, sheet, now_ms - entry["start"], false, fighters[entry["anchor"]].pos(), entry["dir"], Color.WHITE)
		parent.add_child(node)
		entry["node"] = node
		entry["duration"] = max(120.0, float(sheet["durationMs"]))
		entry["sheet"] = true
	else:
		var pack = source.ninja.spine(event["spineId"])
		if pack == null or not pack["anims"].has(event["effectAnim"]):
			return
		var node := SpineEffect.new()
		parent.add_child(node)
		node.setup(source.ninja, pack, event["effectAnim"], source.dir)
		entry["node"] = node
		entry["duration"] = node.duration_ms()
		entry["sheet"] = false
	effects.append(entry)


func _effect_duration(f: RefCounted, event: Dictionary) -> float:
	var sheet = f.ninja.sheet_effect(event["spineId"], event["effectAnim"])
	if sheet != null:
		return max(200.0, float(sheet["durationMs"]))
	var pack = f.ninja.spine(event["spineId"])
	if pack == null or not pack["dur"].has(event["effectAnim"]):
		return 520.0
	return max(200.0, float(pack["dur"][event["effectAnim"]]) * 1000.0)


## The whole ninja animation always plays; only trailing effects are capped.
func _strike_seconds(f: RefCounted, anim: Dictionary) -> float:
	var longest: float = max(450.0, float(anim["durationMs"]))
	var events: Dictionary = f.timeline["events"]
	for p in events["particles"]:
		longest = max(longest, float(p["timeMs"]) + min(1200.0, _effect_duration(f, p)))
	for h in events["hits"]:
		longest = max(longest, float(h["timeMs"]) + min(900.0, _effect_duration(f, h)))
	if f.timeline["strike"] != null:
		for ms in f.timeline["strike"]["times"]:
			longest = max(longest, float(ms) + 220.0)
	var cap: float = max(2.6, float(anim["durationMs"]) / 1000.0)
	return clamp(longest / 1000.0, 0.5, cap)


# ---------- Damage ----------

func _deliver_hit(attacker: RefCounted, target: RefCounted, strike: Dictionary, total: int, is_final: bool) -> void:
	var damage: int = int(strike["damage"] / total)
	if is_final:
		damage += int(strike["damage"]) - damage * total
	var absorbed: int = min(int(target.statuses["shield"]), damage)
	target.statuses["shield"] -= absorbed
	damage -= absorbed
	target.hp = max(0, target.hp - damage)
	target.hit_flash = 0.16
	var middle: Vector2 = target.pos() + Vector2(randf_range(-9, 9), -target.ninja.body_height * 0.55)
	_number(target.pos() + Vector2(0, -target.ninja.body_height - 6), str(damage), Color("fbbf24"))
	hits += max(3, int(round(18.0 / total))) if strike["kind"] == "ultimate" else 1
	hits_timer = 2.6
	var color: Color = NATURE_COLORS.get(attacker.ninja.combat["nature"], Color.ORANGE)
	_burst(middle, color, 22 if strike["kind"] == "ultimate" and is_final else 10)
	shake = max(shake, 0.5 if strike["kind"] == "ultimate" and is_final else 0.24)

	if not is_final:
		if not target.air and target.hp > 0:
			play_role(target, "hurt", false, 0.34, "", "hurt")
		return

	strike["done"] = true
	var radius: float = {"ultimate": 82.0, "skill": 62.0, "chase": 32.0}.get(strike["kind"], 48.0)
	terrain.carve(target.pos(), radius)
	_apply_state(target, strike["causes"], attacker)
	var applied: Array = []
	for effect in strike["statuses"]:
		if randf() > float(effect["chance"]):
			continue
		var kind: String = effect["kind"]
		if kind == "heal":
			attacker.hp = min(attacker.max_hp, attacker.hp + int(effect["potency"]))
		elif kind == "shield":
			attacker.statuses["shield"] += int(effect["potency"])
		else:
			target.statuses[kind] = max(int(target.statuses[kind]), int(effect["turns"]))
		applied.append(effect["label"])
	if strike["kind"] == "chase":
		banner_text = "%s · %s  x%d" % [attacker.ninja.display_name, strike["label"], strike["combo"]]
		banner_timer = 2.6
	var prefix: String = {"ultimate": "ÔGI · ", "chase": "PERSEGUIÇÃO · ", "skill": "JUTSU · "}.get(strike["kind"], "")
	var suffix := "" if applied.is_empty() else " · " + " · ".join(PackedStringArray(applied))
	_callout(prefix + STATE_LABELS[strike["causes"]] + suffix, target.pos() + Vector2(0, -target.ninja.body_height * 0.85), Color("7dd3fc"))


func _apply_state(target: RefCounted, state: String, attacker: RefCounted) -> void:
	target.chase_state = state
	var push := 1.0 if attacker.x < target.x else -1.0
	if state == "fall":
		play_role(target, "fall", false, 1.0, "", "hurt")
	elif state == "back":
		target.vx = push * 310.0
		target.vy = LAUNCH_VY["back"]
		target.air = true
		play_role(target, "hurt", false, 0.65, "", "hurt")
	else:
		target.vy = LAUNCH_VY[state]
		target.vx = push * 64.0
		target.air = true
		play_role(target, "fly", true, 0.0, "", "hurt")


func _number(at: Vector2, value: String, color: Color) -> void:
	numbers.append({"pos": at, "value": value, "life": 1.3, "color": color})


func _callout(text: String, at: Vector2, color: Color) -> void:
	callouts.append({"pos": at, "text": text, "life": 1.5, "color": color})


func _burst(at: Vector2, color: Color, count: int) -> void:
	for i in count:
		var velocity := Vector2.from_angle(randf() * TAU) * randf_range(200.0, 480.0)
		sparks.append({"pos": at, "vel": velocity, "life": randf_range(0.2, 0.45), "color": color})


# ---------- Turns and AI ----------

func _advance_turn(first: bool) -> void:
	if not first:
		active_team = 1 - active_team
	var members := _members(active_team)
	for step_index in range(1, members.size() + 1):
		var slot: int = (turn_cursor[active_team] + step_index) % members.size()
		if members[slot].hp > 0:
			turn_cursor[active_team] = slot
			turn_index = members[slot].index
			return


func _start_turn(first := false) -> void:
	_advance_turn(first)
	round_number += 1
	if round_number > (90 if team_size > 1 else 50):
		_end_match()
		return
	wind = snappedf(randf_range(-8.0, 8.0), 0.1)
	timer_sec = TURN_TIME
	cam_free = false
	aim = null
	ai_plan = null
	move_dir = 0.0
	var f := active_fighter()
	f.move_used = 0.0
	f.armed = "attack"
	for status in [["burn", 5, "Chamas"], ["poison", 4, "Veneno"]]:
		if f.statuses[status[0]] > 0 and f.hp > 0:
			f.statuses[status[0]] -= 1
			f.hp = max(0, f.hp - status[1])
			_callout("%s -%d" % [status[2], status[1]], f.pos() + Vector2(0, -f.ninja.body_height), Color("fb923c"))
	if f.statuses["slow"] > 0:
		f.statuses["slow"] -= 1
	if f.statuses["seal"] > 0:
		f.statuses["seal"] -= 1
	if f.hp <= 0:
		phase = "after"
		after_timer = 1.0
		return
	if f.statuses["paralysis"] > 0:
		f.statuses["paralysis"] -= 1
		_callout("Paralisado!", f.pos() + Vector2(0, -f.ninja.body_height), Color("fde047"))
		phase = "after"
		after_timer = 1.1
		return
	if f.statuses["seal"] == 0:
		f.chakra = min(100, f.chakra + 20)
	var foe = _nearest_enemy(f)
	if foe != null:
		f.dir = 1.0 if foe.x >= f.x else -1.0
	if is_ai_turn():
		_plan_ai_shot()
	else:
		phase = "aim"


func select_action(choice: String) -> void:
	var f := active_fighter()
	if phase != "aim" or is_ai_turn():
		return
	if choice == "ultimate" and (f.chakra < 100 or f.statuses["seal"] > 0):
		return
	if choice == "skill" and (f.chakra < int(f.ninja.combat["skill"]["chakraCost"]) or f.statuses["seal"] > 0):
		return
	f.armed = "attack" if f.armed == choice else choice


func launch_origin(f: RefCounted) -> Vector2:
	return f.pos() + Vector2(f.dir * 20.0, -f.ninja.body_height * 0.62)


func _plan_ai_shot() -> void:
	phase = "ai"
	var ai := active_fighter()
	var combat: Dictionary = ai.ninja.combat
	if ai.chakra >= 100 and ai.statuses["seal"] == 0:
		ai.armed = "ultimate"
	elif combat["hasDistinctSkill"] and ai.chakra >= int(combat["skill"]["chakraCost"]) and ai.statuses["seal"] == 0 and randf() < 0.45:
		ai.armed = "skill"
	var origin := launch_origin(ai)
	var best := {"angle": -PI * 0.72, "power": 0.7, "score": -1.0e20}
	for target in _enemies_of(ai):
		var shot := _solve_shot(origin, target)
		var score: float = (10.0 if shot["distance"] < max(26.0, target.ninja.body_width * 0.5) else -shot["distance"] / 100.0)
		score += (1.0 - float(target.hp) / target.max_hp) * 2.0 + (0.15 if not target.air else 0.0) + randf() * 0.5
		if score > best["score"]:
			best = {"angle": shot["angle"], "power": shot["power"], "score": score}
	var jitter := randf_range(-0.045, 0.045)
	ai_plan = {"angle": best["angle"] + jitter, "power": clamp(best["power"] * (1.0 + jitter * 0.65), 0.2, 1.0), "delay": 1.35}


func _solve_shot(origin: Vector2, target: RefCounted) -> Dictionary:
	var goal: Vector2 = target.pos() + Vector2(0, -target.ninja.body_height * 0.5)
	var best := {"angle": -PI * 0.72, "power": 0.7, "distance": 1.0e9}
	for attempt in 90:
		var angle := -randf_range(0.18, 1.38)
		if goal.x <= origin.x:
			angle = -PI + randf_range(0.18, 1.38)
		var power := randf_range(0.28, 1.0)
		var at := origin
		var velocity := Vector2.from_angle(angle) * (260.0 + 760.0 * power)
		var closest := 1.0e9
		for i in 240:
			velocity += Vector2(wind * 14.0, GRAVITY) / 50.0
			at += velocity / 50.0
			closest = min(closest, at.distance_to(goal))
			if terrain.is_solid(at.x, at.y) or at.y > WORLD_H + 180.0:
				break
		if closest < best["distance"]:
			best = {"angle": angle, "power": power, "distance": closest}
	return best


func fire_shot() -> void:
	if aim == null:
		return
	var f := active_fighter()
	f.dir = 1.0 if cos(aim["angle"]) >= 0.0 else -1.0
	play_role(f, "attack", false, 0.28, "", "", true)
	projectile = {"pos": launch_origin(f), "choice": f.armed, "trail": [],
		"vel": Vector2.from_angle(aim["angle"]) * (260.0 + 760.0 * aim["power"])}
	phase = "fly"
	aim = null
	cam_free = false


func _impact(at: Vector2, struck: Variant) -> void:
	var attacker := active_fighter()
	var choice: String = projectile["choice"]
	projectile = null
	var color: Color = NATURE_COLORS.get(attacker.ninja.combat["nature"], Color.ORANGE)
	phase = "after"
	if struck == null:
		terrain.carve(at, 34.0)
		_burst(at, color, 14)
		shake = max(shake, 0.14)
		for f in fighters:
			if f.hp <= 0 or (team_size > 1 and f.team == attacker.team and f != attacker):
				continue
			if at.distance_to(f.pos() + Vector2(0, -f.ninja.body_height * 0.5)) < 68.0:
				var splash := int(round(attacker.ninja.combat["baseDmg"] * 0.38))
				f.hp = max(0, f.hp - splash)
				f.hit_flash = 0.15
				_number(f.pos() + Vector2(0, -f.ninja.body_height - 8), str(splash), Color("fca5a5"))
				play_role(f, "hurt", false, 0.45, "", "hurt")
		if attacker.statuses["seal"] == 0:
			attacker.chakra = min(100, attacker.chakra + 12)
		_callout("Errou...", at + Vector2(0, -16), Color("cbd5e1"))
		after_timer = 1.2
		return
	if choice == "ultimate" and attacker.chakra < 100:
		choice = "attack"
	if choice == "skill" and attacker.chakra < int(attacker.ninja.combat["skill"]["chakraCost"]):
		choice = "attack"
	struck.hit_flash = 0.16
	struck.vx = 0.0
	_burst(at, color, 10)
	_callout("ÔGI ATIVADO!" if choice == "ultimate" else "ACERTOU!", at + Vector2(0, -20), Color("fde047"))
	after_timer = 1.3
	var sequence := {
		"attacker": attacker.index, "target": struck.index, "homes": {attacker.index: attacker.x},
		"returns": [], "choice": choice, "step": "approach", "t": 0.0, "x0": attacker.x,
		"x1": struck.x + (-62.0 if struck.x > attacker.x else 62.0),
		"dash_time": min(0.55, 0.18 + absf(struck.x - attacker.x) / 3400.0), "wait": 0.0,
		"elapsed": 0.0, "duration": 0.8, "chase_from": attacker.x, "chase_to": struck.x,
		"last_state": "popup", "used": {}, "chaser": null, "combo": 1}
	if choice == "ultimate":
		_start_cut_in(attacker, sequence)
	else:
		dash = sequence


# ---------- Ultimate cut-in video ----------

func _start_cut_in(attacker: RefCounted, sequence: Dictionary) -> void:
	var anim: Dictionary = attacker.ninja.animation(attacker.ninja.role_slug("ultimate", attacker.ninja.combat["ultimate"].get("animSlug", "")))
	var videos: Array = anim["eventsMs"]["videos"]
	var path: String = attacker.ninja.video_path(videos[0]["key"] if not videos.is_empty() else "")
	if mode == "auto" or path == "":
		dash = sequence
		return
	cut_in = {"sequence": sequence}
	hud.play_video(path, "%s — %s" % [attacker.ninja.display_name, attacker.ninja.combat["ultimate"]["name"]])


func finish_cut_in() -> void:
	if cut_in == null:
		return
	dash = cut_in["sequence"]
	cut_in = null
	hud.stop_video()


# ---------- Melee and chase chains ----------

func _begin_strike(sequence: Dictionary, is_chase: bool) -> void:
	var attacker = fighters[sequence["attacker"]]
	var target = fighters[sequence["target"]]
	var combat: Dictionary = attacker.ninja.combat
	attacker.dir = 1.0 if attacker.x <= target.x else -1.0
	var critical: bool = randf() < float(combat["critChance"])
	var bonus := 1.3 if critical else 1.0
	var spec: Dictionary
	var role := "chase"
	var damage: int
	if is_chase:
		spec = sequence["chaser"]
		damage = int(round(combat["baseDmg"] * 0.55 * bonus))
	else:
		role = sequence["choice"]
		spec = combat[role]
		if role == "ultimate":
			attacker.chakra = 0
		elif role == "skill":
			attacker.chakra = max(0, attacker.chakra - int(spec["chakraCost"]))
		elif attacker.statuses["seal"] == 0:
			attacker.chakra = min(100, attacker.chakra + 35)
		attacker.armed = "attack"
		damage = int(round(combat["baseDmg"] * float(spec["damageMultiplier"]) * bonus))
	var strike := {"target": target.index, "kind": role, "damage": damage, "causes": spec["causesState"],
		"statuses": spec["statusEffects"], "label": spec["name"], "combo": sequence["combo"]}
	var preferred: String = spec.get("animSlug", "") if spec.get("animSlug") != null else ""
	var anim := play_role(attacker, role, false, -1.0, preferred, role, false, strike)
	sequence["last_state"] = spec["causesState"]
	sequence["elapsed"] = 0.0
	sequence["duration"] = _strike_seconds(attacker, anim)
	attacker.lock_sec = sequence["duration"]


func _available_chasers(sequence: Dictionary) -> Array:
	var result: Array = []
	var limit := MAX_TEAM_CHAIN if team_size > 1 else 3
	if fighters[sequence["target"]].hp <= 0 or sequence["used"].size() >= limit:
		return result
	var turn_owner := active_fighter()
	for f in _members(turn_owner.team):
		if f.hp <= 0:
			continue
		if f != turn_owner and (f.statuses["paralysis"] > 0 or (f.air and not sequence["homes"].has(f.index))):
			continue
		for chaser in f.ninja.combat["chasers"]:
			var key := "%d:%s:%s" % [f.index, chaser["slot"], chaser["name"]]
			if not sequence["used"].has(key):
				result.append({"fighter": f, "chaser": chaser, "key": key})
	return result


func _matching_chaser(sequence: Dictionary) -> Variant:
	var target = fighters[sequence["target"]]
	for option in _available_chasers(sequence):
		var needed: Array = option["chaser"]["requiresStates"]
		if needed.has(target.chase_state) or (sequence["last_state"] != "fall" and needed.has(sequence["last_state"])):
			return option
	return null


func _queue_return(sequence: Dictionary, f: RefCounted) -> void:
	var home: float = sequence["homes"].get(f.index, f.x)
	f.silhouette = false
	f.lock_sec = 0.0
	sequence["returns"].append({"index": f.index, "from": f.x, "to": home, "t": 0.0,
		"duration": min(0.55, 0.18 + absf(f.x - home) / 3400.0)})


func _ensure_move(f: RefCounted) -> void:
	if f.anim_slug != f.ninja.role_slug("move"):
		play_role(f, "move", true, 0.0)


func _update_returns(sequence: Dictionary, dt: float) -> void:
	var remaining: Array = []
	for trip in sequence["returns"]:
		var f = fighters[trip["index"]]
		trip["t"] += dt
		var k: float = min(1.0, trip["t"] / max(0.05, trip["duration"]))
		f.x = lerpf(trip["from"], trip["to"], k)
		f.y = terrain.ground_y(f.x)
		f.dir = 1.0 if trip["to"] >= trip["from"] else -1.0
		if f.hp > 0:
			_ensure_move(f)
		if k < 1.0:
			remaining.append(trip)
			continue
		f.air = false
		f.vy = 0.0
		f.lock_sec = 0.0
		f.dir = 1.0 if fighters[sequence["target"]].x >= f.x else -1.0
		if f.hp > 0:
			play_role(f, "idle", true, 0.0)
	sequence["returns"] = remaining


func _update_dash(dt: float) -> void:
	var sequence: Dictionary = dash
	_update_returns(sequence, dt)
	var attacker = fighters[sequence["attacker"]]
	var target = fighters[sequence["target"]]
	sequence["t"] += dt
	var step_name: String = sequence["step"]
	attacker.silhouette = step_name == "chase_dash" or (step_name == "chase_strike" and sequence["elapsed"] < 0.35)

	if step_name == "approach" or step_name == "chase_dash":
		var chasing := step_name == "chase_dash"
		var from: float = sequence["chase_from"] if chasing else sequence["x0"]
		var to: float = sequence["chase_to"] if chasing else sequence["x1"]
		var length: float = 0.16 if chasing else max(0.05, sequence["dash_time"])
		attacker.x = lerpf(from, to, clamp(sequence["t"] / length, 0.0, 1.0))
		attacker.y = terrain.ground_y(attacker.x)
		attacker.dir = 1.0 if to >= from else -1.0
		_ensure_move(attacker)
		if sequence["t"] >= length:
			attacker.air = false
			attacker.vy = 0.0
			sequence["step"] = "chase_strike" if chasing else "strike"
			sequence["t"] = 0.0
			_begin_strike(sequence, chasing)
	elif step_name == "strike" or step_name == "chase_strike":
		sequence["elapsed"] += dt
		if sequence["elapsed"] >= sequence["duration"]:
			if attacker.timeline != null and attacker.timeline["strike"] != null and not attacker.timeline["strike"]["done"]:
				_deliver_hit(attacker, target, attacker.timeline["strike"], 1, true)
			sequence["step"] = "wait"
			sequence["t"] = 0.0
			sequence["wait"] = 0.0
	elif step_name == "wait":
		sequence["wait"] += dt
		var option = _matching_chaser(sequence)
		var waiting_fall: bool = option == null and target.hp > 0 and target.air and _available_chasers(sequence).any(
			func(c): return c["chaser"]["requiresStates"].has("fall"))
		if option != null:
			var ally = option["fighter"]
			if ally.index != attacker.index:
				_queue_return(sequence, attacker)
				var was_returning: bool = sequence["returns"].any(func(r): return r["index"] == ally.index)
				sequence["returns"] = sequence["returns"].filter(func(r): return r["index"] != ally.index)
				if not was_returning and not sequence["homes"].has(ally.index):
					sequence["homes"][ally.index] = ally.x
				sequence["attacker"] = ally.index
			sequence["used"][option["key"]] = true
			sequence["chaser"] = option["chaser"]
			sequence["combo"] += 1
			sequence["step"] = "chase_dash"
			sequence["t"] = 0.0
			sequence["chase_from"] = ally.x
			sequence["chase_to"] = clamp(target.x + (-60.0 if target.x >= ally.x else 60.0), 30.0, WORLD_W - 30.0)
			_callout("PERSEGUIÇÃO!", target.pos() + Vector2(0, -target.ninja.body_height - 24), Color("7dd3fc"))
		elif not (waiting_fall and sequence["wait"] < 2.6):
			sequence["step"] = "return"
			_queue_return(sequence, attacker)
	elif step_name == "return" and sequence["returns"].is_empty():
		dash = null


func _end_match() -> void:
	phase = "over"
	var alive_a := _team_alive(0)
	var alive_b := _team_alive(1)
	winner_team = 0 if alive_a and not alive_b else (1 if alive_b and not alive_a else -1)
	if winner_team >= 0:
		for f in _members(winner_team):
			if f.hp > 0:
				play_role(f, "win", true, 0.0)
	if hud != null:
		hud.show_result()


# ---------- Simulation ----------

func _process(delta: float) -> void:
	if fighters.is_empty():
		return
	if mode != "auto":
		step(min(0.05, delta))
	_apply_camera()
	queue_redraw_all()
	hud.refresh()


func queue_redraw_all() -> void:
	fighter_layer.queue_redraw()
	overlay.queue_redraw()
	for entry in effects:
		if entry["sheet"]:
			entry["node"].queue_redraw()


func step(dt: float) -> void:
	if cut_in != null or fighters.is_empty():
		return
	now_ms += dt * 1000.0
	var current := active_fighter()
	for f in fighters:
		_update_fighter(f, dt)
	_update_walk(current, dt)

	if phase == "aim":
		timer_sec -= dt
		if timer_sec <= 0.0:
			_start_turn()
	elif phase == "ai" and ai_plan != null:
		aim = {"angle": ai_plan["angle"], "power": ai_plan["power"]}
		ai_plan["delay"] -= dt
		if ai_plan["delay"] <= 0.0:
			fire_shot()

	if phase == "fly" and projectile != null:
		var small := dt / 4.0
		for i in 4:
			if projectile == null:
				break
			projectile["vel"] += Vector2(wind * 14.0, GRAVITY) * small
			projectile["pos"] += projectile["vel"] * small
			projectile["trail"].append(projectile["pos"])
			if projectile["trail"].size() > 30:
				projectile["trail"].pop_front()
			var at: Vector2 = projectile["pos"]
			var struck = null
			for o in _enemies_of(active_fighter()):
				if absf(at.x - o.x) < max(22.0, o.ninja.body_width * 0.45) and at.y > o.y - o.ninja.body_height and at.y < o.y + 4.0:
					struck = o
					break
			if struck != null or terrain.is_solid(at.x, at.y):
				_impact(at, struck)
			elif at.x < -160.0 or at.x > WORLD_W + 160.0 or at.y > WORLD_H + 200.0:
				projectile = null
				phase = "after"
				after_timer = 0.9

	if dash != null:
		_update_dash(dt)

	if (phase == "aim" or phase == "ai") and active_fighter().hp <= 0:
		aim = null
		ai_plan = null
		phase = "after"
		after_timer = 0.9

	if phase == "after":
		after_timer -= dt
		var settled: bool = after_timer <= 0.0 and dash == null and cut_in == null and fighters.all(
			func(f): return (f.hp <= 0 and _off_map(f)) or (not f.air and (f.hp <= 0 or f.lock_sec <= 0.0)))
		if settled:
			if not _team_alive(0) or not _team_alive(1):
				_end_match()
			else:
				_start_turn()

	_update_visuals(dt)
	_update_camera(dt)


func _update_fighter(f: RefCounted, dt: float) -> void:
	f.hit_flash = max(0.0, f.hit_flash - dt)
	_tick_timeline(f)
	if f.hp <= 0 and _off_map(f):
		return
	if terrain.is_solid(f.x, f.y) and f.vy >= 0.0:
		for i in 16:
			if not terrain.is_solid(f.x, f.y):
				break
			f.y -= 1.0
	if f.vy < 0.0 or not terrain.is_solid(f.x, f.y + 1.0):
		f.vy += FIGHTER_GRAVITY * dt
		f.y += f.vy * dt
		f.air = true
		if _off_map(f):
			f.hp = 0
	else:
		if f.air:
			f.air = false
			f.vx = 0.0
			if f.chase_state == "popup" or f.chase_state == "launcher":
				f.chase_state = "fall"
				play_role(f, "fall", false, 0.85)
		f.vy = 0.0
	if absf(f.vx) > 0.5:
		var next_x: float = f.x + f.vx * dt
		if next_x > 28.0 and next_x < WORLD_W - 28.0 and not terrain.is_solid(next_x, f.y - 12.0):
			f.x = next_x
		else:
			f.vx = 0.0
		f.vx *= pow(0.05, dt)
	else:
		f.vx = 0.0
	if f.hp > 0:
		f.lock_sec = max(0.0, f.lock_sec - dt)
	var busy := false
	if dash != null:
		busy = (dash["attacker"] == f.index and dash["step"] != "return") or (dash["target"] == f.index and dash["step"] != "return") or dash["returns"].any(func(r): return r["index"] == f.index)
	if f.hp > 0 and not f.air and f.lock_sec <= 0.0 and not busy and phase != "over":
		if f.anim_slug != f.ninja.role_slug("idle") and f.anim_slug != f.ninja.role_slug("move"):
			play_role(f, "idle", true, 0.0)
			f.chase_state = ""
	if f.hp <= 0 and not f.air and f.anim_slug != f.ninja.role_slug("die"):
		play_role(f, "die", false, 0.0)


func _update_walk(f: RefCounted, dt: float) -> void:
	var slowed: bool = f.statuses["slow"] > 0
	var cap := MOVE_BUDGET * (0.5 if slowed else 1.0)
	var move_slug: String = f.ninja.role_slug("move")
	if phase == "aim" and move_dir != 0.0 and not is_ai_turn() and f.move_used < cap and f.lock_sec <= 0.0 and dash == null:
		var speed := 52.0 if slowed else 84.0
		var next_x: float = f.x + move_dir * speed * dt
		for climb in 15:
			if not terrain.is_solid(next_x, f.y - climb):
				if next_x > 28.0 and next_x < WORLD_W - 28.0:
					f.x = next_x
					f.y -= climb
					f.move_used += speed * dt
				break
		f.dir = move_dir
		if f.anim_slug != move_slug and not f.air:
			play_role(f, "move", true, 0.0)
	elif f.anim_slug == move_slug and dash == null and phase != "over":
		play_role(f, "idle", true, 0.0)


func _update_visuals(dt: float) -> void:
	for s in sparks:
		s["pos"] += s["vel"] * dt
		s["life"] -= dt
	sparks = sparks.filter(func(s): return s["life"] > 0.0)
	for n in numbers:
		n["pos"] += Vector2(0, -36.0 * dt)
		n["life"] -= dt
	numbers = numbers.filter(func(n): return n["life"] > 0.0)
	for c in callouts:
		c["life"] -= dt
	callouts = callouts.filter(func(c): return c["life"] > 0.0)
	var alive: Array = []
	for entry in effects:
		var elapsed: float = now_ms - entry["start"]
		if elapsed >= entry["duration"]:
			entry["node"].queue_free()
			continue
		if not entry["sheet"]:
			var anchor = fighters[entry["anchor"]]
			if entry["follows_attacker"]:
				entry["node"].direction = anchor.dir
			entry["node"].show_at(anchor.pos(), elapsed / 1000.0)
		alive.append(entry)
	effects = alive
	shake = max(0.0, shake - dt * 1.3)
	banner_timer = max(0.0, banner_timer - dt)
	hits_timer = max(0.0, hits_timer - dt)
	if hits_timer <= 0.0:
		hits = 0


# ---------- Camera ----------

func _view_size() -> Vector2:
	return get_viewport_rect().size


func _min_zoom() -> float:
	var view := _view_size()
	return max(view.x / WORLD_W, view.y / WORLD_H)


func _default_zoom() -> float:
	return min(1.12, max(_min_zoom(), _view_size().y / 410.0))


func center_camera() -> void:
	cam_free = false
	cam_zoom = _default_zoom()


func _update_camera(dt: float) -> void:
	var view := _view_size()
	var f := active_fighter()
	var goal: Vector2 = f.pos() + Vector2(0, -95)
	var rate := 4.5
	if phase == "fly" and projectile != null:
		goal = projectile["pos"]
		rate = 9.0
	elif dash != null:
		var a = fighters[dash["attacker"]]
		var b = fighters[dash["target"]]
		goal = Vector2((a.x + b.x) / 2.0, min(a.y, b.y) - 85.0)
		rate = 6.5
	# Animations with high jumps zoom out so the ninja never leaves the screen
	var jumper = null
	for other in fighters:
		if other.hp > 0 and other.anim()["anchor"].get("cameraHeadroomPx") != null:
			jumper = other
			break
	var sky_goal := 0.0
	if jumper != null:
		var anchor: Dictionary = jumper.anim()["anchor"]
		var headroom: float = anchor["cameraHeadroomPx"] * jumper.ninja.char_scale / max(0.05, anchor.get("worldToPixelScale", 1.0))
		var bottom: float = jumper.y + 75.0
		if cam_zoom_before_jump < 0.0:
			cam_zoom_before_jump = cam_zoom
		var fit: float = max(_min_zoom(), min(cam_zoom_before_jump, view.y / (headroom + 75.0)))
		cam_zoom = lerpf(cam_zoom, fit, min(1.0, dt * 7.0))
		goal = Vector2(jumper.x, bottom - view.y / 2.0 / fit)
		sky_goal = max(0.0, -(bottom - view.y / fit))
	elif cam_zoom_before_jump > 0.0:
		cam_zoom = lerpf(cam_zoom, cam_zoom_before_jump, min(1.0, dt * 4.5))
		if absf(cam_zoom - cam_zoom_before_jump) < 0.01:
			cam_zoom = cam_zoom_before_jump
			cam_zoom_before_jump = -1.0
	cam_sky = lerpf(cam_sky, sky_goal, min(1.0, dt * (9.0 if jumper != null else 4.5)))
	if not cam_free or phase == "fly" or dash != null or jumper != null:
		cam_pos = cam_pos.lerp(goal, min(1.0, rate * dt))
	cam_zoom = clamp(cam_zoom, _min_zoom(), 2.2)
	var half := view / 2.0 / cam_zoom
	cam_pos.x = clamp(cam_pos.x, half.x, max(half.x, WORLD_W - half.x))
	cam_pos.y = min(WORLD_H - half.y, max(half.y - cam_sky, cam_pos.y))


func _apply_camera() -> void:
	camera.position = cam_pos
	camera.zoom = Vector2(cam_zoom, cam_zoom)
	camera.offset = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * shake * 14.0


# ---------- Drawing ----------

func _paint_sky(canvas: CanvasItem) -> void:
	var view := _view_size()
	canvas.draw_polygon(PackedVector2Array([Vector2.ZERO, Vector2(view.x, 0), view, Vector2(0, view.y)]),
		PackedColorArray([Color("0b1230"), Color("0b1230"), Color("2b3a66"), Color("2b3a66")]))
	for star in _stars:
		canvas.draw_circle(Vector2(star[0] * view.x, star[1] * view.y), star[2] * 0.7, Color(1, 1, 1, star[3]))
	canvas.draw_circle(Vector2(view.x * 0.78, view.y * 0.18), 22.0, Color("fdf6e3"))


func _paint_fighters(canvas: CanvasItem) -> void:
	for f in fighters:
		if _off_map(f):
			continue
		var tint := Color.WHITE
		if f.silhouette:
			tint = Color(0.35, 0.75, 1.0, 0.75)
		elif f.hit_flash > 0.0:
			tint = Color(1.6, 1.25, 1.25)
		f.ninja.draw_frame(canvas, f.anim(), now_ms - f.anim_start_ms, f.anim_loop, f.pos(), f.dir, tint)


func _paint_overlay(canvas: CanvasItem) -> void:
	var font := ThemeDB.fallback_font
	for f in fighters:
		if f.hp <= 0 or _off_map(f):
			continue
		var top: Vector2 = f.pos() + Vector2(-24, -f.ninja.body_height - 14)
		canvas.draw_rect(Rect2(top, Vector2(48, 5)), Color(0, 0, 0, 0.6))
		canvas.draw_rect(Rect2(top, Vector2(48.0 * f.hp / f.max_hp, 5)), Color("22c55e") if f.team == 0 else Color("ef4444"))
		if f.index == turn_index and phase != "over":
			canvas.draw_colored_polygon(PackedVector2Array([top + Vector2(18, -10), top + Vector2(30, -10), top + Vector2(24, -3)]), Color("fbbf24"))
	if aim != null and (phase == "aim" or phase == "ai"):
		var at := launch_origin(active_fighter())
		var velocity: Vector2 = Vector2.from_angle(aim["angle"]) * (260.0 + 760.0 * aim["power"])
		for i in 36:
			velocity += Vector2(wind * 14.0, GRAVITY) / 60.0
			at += velocity / 60.0
			if i % 3 == 0:
				canvas.draw_circle(at, 2.6, Color(1, 0.9, 0.4, 1.0 - i / 40.0))
	if projectile != null:
		var color: Color = NATURE_COLORS.get(active_fighter().ninja.combat["nature"], Color.ORANGE)
		var trail: Array = projectile["trail"]
		for i in trail.size():
			canvas.draw_circle(trail[i], 1.0 + 4.0 * i / trail.size(), Color(color, 0.5 * i / trail.size()))
		canvas.draw_circle(projectile["pos"], 7.0, color)
		canvas.draw_circle(projectile["pos"], 3.5, Color.WHITE)
	for s in sparks:
		canvas.draw_line(s["pos"], s["pos"] - s["vel"] * 0.025, s["color"], 2.0)
	for n in numbers:
		_text(canvas, font, n["pos"], n["value"], 20, Color(n["color"], min(1.0, n["life"] * 2.0)))
	for c in callouts:
		_text(canvas, font, c["pos"], c["text"], 14, Color(c["color"], min(1.0, c["life"] * 2.0)))


func _text(canvas: CanvasItem, font: Font, at: Vector2, text: String, size: int, color: Color) -> void:
	var left := at - Vector2(200, 0)
	canvas.draw_string_outline(font, left, text, HORIZONTAL_ALIGNMENT_CENTER, 400, size, 4, Color(0, 0, 0, color.a))
	canvas.draw_string(font, left, text, HORIZONTAL_ALIGNMENT_CENTER, 400, size, color)


# ---------- Input ----------

func _unhandled_input(event: InputEvent) -> void:
	if fighters.is_empty() or cut_in != null:
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
		else:
			_touches.erase(event.index)
		if _touches.size() == 2:
			var points := _touches.values()
			_pinch_distance = max(1.0, points[0].distance_to(points[1]))
			_pinch_zoom = cam_zoom
			_gesture = "zoom"
			aim = null
			cam_free = true
	elif event is InputEventScreenDrag and _gesture == "zoom":
		_touches[event.index] = event.position
		if _touches.size() == 2:
			var points := _touches.values()
			cam_zoom = _pinch_zoom * points[0].distance_to(points[1]) / _pinch_distance
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP or event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			cam_free = true
			cam_zoom *= 1.09 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 0.92
		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_pointer_down(event.position)
			else:
				_pointer_up()
	elif event is InputEventMouseMotion and _touches.size() < 2:
		if _gesture == "aim":
			_aim_at(event.position)
		elif _gesture == "pan":
			cam_pos -= event.relative / cam_zoom
	elif event is InputEventKey and not event.echo:
		if event.keycode == KEY_A or event.keycode == KEY_LEFT:
			move_dir = -1.0 if event.pressed else 0.0
		elif event.keycode == KEY_D or event.keycode == KEY_RIGHT:
			move_dir = 1.0 if event.pressed else 0.0


func _to_world(screen: Vector2) -> Vector2:
	return get_viewport().get_canvas_transform().affine_inverse() * screen


func _pointer_down(screen: Vector2) -> void:
	var f := active_fighter()
	if phase == "aim" and not is_ai_turn() and f.lock_sec <= 0.0:
		var chest: Vector2 = get_viewport().get_canvas_transform() * (f.pos() + Vector2(0, -f.ninja.body_height * 0.5))
		if screen.distance_to(chest) < 115.0:
			_gesture = "aim"
			_aim_at(screen)
			return
	_gesture = "pan"
	cam_free = true


func _aim_at(screen: Vector2) -> void:
	if phase != "aim":
		return
	var f := active_fighter()
	var pull := launch_origin(f) - _to_world(screen)
	f.dir = 1.0 if pull.x >= 0.0 else -1.0
	aim = {"angle": pull.angle(), "power": min(1.0, pull.length() / 155.0)}


func _pointer_up() -> void:
	if _gesture == "aim":
		if aim != null and aim["power"] > 0.12 and phase == "aim":
			fire_shot()
		else:
			aim = null
	_gesture = ""
