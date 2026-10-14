---
"lissio": patch:fixed
---

Make the Windows acrylic backplate follow the application theme. DWM owns the
Windows 11 system material, so its light/dark variant tracks the *system* app
mode and cannot be tinted by the application — with the shipped dark theme and a
light-mode Windows the backplate turned into a bright plate under semi-transparent
dark panels. Lissio now tells the native side which polarity the application
theme uses (`set_window_acrylic` sets the immersive dark mode, so the title bar and
frame match too), hands the theme's window background to DWM as the material tint
on the Windows 10 composition-attribute path, and raises the acrylic background
token alphas when the system material is the opposite polarity of the theme. The
workspace also moves `window-vibrancy` from 0.6 to the 0.8 line that `tauri`
already resolves, so one copy is compiled and a failed system backdrop is reported
and falls back to blur instead of leaving a bare transparent window.
