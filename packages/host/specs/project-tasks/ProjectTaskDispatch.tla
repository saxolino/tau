------------------------- MODULE ProjectTaskDispatch -------------------------
EXTENDS Naturals, TLC
CONSTANT EarlyStop
VARIABLES phase, cancellation, resource, settled
vars == <<phase, cancellation, resource, settled>>
Init == /\ phase = "executing" /\ cancellation = FALSE /\ resource = TRUE /\ settled = FALSE
Cancel == /\ phase = "executing" /\ ~cancellation
          /\ cancellation' = TRUE
          /\ phase' = IF EarlyStop THEN "ended" ELSE phase
          /\ UNCHANGED <<resource, settled>>
Settled == /\ phase = "executing"
           /\ phase' = "ended" /\ resource' = FALSE /\ settled' = TRUE
           /\ UNCHANGED cancellation
Failed == /\ phase = "executing"
          /\ phase' = "ended" /\ resource' = FALSE /\ settled' = TRUE
          /\ UNCHANGED cancellation
Next == Cancel \/ Settled \/ Failed
Spec == Init /\ [][Next]_vars
TypeOK == /\ phase \in {"executing", "ended"}
          /\ cancellation \in BOOLEAN /\ resource \in BOOLEAN /\ settled \in BOOLEAN
NoEarlyRelease == phase = "ended" => (~resource /\ settled)
=============================================================================
