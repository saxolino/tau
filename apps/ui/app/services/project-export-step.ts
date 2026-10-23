/* oxlint-disable new-cap -- OpenCascade exposes C++ constructor names. */
import type { OpenCascadeInstance, TDF_Label, TopLoc_Location, TopoDS_Shape } from 'libcascade/init';
import { createOcScope } from '@taucad/occt-core';
import type { StepCheckRequest, StepCheckResult, StepInspection } from './project-export.types.js';

/** Read names and geometry from the actual STEP bytes, in a separate OCCT instance. */
export function inspectStep(oc: OpenCascadeInstance, bytes: Uint8Array<ArrayBuffer>): StepInspection[] {
  return withStep(oc, bytes, (pieces) => {
    const inspections: StepInspection[] = [];
    for (const { name, shape } of pieces) {
      const scope = createOcScope();
      try {
        const explorer = scope.track(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID));
        let solids = 0;
        while (explorer.More()) {
          solids += 1;
          explorer.Next();
        }
        const analyzer = scope.track(new oc.BRepCheck_Analyzer(shape, true, false, true));
        inspections.push({ name, solids, valid: !shape.IsNull() && analyzer.IsValid() });
      } finally {
        scope.dispose();
      }
    }
    return inspections;
  });
}

type StepPiece = { name: string; shape: TopoDS_Shape };

function withStep<T>(oc: OpenCascadeInstance, bytes: Uint8Array<ArrayBuffer>, consume: (pieces: StepPiece[]) => T): T {
  const scope = createOcScope();
  const path = '/tmp/sinopia-export.step';
  oc.FS.writeFile(path, bytes);
  try {
    const reader = scope.track(new oc.STEPCAFControl_Reader());
    reader.SetNameMode(true);
    const document = scope.track(new oc.TDocStd_Document(scope.track(new oc.TCollection_ExtendedString())));
    const progress = scope.track(new oc.Message_ProgressRange());
    if (!reader.Perform(path, document, progress)) {
      throw new Error('STEP_READ_FAILED');
    }
    const tool = scope.track(oc.XCAFDoc_DocumentTool.ShapeTool(scope.track(document.Main())));
    const roots = scope.track(new oc.NCollection_Sequence_TDF_Label());
    tool.GetFreeShapes(roots);
    const pieces: StepPiece[] = [];
    const nameOf = (label: TDF_Label): string => {
      const id = scope.track(oc.TDataStd_Name.GetID());
      const attribute = label.FindAttribute(id);
      try {
        // Embind downcasts polymorphic attributes; verify the dynamic type before reading it.
        if (!attribute.returnValue || !(attribute.anAttribute instanceof oc.TDataStd_Name)) {
          return '';
        }
        const value = scope.track(attribute.anAttribute.Get());
        return scope.track(new oc.TCollection_AsciiString(value, '\0')).ToCString();
      } finally {
        attribute[Symbol.dispose]();
      }
    };
    const visit = (label: TDF_Label, parent: TopLoc_Location, depth: number): void => {
      if (depth > 64 || pieces.length > 10_000) {
        throw new Error('STEP_ASSEMBLY_LIMIT');
      }
      const referred = scope.track(new oc.TDF_Label());
      const product = oc.XCAFDoc_ShapeTool.GetReferredShape(label, referred) ? referred : label;
      const location = scope.track(parent.Multiplied(scope.track(oc.XCAFDoc_ShapeTool.GetLocation(label))));
      if (oc.XCAFDoc_ShapeTool.IsAssembly(product)) {
        const children = scope.track(new oc.NCollection_Sequence_TDF_Label());
        oc.XCAFDoc_ShapeTool.GetComponents(product, children, false);
        for (let index = 1; index <= children.Length(); index += 1) {
          visit(scope.track(children.Value(index)), location, depth + 1);
        }
      } else {
        const shape = scope.track(oc.XCAFDoc_ShapeTool.GetShape(product));
        pieces.push({ name: nameOf(label) || nameOf(product), shape: scope.track(shape.Located(location, false)) });
      }
    };
    const identity = scope.track(new oc.TopLoc_Location());
    for (let index = 1; index <= roots.Length(); index += 1) {
      visit(scope.track(roots.Value(index)), identity, 0);
    }
    return consume(pieces);
  } finally {
    scope.dispose();
    oc.FS.unlink(path);
  }
}

function writeSelectedStep(
  oc: OpenCascadeInstance,
  bytes: Uint8Array<ArrayBuffer>,
  names: string[],
): Uint8Array<ArrayBuffer> {
  return withStep(oc, bytes, (pieces) => {
    const scope = createOcScope();
    const path = '/tmp/sinopia-selected.step';
    try {
      const document = scope.track(new oc.TDocStd_Document(scope.track(new oc.TCollection_ExtendedString())));
      const tool = scope.track(oc.XCAFDoc_DocumentTool.ShapeTool(scope.track(document.Main())));
      oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
      for (const piece of pieces.filter(({ name }) => names.includes(name))) {
        const label = scope.track(tool.AddShape(piece.shape, false));
        scope.track(oc.TDataStd_Name.Set(label, scope.track(new oc.TCollection_ExtendedString(piece.name, true))));
      }
      const writer = scope.track(new oc.STEPCAFControl_Writer(scope.track(new oc.XSControl_WorkSession()), false));
      writer.SetNameMode(true);
      oc.Interface_Static.SetIVal('write.step.schema', 5);
      oc.Interface_Static.SetCVal('write.step.unit', 'MM');
      if (!writer.Perform(document, path, scope.track(new oc.Message_ProgressRange()))) {
        throw new Error('STEP_WRITE_FAILED');
      }
      return new Uint8Array(oc.FS.readFile(path));
    } finally {
      scope.dispose();
      try {
        oc.FS.unlink(path);
      } catch {
        // A failed writer may not have created the file.
      }
    }
  });
}

const namesMatch = (pieces: StepInspection[], expected: string[]): boolean =>
  expected.length > 0 &&
  new Set(expected).size === expected.length &&
  pieces.length === expected.length &&
  pieces.every(({ name }) => expected.includes(name)) &&
  new Set(pieces.map(({ name }) => name)).size === expected.length;

/** Filtering is followed by a second read, so the badge always covers the downloadable bytes. */
export function checkStepExport(oc: OpenCascadeInstance, request: StepCheckRequest): StepCheckResult {
  try {
    let { bytes } = request;
    let pieces = inspectStep(oc, bytes);
    if (!namesMatch(pieces, request.expectedNames)) {
      return { status: 'needsFix', problem: 'names' };
    }
    if (request.selectedNames) {
      if (
        request.selectedNames.length === 0 ||
        request.selectedNames.some((name) => !request.expectedNames.includes(name))
      ) {
        return { status: 'needsFix', problem: 'selection' };
      }
      bytes = writeSelectedStep(oc, bytes, request.selectedNames);
      pieces = inspectStep(oc, bytes);
      if (!namesMatch(pieces, request.selectedNames)) {
        return { status: 'needsFix', problem: 'names' };
      }
    }
    if (pieces.some(({ solids }) => solids !== 1)) {
      return { status: 'needsFix', problem: 'solids' };
    }
    if (pieces.some(({ valid }) => !valid)) {
      return { status: 'needsFix', problem: 'invalid' };
    }
    return { status: 'verified', bytes, pieces };
  } catch {
    return { status: 'needsFix', problem: 'read' };
  }
}
