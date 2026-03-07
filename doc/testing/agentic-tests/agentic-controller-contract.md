# Agentic Controller Contract

## Purpose

This file defines the controller role in executable terms for autonomous agentic testing.

Current execution scope:

- Android physical execution only.

Future compatibility requirement:

- Preserve a controller-neutral contract so a future iOS-capable controller can satisfy the same role without changing case metadata, action semantics, safety policy, or oracle policy.

## Controller Role

The controller is the peer MCP server that owns device and app interaction.

It must own:

- device enumeration and explicit target selection
- app install, launch, stop, clear-state, and uninstall when needed
- screen interaction inside the C64 Commander app
- screenshots and screen recording
- runtime-log access and log export
- file staging to device-visible storage when a case requires it
- diagnostics-surface access inside the app

It must not own:

- direct Commodore 64 Ultimate control outside the app path
- physical A/V verdict logic
- final pass/fail classification by itself

## Required Capabilities

### Device Selection

The controller must be able to:

- list attached devices
- target one explicit device for the session
- fail fast when zero or multiple eligible devices are present without an explicit selection

Required evidence:

- selected device identifier
- controller-visible device state at session start

### App Lifecycle

The controller must be able to:

- install the app when the case requires a fresh build
- launch C64 Commander
- terminate C64 Commander
- clear app state only in dedicated cleanup or isolation cases

Required evidence:

- launch success or failure
- terminate success or failure
- package identifier used for the run

### UI Interaction

The controller must be able to:

- navigate to visible UI targets
- tap, long-press, and scroll
- type text into focused controls
- press system buttons such as Back or Home when the case requires it

Required evidence:

- pre-action screenshot or UI-element snapshot when the target is ambiguous
- post-action screenshot or equivalent UI evidence when the action mutates visible state

### Runtime Logs

The controller must be able to:

- capture app and runtime logs relevant to the test case
- preserve log slices that bracket meaningful actions
- expose log failures separately from product failures

Required evidence:

- log source
- time window
- correlation to run ID and step ID where possible

### File Staging

The controller must be able to:

- stage deterministic test assets to a test-owned device path
- verify staged file counts when the case depends on staged media
- remove or isolate staged artifacts during cleanup when required

Required evidence:

- device path used for staging
- staged file counts or hashes when relevant

### Diagnostics Access

The controller must be able to:

- enter diagnostics surfaces through the app
- capture screenshots of diagnostics tabs when needed
- export or retrieve diagnostics artifacts when the case uses them as an oracle

Required evidence:

- diagnostics artifact path or export result
- screenshots or logs showing the diagnostics state used by the oracle

## Approved Android Mapping

For Android runs today, the controller role may be satisfied by the approved Android controller implementation when it provides the following operations directly or through equivalent primitives:

- device enumeration
- app install and launch
- app termination
- element listing and interaction
- screenshot capture
- text input
- system button presses
- screen recording when available
- runtime-log capture

Equivalent tool surfaces are acceptable if they preserve controller ownership and do not proxy `c64bridge` or `c64scope` responsibilities.

## Session Contract

For every physical run, the controller must supply enough evidence for the LLM to record at least these semantic steps in `scope_session.record_step`:

- device selected
- app launched
- route entered
- significant interaction executed
- diagnostic or log evidence captured
- app terminated or left in known state

The controller should surface timestamps whenever possible so those steps can be correlated with `c64scope` capture windows and with app-native diagnostics.

## Safety Constraints

- The controller must not bypass the product path by issuing direct C64U commands.
- The controller must not clear app state or uninstall the app except in explicit isolation or cleanup cases.
- The controller must stop rather than guess when the intended UI target is not attributable.
- The controller must not hide runtime-log or staging failures behind a product-success verdict.

## Failure Classification Inputs

The controller should provide enough evidence to distinguish:

- product failure: the app behaves incorrectly under healthy controller/runtime conditions
- infrastructure failure: device connection, runtime logging, file staging, or controller visibility is unhealthy
- inconclusive: the controller cannot attribute or prove the action outcome strongly enough

## Linux Host Constraint

- Android physical execution is possible from Linux when the controller can see the target device.
- iOS physical execution is not currently available from this Linux host and must remain explicitly deferred.
