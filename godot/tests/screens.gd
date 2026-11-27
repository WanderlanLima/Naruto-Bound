extends SceneTree
## Renders real frames of each ninja's Ougi (with chase) so they can be inspected.

const NinjaData := preload("res://scripts/ninja_data.gd")
const Battle := preload("res://scripts/battle.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	DirAccess.make_dir_recursive_absolute("res://shots")
	var roster: Array = []
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
		while frame < 600 and (battle.dash != null):
			battle.step(1.0 / 30.0)
			frame += 1
			if frame % 18 == 0:
				battle._apply_camera()
				battle.queue_redraw_all()
				battle.hud.refresh()
				await process_frame
				await RenderingServer.frame_post_draw
				root.get_texture().get_image().save_png("res://shots/ninja%d_%02d.png" % [who, shot])
				shot += 1
		print("capturas do ninja %d: %d" % [who, shot])
		battle.queue_free()
		await process_frame
	quit(0)
