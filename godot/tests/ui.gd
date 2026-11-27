extends SceneTree
## Plays the real interface with pointer events: menu, selection, loading, aim and Ougi video.


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	seed(3)
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await _frames(5)
	if not await _click_text(main, "Modo: 1x1"):
		return _fail("botão de modo")
	if not await _click_text(main, "Player vs Player local"):
		return _fail("botão local")
	if main.team_size != 3 or main.mode != "local":
		return _fail("modo 3x3 local não foi escolhido")
	for pick in 6:
		if not await _click_text(main, main.roster[pick % 2].display_name):
			return _fail("escolha de ninja %d" % pick)
	var battle = null
	for i in 1200:
		await process_frame
		if main._screen != null and main._screen.has_method("fire_shot"):
			battle = main._screen
			break
	if battle == null:
		return _fail("a batalha não abriu depois do carregamento")
	if battle.fighters.size() != 6:
		return _fail("esperava 6 ninjas")
	print("menu, seleção 3x3 e carregamento OK")
	await _seconds(1.5)

	# Walking with the on-screen arrow
	var walker = battle.active_fighter()
	var start_x: float = walker.x
	var arrow := _find_button(main, "▶")
	_pointer(_center(arrow), true)
	await _seconds(0.7)
	_pointer(_center(arrow), false)
	await _seconds(0.3)
	if absf(walker.x - start_x) < 5.0:
		return _fail("o ninja não andou")
	print("movimento OK: %.0f px" % (walker.x - start_x))

	# Slingshot aim: press on the ninja, drag backwards, release
	await _seconds(1.0)
	var chest: Vector2 = root.get_canvas_transform() * (walker.pos() + Vector2(0, -walker.ninja.body_height * 0.5))
	_pointer(chest, true)
	await _frames(3)
	_motion(chest + Vector2(-90, 55))
	await _frames(3)
	if battle.aim == null:
		return _fail("arrastar no ninja não criou a mira (tela %s)" % str(chest))
	_pointer(chest + Vector2(-90, 55), false)
	await _frames(3)
	if battle.phase == "aim":
		return _fail("soltar não disparou")
	print("mira e disparo OK, fase " + battle.phase)

	for i in 1500:
		await process_frame
		if battle.phase == "aim" and battle.active_team == 1:
			break
	if battle.active_team != 1 or battle.phase != "aim":
		return _fail("o turno não passou para a equipe 2")
	print("troca de turno OK")

	# Ougi: real button, forced direct hit, video must play and then hand over to the attack
	var user = battle.active_fighter()
	user.chakra = 100
	await _frames(3)
	if not await _click_text(main, "Ôgi") or user.armed != "ultimate":
		return _fail("botão Ôgi")
	var victim = battle._nearest_enemy(user)
	battle.projectile = {"pos": victim.pos(), "vel": Vector2.ZERO, "choice": "ultimate", "trail": []}
	battle.phase = "fly"
	battle._impact(victim.pos() + Vector2(0, -30), victim)
	if battle.cut_in == null:
		return _fail("o vídeo do Ôgi não abriu")
	await _seconds(1.5)
	var video: VideoStreamPlayer = battle.hud._video
	print("vídeo: tocando=%s posição=%.2fs textura=%s" % [video.is_playing(), video.stream_position, video.get_video_texture() != null])
	if battle.cut_in != null and (not video.is_playing() or video.stream_position <= 0.2):
		return _fail("o vídeo não avançou")
	if battle.cut_in != null and not await _click_text(main, "Pular"):
		return _fail("botão Pular")
	await _frames(3)
	if battle.cut_in != null or battle.dash == null:
		return _fail("o golpe não começou depois do vídeo")
	for i in 3000:
		await process_frame
		if battle.dash == null:
			break
	if battle.dash != null:
		return _fail("o golpe não terminou")
	print("Ôgi com vídeo OK")

	if not await _click_text(main, "Sair"):
		return _fail("botão Sair")
	await _frames(5)
	if _find_button(main, "Player vs IA") == null:
		return _fail("não voltou ao menu")
	print("UI OK")
	quit(0)


func _frames(count: int) -> void:
	for i in count:
		await process_frame


func _seconds(duration: float) -> void:
	await create_timer(duration).timeout


func _find_button(node: Node, text: String) -> Button:
	if node.is_queued_for_deletion():
		return null
	if node is Button and node.text.begins_with(text) and node.is_visible_in_tree():
		return node
	for child in node.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _center(control: Control) -> Vector2:
	return control.get_global_rect().get_center()


func _click_text(main: Node, text: String) -> bool:
	await _frames(4)
	var button := _find_button(main, text)
	if button == null or button.disabled:
		return false
	var at := _center(button)
	_pointer(at, true)
	await _frames(2)
	_pointer(at, false)
	await _frames(4)
	return true


func _pointer(at: Vector2, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = pressed
	event.position = at
	event.global_position = at
	root.push_input(event, true)


func _motion(at: Vector2) -> void:
	var event := InputEventMouseMotion.new()
	event.position = at
	event.global_position = at
	event.button_mask = MOUSE_BUTTON_MASK_LEFT
	root.push_input(event, true)


func _fail(message: String) -> void:
	printerr("UI FALHOU: " + message)
	quit(1)
