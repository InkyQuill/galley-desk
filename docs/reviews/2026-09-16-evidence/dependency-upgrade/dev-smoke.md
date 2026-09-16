# Forge development smoke

Code0ec6250, Vite7.3.6 / React19.3.0 / Electron44.4.0 / Node26.2.0.

`electron-forge start -- --remote-debugging-port=0` launched under dedicated xvfb-run with temporary userData. Playwright Chromium CDP awaited the actual Galley Desk heading, verified an HTTP dev URL and renderer `typeof window.require === "undefined"`.

Observed: `Forge/Vite dev renderer visible at http://localhost:5173/`, `Renderer require: undefined`. Exit0. Temporary profile and owned process group cleaned up. GPU/zygote messages during process-group termination were teardown diagnostics.

With IPv6-only localhost listener, direct curl to ::1 timed out establishing a connection. Explicit `server.host = "127.0.0.1"` fixed launch. Both tested Vite8 and Vite7 had the initial network condition; it does not establish Vite8 incompatibility.
