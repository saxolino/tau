------------------------- MODULE ProjectTaskAdmission -------------------------
EXTENDS Naturals, FiniteSets, TLC
CONSTANTS Tasks, Root, Requests, Cap, Depth
VARIABLES phase, parent, depth, source, closed, resources, admitted
vars == <<phase, parent, depth, source, closed, resources, admitted>>
Active == {t \in Tasks : phase[t] \in {"allocating", "running", "cancelling"}}
Children(t) == {c \in Tasks : parent[c] = t}
Descendants(t) == {t} \cup Children(t) \cup UNION {Children(c) : c \in Children(t)}
Init == /\ phase = [t \in Tasks |-> IF t = Root THEN "running" ELSE "absent"]
        /\ parent = [t \in Tasks |-> Root]
        /\ depth = [t \in Tasks |-> 0]
        /\ source = [t \in Tasks |-> "immutable-base"]
        /\ closed = {} /\ resources = {} /\ admitted = [r \in Requests |-> Root]
Spawn(p, t, r) == /\ p \in Active /\ p \notin closed
                  /\ phase[t] = "absent" /\ admitted[r] = Root
                  /\ Cardinality(Active) < Cap /\ depth[p] < Depth
                  /\ phase' = [phase EXCEPT ![t] = "allocating"]
                  /\ parent' = [parent EXCEPT ![t] = p]
                  /\ depth' = [depth EXCEPT ![t] = @ + depth[p] + 1]
                  /\ source' = [source EXCEPT ![t] = source[p]]
                  /\ admitted' = [admitted EXCEPT ![r] = t]
                  /\ UNCHANGED <<closed, resources>>
Allocate(t) == /\ phase[t] \in {"allocating", "cancelling"} /\ t \notin resources
               /\ resources' = resources \cup {t}
               /\ UNCHANGED <<phase, parent, depth, source, closed, admitted>>
Start(t) == /\ phase[t] = "allocating" /\ t \in resources /\ t \notin closed
            /\ phase' = [phase EXCEPT ![t] = "running"]
            /\ UNCHANGED <<parent, depth, source, closed, resources, admitted>>
Cancel(t) == /\ t \in Tasks /\ phase[t] # "absent"
             /\ closed' = closed \cup Descendants(t)
             /\ phase' = [c \in Tasks |-> IF c \in Descendants(t) /\ c \in Active THEN "cancelling" ELSE phase[c]]
             /\ UNCHANGED <<parent, depth, source, resources, admitted>>
Release(t) == /\ t \in Active
              /\ phase' = [phase EXCEPT ![t] = "terminal"]
              /\ resources' = resources \ {t}
              /\ UNCHANGED <<parent, depth, source, closed, admitted>>
Next == (\E p, t \in Tasks, r \in Requests : Spawn(p,t,r))
        \/ (\E t \in Tasks : Allocate(t) \/ Start(t) \/ Cancel(t) \/ Release(t))
Spec == Init /\ [][Next]_vars
Bounded == Cardinality(Active) <= Cap
Nested == \A t \in Tasks : depth[t] <= Depth
ImmutableSource == \A t \in Tasks : phase[t] # "absent" => source[t] = "immutable-base"
NoTerminalResources == resources \subseteq Active
CancelledNeverStarts == \A t \in closed : phase[t] # "running"
=============================================================================
