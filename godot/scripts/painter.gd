extends Node2D
## A drawing layer whose content is provided by a callback.

var paint: Callable


func _draw() -> void:
	if paint.is_valid():
		paint.call(self)
