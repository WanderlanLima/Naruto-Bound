extends RefCounted
## State of one ninja on the battlefield.

var index := 0
var team := 0
var ninja: RefCounted
var x := 0.0
var y := 0.0
var vx := 0.0
var vy := 0.0
var dir := 1.0
var air := false
var hp := 100
var max_hp := 100
var chakra := 0
var armed := "attack"
var move_used := 0.0
var anim_slug := "idle"
var anim_start_ms := 0.0
var anim_loop := true
var lock_sec := 0.0
var timeline: Variant = null
var chase_state := ""
var silhouette := false
var hit_flash := 0.0
var statuses := {"burn": 0, "poison": 0, "paralysis": 0, "seal": 0, "slow": 0, "shield": 0}


func pos() -> Vector2:
	return Vector2(x, y)


func anim() -> Dictionary:
	return ninja.animation(anim_slug)
