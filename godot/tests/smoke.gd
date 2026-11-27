extends SceneTree
## Headless check: plays full AI-vs-AI matches in 1x1 and 3x3 by stepping the simulation.

const NinjaData := preload("res://scripts/ninja_data.gd")
const Battle := preload("res://scripts/battle.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var roster: Array = []
	for entry in NinjaData.load_index():
		var ninja = NinjaData.new()
		ninja.open(entry["folder"])
		for path in ninja.texture_paths():
			if load(path) == null:
				_fail("textura não carregou: " + path)
				return
		for key in ninja.data["sounds"]:
			if load(ninja.ROOT + ninja.data["sounds"][key]) == null:
				_fail("som não carregou: " + key)
				return
		for key in ninja.data["videos"]:
			if load(ninja.ROOT + ninja.data["videos"][key]) == null:
				_fail("vídeo não carregou: " + key)
				return
		roster.append(ninja)
	if roster.size() < 2:
		_fail("elenco incompleto")
		return

	var totals := {"chases": 0, "ultimates": 0, "particles": 0}
	for match_number in 12:
		seed(1000 + match_number)
		var size: int = 1 if match_number < 6 else 3
		var teams: Array = [[], []]
		for team in 2:
			for i in size:
				teams[team].append(roster[(team + i + match_number) % roster.size()])
		var battle = Battle.new()
		root.add_child(battle)
		battle.setup(teams, "auto")
		var steps := 0
		var stuck := 0
		var last_round := 0
		var seen: Dictionary = {}
		while battle.phase != "over" and steps < 200000:
			battle.step(1.0 / 30.0)
			steps += 1
			if battle.round_number == last_round:
				stuck += 1
			else:
				stuck = 0
				last_round = battle.round_number
			if stuck > 3000:
				_fail("partida %d travada na rodada %d, fase %s" % [match_number, last_round, battle.phase])
				return
			if battle.dash != null:
				if battle.dash["step"] == "chase_strike":
					seen["c%d-%d" % [battle.round_number, battle.dash["combo"]]] = true
				if battle.dash["choice"] == "ultimate":
					seen["u%d" % battle.round_number] = true
			totals["particles"] = max(totals["particles"], battle.effects.size())
			if steps % 600 == 0:
				await process_frame
		if battle.phase != "over":
			_fail("partida %d não terminou" % match_number)
			return
		for key in seen:
			totals["chases" if key.begins_with("c") else "ultimates"] += 1
		print("partida %d %dx%d: rodadas %d, vencedor %d" % [match_number, size, size, battle.round_number, battle.winner_team])
		battle.queue_free()
		await process_frame
	print("TOTAIS ", totals)
	if totals["chases"] == 0 or totals["ultimates"] == 0 or totals["particles"] == 0:
		_fail("perseguições, Ôgi ou partículas nunca aconteceram")
		return
	print("SMOKE OK")
	quit(0)


func _fail(message: String) -> void:
	printerr("SMOKE FALHOU: " + message)
	quit(1)
