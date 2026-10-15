---
"lissio": patch:fixed
---

Update the locked rustls dependency to 0.23.46, resolving RUSTSEC-2026-0346
through RUSTSEC-2026-0349 without relaxing dependency audit policy.

Keep the window and node-editor backgrounds on one surface each so translucent
layers do not repeatedly obscure the native Windows desktop backdrop. Preserve
acrylic appearance when creating, activating, importing, or editing a theme.
Windows desktop Acrylic requires the system transparency effects to be enabled;
its system-controlled solid fallback remains available when effects are disabled.

Exclude generated checkout-local output and temporary test caches from ESLint,
so running browser tests does not cause later lint checks to fail on compiled
artifacts.

Remove Tauri's exact empty MSVC library placeholder after generation so Windows
workspace documentation tests use the real CRT import library, while retaining
the desktop's static runtime link arguments.
