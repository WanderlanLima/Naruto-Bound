extends CanvasLayer
## Battle interface: team health, turn info, action buttons, Ougi video and result.

var battle: Node2D
var _bars: Array = []
var _status: Label
var _banner: Label
var _buttons: Dictionary = {}
var _video_root: Control
var _video: VideoStreamPlayer
var _video_title: Label
var _result: Control


func setup(owner_battle: Node2D) -> void:
	battle = owner_battle
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var columns: Array = []
	for team in 2:
		var column := VBoxContainer.new()
		column.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.set_anchors_preset(Control.PRESET_TOP_LEFT if team == 0 else Control.PRESET_TOP_RIGHT)
		column.offset_left = 12.0 if team == 0 else -232.0
		column.offset_right = 232.0 if team == 0 else -12.0
		column.offset_top = 8.0
		root.add_child(column)
		columns.append(column)
	for f in battle.fighters:
		var label := Label.new()
		label.add_theme_font_size_override("font_size", 12)
		var bar := ProgressBar.new()
		bar.show_percentage = false
		bar.custom_minimum_size = Vector2(220, 7)
		bar.max_value = f.max_hp
		columns[f.team].add_child(label)
		columns[f.team].add_child(bar)
		_bars.append([label, bar])

	_status = _centered_label(root, 8.0, 14)
	_banner = _centered_label(root, 62.0, 20)
	_banner.add_theme_color_override("font_color", Color("7dd3fc"))

	var left := _row(root, Control.PRESET_BOTTOM_LEFT, 12.0, 300.0)
	for entry in [["◀", -1.0], ["▶", 1.0]]:
		var button := _button(left, entry[0], 58)
		button.button_down.connect(func(): battle.move_dir = entry[1])
		button.button_up.connect(func(): battle.move_dir = 0.0)
	_button(left, "Câmera", 76).pressed.connect(func(): battle.center_camera())
	_button(left, "Sair", 58).pressed.connect(func(): battle.exit_requested.emit())

	var right := _row(root, Control.PRESET_BOTTOM_RIGHT, -372.0, -12.0)
	right.alignment = BoxContainer.ALIGNMENT_END
	for entry in [["attack", "Ataque"], ["skill", "Jutsu"], ["ultimate", "Ôgi"]]:
		var button := _button(right, entry[1], 112)
		button.toggle_mode = true
		button.pressed.connect(func(): battle.select_action(entry[0]))
		_buttons[entry[0]] = button

	_video_root = ColorRect.new()
	_video_root.color = Color.BLACK
	_video_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_video_root.visible = false
	add_child(_video_root)
	var keeper := AspectRatioContainer.new()
	keeper.ratio = 16.0 / 9.0
	keeper.set_anchors_preset(Control.PRESET_FULL_RECT)
	_video_root.add_child(keeper)
	_video = VideoStreamPlayer.new()
	_video.expand = true
	_video.finished.connect(func(): battle.finish_cut_in())
	keeper.add_child(_video)
	_video_title = _centered_label(_video_root, 10.0, 18)
	var skip := _button(_video_root, "Pular", 96)
	skip.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	skip.offset_left = -110.0
	skip.offset_top = -58.0
	skip.offset_right = -14.0
	skip.offset_bottom = -14.0
	skip.pressed.connect(func(): battle.finish_cut_in())


func _centered_label(parent: Control, top: float, font_size: int) -> Label:
	var label := Label.new()
	label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	label.offset_top = top
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_constant_override("outline_size", 5)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	parent.add_child(label)
	return label


func _row(parent: Control, preset: int, left: float, right: float) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.set_anchors_preset(preset)
	row.offset_left = left
	row.offset_right = right
	row.offset_top = -58.0
	row.offset_bottom = -10.0
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(row)
	return row


func _button(parent: Control, text: String, width: int) -> Button:
	var button := Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.custom_minimum_size = Vector2(width, 44)
	parent.add_child(button)
	return button


func refresh() -> void:
	if battle == null or _status == null:
		return
	for f in battle.fighters:
		var marker := "▶ " if f.index == battle.turn_index else ""
		_bars[f.index][0].text = "%s%s  %d/%d  · chakra %d" % [marker, f.ninja.display_name, f.hp, f.max_hp, f.chakra]
		_bars[f.index][1].value = f.hp
	var arrow := "→" if battle.wind >= 0.0 else "←"
	_status.text = "Rodada %d · %ds\nVento %s %.1f" % [battle.round_number, int(ceil(max(0.0, battle.timer_sec))), arrow, absf(battle.wind)]
	var lines: Array = []
	if battle.banner_timer > 0.0:
		lines.append(battle.banner_text)
	if battle.hits > 1:
		lines.append("%d HITS" % battle.hits)
	_banner.text = "\n".join(PackedStringArray(lines))
	var f = battle.active_fighter()
	var human: bool = battle.phase == "aim" and not battle.is_ai_turn()
	for key in _buttons:
		var button: Button = _buttons[key]
		var enabled := human
		if key == "ultimate":
			enabled = enabled and f.chakra >= 100 and f.statuses["seal"] == 0
		elif key == "skill":
			enabled = enabled and f.chakra >= int(f.ninja.combat["skill"]["chakraCost"]) and f.statuses["seal"] == 0
		button.disabled = not enabled
		button.set_pressed_no_signal(f.armed == key)


func play_video(path: String, title: String) -> void:
	var stream = load(path)
	if stream == null:
		battle.finish_cut_in.call_deferred()
		return
	_video.stream = stream
	_video_title.text = title
	_video_root.visible = true
	_video.play()


func stop_video() -> void:
	_video.stop()
	_video_root.visible = false


func show_result() -> void:
	if _result != null or battle.mode == "auto":
		return
	_result = CenterContainer.new()
	_result.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_result)
	var panel := PanelContainer.new()
	_result.add_child(panel)
	var column := VBoxContainer.new()
	column.custom_minimum_size = Vector2(300, 0)
	panel.add_child(column)
	var label := Label.new()
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.text = "Empate" if battle.winner_team < 0 else "Vitória da equipe %d" % (battle.winner_team + 1)
	column.add_child(label)
	_button(column, "Revanche", 280).pressed.connect(func(): battle.rematch_requested.emit())
	_button(column, "Menu", 280).pressed.connect(func(): battle.exit_requested.emit())
