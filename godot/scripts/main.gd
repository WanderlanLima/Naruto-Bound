extends Node
## Menu, ninja selection, loading screen and battle switching.

const NinjaData := preload("res://scripts/ninja_data.gd")
const Battle := preload("res://scripts/battle.gd")

var roster: Array = []  # loaded NinjaData, one per ninja
var team_size := 1
var mode := "ia"
var picks: Array = [[], []]
var _screen: Node


func _ready() -> void:
	for entry in NinjaData.load_index():
		var ninja = NinjaData.new()
		ninja.open(entry["folder"])
		roster.append(ninja)
	show_menu()


func _swap(node: Node) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen = node
	add_child(node)


func _page(title: String) -> VBoxContainer:
	var layer := CanvasLayer.new()
	_swap(layer)
	var background := ColorRect.new()
	background.color = Color("0b1020")
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(background)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var column := VBoxContainer.new()
	column.custom_minimum_size = Vector2(420, 0)
	column.add_theme_constant_override("separation", 10)
	center.add_child(column)
	var heading := Label.new()
	heading.text = title
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	heading.add_theme_font_size_override("font_size", 30)
	heading.add_theme_color_override("font_color", Color("fbbf24"))
	column.add_child(heading)
	return column


func _button(parent: Control, text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 48)
	button.pressed.connect(action)
	parent.add_child(button)
	return button


func show_menu() -> void:
	var column := _page("NARUTO BOUND")
	_button(column, "Modo: %dx%d  (tocar para trocar)" % [team_size, team_size], func():
		team_size = 3 if team_size == 1 else 1
		show_menu())
	_button(column, "Player vs IA", func(): _start_selection("ia"))
	_button(column, "Player vs Player local", func(): _start_selection("local"))


func _start_selection(chosen_mode: String) -> void:
	mode = chosen_mode
	picks = [[], []]
	show_selection(0)


func show_selection(team: int) -> void:
	var column := _page("Equipe %d · %d/%d" % [team + 1, picks[team].size(), team_size])
	for ninja in roster:
		_button(column, ninja.display_name, func():
			picks[team].append(ninja)
			if picks[team].size() < team_size:
				show_selection(team)
			elif team == 0 and mode == "local":
				show_selection(1)
			else:
				if mode == "ia":
					picks[1] = ai_team()
				start_battle())
	_button(column, "Voltar", show_menu)


## AI squad: random order, repeating ninjas only when the roster is smaller than the team.
func ai_team() -> Array:
	var pool: Array = []
	while pool.size() < team_size:
		var batch := roster.duplicate()
		batch.shuffle()
		pool.append_array(batch)
	return pool.slice(0, team_size)


## Loads every texture of both teams before the fight, so nothing is loaded during a combo.
func start_battle() -> void:
	var column := _page("Carregando...")
	var bar := ProgressBar.new()
	column.add_child(bar)
	var pending: Array = []
	for ninja in picks[0] + picks[1]:
		for path in ninja.texture_paths():
			if not pending.has([ninja, path]):
				pending.append([ninja, path])
	bar.max_value = max(1, pending.size())
	await get_tree().process_frame
	for item in pending:
		item[0].textures[item[1]] = load(item[1])
		bar.value += 1
		await get_tree().process_frame
	var battle := Battle.new()
	_swap(battle)
	battle.exit_requested.connect(show_menu, CONNECT_DEFERRED)
	battle.rematch_requested.connect(start_battle, CONNECT_DEFERRED)
	battle.setup(picks, mode)
