---
mcp: minor
host: minor
cli: minor
agent-plugin: minor
---

`tau mcp --machines` (or `TAU_HOST_MACHINES=true`) offers the print tools over the printers this computer's Tau apps share in `<config>/machines`; while another Tau app holds that store, the server says so on stderr and offers no print tools. A print starts only after the person approves it: when the MCP client declares form elicitation, `request_print` asks in the client's own form (a checkbox labelled Approve) and waits for the answer; otherwise it returns the request awaiting approval in Tau. `@taucad/mcp` passes `confirm` to a host tool's dispatch when the client can draw a form (new type `TauMcpConfirm`). `@taucad/host` adds `openLocalMachines` and `openSharedMachineHost`, which `tau serve --machines` now uses too.
