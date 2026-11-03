// Verhindert unter Windows ein zusätzliches Konsolenfenster im Release-Build
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    erd_ultra_lib::run()
}
