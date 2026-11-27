extends Node
## Small pool of players so overlapping jutsu sounds never cut each other.

var _players: Array[AudioStreamPlayer] = []
var _next := 0
var _streams: Dictionary = {}


func _ready() -> void:
	for i in 12:
		var player := AudioStreamPlayer.new()
		player.volume_db = -5.0
		add_child(player)
		_players.append(player)


func preload_ninja(ninja: RefCounted) -> void:
	for key in ninja.data["sounds"]:
		var path: String = ninja.ROOT + ninja.data["sounds"][key]
		if not _streams.has(path):
			_streams[path] = load(path)


func play(path: String) -> void:
	if path == "" or _players.is_empty():
		return
	if not _streams.has(path):
		_streams[path] = load(path)
	var player := _players[_next]
	_next = (_next + 1) % _players.size()
	player.stream = _streams[path]
	player.play()
