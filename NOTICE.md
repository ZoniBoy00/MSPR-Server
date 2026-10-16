# Notice

* `horizon/` is derived from **PSMultiServer** (PSHome MultiServer), GPL-3.0, with the Horizon Medius emulator at its core (originally written for Ratchet: Deadlocked). The upstream licence is in `horizon/LICENSE`.
* The libraries inside `horizon/BackendServices` and `horizon/AuxiliaryServices` (BouncyCastle copies, DotNetty-based pipeline, WatsonWebserver, SpaceWizards.HttpListener, Technitium libraries, Prometheus client and others) keep the licences stated in their source files and folders.
* `server/` uses only Node.js built-in modules at run time; its development dependencies (`typescript`, `tsx`, `@types/node`) are installed from npm and keep their own licences.
* The RPCS3 patch in `patches/rpcs3/` changes the behaviour of one game function for the emulator; it contains no game code.
* MotorStorm is a trademark of Sony Interactive Entertainment. No game files are included.
