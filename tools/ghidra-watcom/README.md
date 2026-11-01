# Watcom support for local Ghidra

The files in `upstream/` are unchanged copies from
[GhiOWat](https://github.com/0xBEEEF/GhiOWat), commit
`79cdc249d2d28d4f30fa1a3b204213d1693e46e2`. The upstream license is included.

For the local Ghidra 12.1.4 installation, copy `x86openwatcom.cspec` and
`x86openwatcom.ldefs` into `Ghidra/Processors/x86/data/languages/`. This allows
the definition to use the bundled x86 processor specification and compiled
instruction set. The archived extension's version-specific packaging and
optional function-pattern files are not installed.

Select language `x86:LE:32:openwatcom` and compiler `openwatcomcpp` when importing.
The default convention is `__watcallRegister`; Windows API functions can use
`__stdcall` as declared in the same compiler specification.

The original executable identifies an older Watcom runtime. These Open Watcom
definitions are an analysis aid, not proof that every inferred signature,
register-preservation rule, or data type is correct for this game. Check important
functions against the disassembly before translating their behavior.

The Ghidra distribution does not include macOS native binaries. Build them with
`gradle --offline --no-daemon buildNatives` from its `support/gradle/` directory
using an installed Gradle distribution (or use the supplied wrapper online).
This builds the analysis tools; it does not run the original executable.

Local settings, caches and temporary files are directed to `.ghidra-user/` via
the local installation's `support/launch.properties`. The installation,
Ghidra project database and caches are excluded from Git.
