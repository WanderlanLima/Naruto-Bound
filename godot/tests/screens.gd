extends SceneTree
## Renders real frames of each ninja's Ougi (with chase) so they can be inspected.

const NinjaData := preload("res://scripts/ninja_data.gd")
const Battle := preload("res://scripts/battle.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	DirAccess.make_dir_recursive_absolute("res://shots")
	var roster: Array = []
	var problems: Array[String] = []
	for entry in NinjaData.load_index():
		var ninja = NinjaData.new()
		ninja.open(entry["folder"])
		roster.append(ninja)
	for who in 2:
		seed(7)
		var battle = Battle.new()
		root.add_child(battle)
		battle.setup([[roster[who]], [roster[1 - who]]], "auto")
		battle.set_process(false)
		var attacker = battle.fighters[0]
		var target = battle.fighters[1]
		target.x = attacker.x + 90.0
		target.y = battle.terrain.ground_y(target.x)
		attacker.chakra = 100
		battle.projectile = {"pos": target.pos(), "vel": Vector2.ZERO, "choice": "ultimate", "trail": []}
		battle.phase = "fly"
		battle._impact(target.pos() + Vector2(0, -30), target)
		var frame := 0
		var shot := 0
		var effect_peak := 0
		var shots_with_effect_pixels := 0
		while frame < 600 and (battle.dash != null):
			battle.step(1.0 / 30.0)
			frame += 1
			if frame % 18 == 0:
				battle.shake = 0.0
				var full := await _grab(battle)
				full.save_png("res://shots/ninja%d_%02d.png" % [who, shot])
				battle.fx_back.visible = false
				battle.fx_front.visible = false
				var without_effects := await _grab(battle)
				battle.fighter_layer.visible = false
				var background := await _grab(battle)
				battle.fx_back.visible = true
				battle.fx_front.visible = true
				battle.fighter_layer.visible = true
				var effect_pixels := _difference(full, without_effects)
				var fighter_pixels := _difference(without_effects, background)
				var user = battle.fighters[0]
				var on_screen: Vector2 = root.get_canvas_transform() * (user.pos() + Vector2(0, -user.ninja.body_height * 0.5))
				var visible_rect: Rect2 = root.get_visible_rect()
				print("ninja %d quadro %02d anim=%s efeitos=%d px_efeitos=%d px_ninjas=%d centro=%s tela=%s zoom=%.2f" % [who, shot, user.anim_slug, battle.effects.size(), effect_pixels, fighter_pixels, str(on_screen.round()), str(visible_rect.size), battle.cam_zoom])
				if fighter_pixels < 40:
					problems.append("ninja %d quadro %d: personagens invisíveis" % [who, shot])
				if not visible_rect.grow(40.0).has_point(on_screen):
					problems.append("ninja %d quadro %d: atacante fora da tela" % [who, shot])
				effect_peak = max(effect_peak, effect_pixels)
				if effect_pixels > 150:
					shots_with_effect_pixels += 1
				shot += 1
		print("capturas do ninja %d: %d, com efeitos visíveis: %d, pico: %d px" % [who, shot, shots_with_effect_pixels, effect_peak])
		if shots_with_effect_pixels == 0:
			problems.append("ninja %d: partículas nunca apareceram" % who)
		battle.queue_free()
		await process_frame
	for problem in problems:
		printerr("TELAS: " + problem)
	if problems.is_empty():
		print("TELAS OK")
	quit(0 if problems.is_empty() else 1)


func _grab(battle: Node) -> Image:
	battle._apply_camera()
	battle.queue_redraw_all()
	battle.hud.refresh()
	await process_frame
	await RenderingServer.frame_post_draw
	return root.get_texture().get_image()


## Number of sampled pixels (every 2nd in each direction) that differ visibly.
func _difference(a: Image, b: Image) -> int:
	var count := 0
	for y in range(0, a.get_height(), 2):
		for x in range(0, a.get_width(), 2):
			var p := a.get_pixel(x, y)
			var q := b.get_pixel(x, y)
			if absf(p.r - q.r) + absf(p.g - q.g) + absf(p.b - q.b) > 0.06:
				count += 1
	return count
