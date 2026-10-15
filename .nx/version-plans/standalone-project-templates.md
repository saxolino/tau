---
bundler-core: patch
replicad: patch
opencascade: patch
tscircuit: patch
---

Projects Tau creates now run outside Tau with npm. replicad declares `replicad-opencascadejs`, OpenCascade declares `libcascade`, and tscircuit pins the rest of its engine closure, so `npm ci` installs what each kernel runs. Install places peers as npm does: a package nests with its peer when that peer conflicts with a version beside it, and a peer that fits no level of a package the project does not depend on directly nests under that package.
