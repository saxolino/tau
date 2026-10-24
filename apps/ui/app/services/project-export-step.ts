/* oxlint-disable new-cap -- OpenCascade exposes C++ constructor names. */
import type { OpenCascadeInstance, TDF_Label, TopLoc_Location, TopoDS_Shape } from 'libcascade/init';
import { createOcScope } from '@taucad/occt-core';
import type { StepCheckRequest, StepCheckResult, StepInspection } from './project-export.types.js';

/** Edges may sit this far from their faces, in mm: far tighter than casting, CNC or wax printing. */
export const stepEdgeTolerance = 0.001;

/** Read names and geometry from the actual STEP bytes, in a separate OCCT instance. */
export function inspectStep(oc: OpenCascadeInstance, bytes: Uint8Array<ArrayBuffer>): StepInspection[] {
  return withStep(oc, bytes, (pieces) =>
    pieces.map(({ name, shape }) => ({
      name,
      solids: countSolids(oc, shape),
      valid: !shape.IsNull() && isValidShape(oc, shape),
    })),
  );
}

type StepPiece = { name: string; shape: TopoDS_Shape };

/**
 * OCCT's default check must pass on the file's own tolerances. The exact check also measures every edge against its
 * faces; a kernel may declare a far tighter tolerance than it keeps, so that check is repeated within
 * {@link stepEdgeTolerance}.
 */
function isValidShape(oc: OpenCascadeInstance, shape: TopoDS_Shape): boolean {
  const scope = createOcScope();
  try {
    // The reader widens tolerances to cover gaps (up to 1 mm), so a wider tolerance is a wider gap.
    const { TopAbs_VERTEX, TopAbs_EDGE, TopAbs_FACE } = oc.TopAbs_ShapeEnum;
    if (
      [TopAbs_VERTEX, TopAbs_EDGE, TopAbs_FACE].some(
        (type) => oc.BRep_Tool.MaxTolerance(shape, type) > stepEdgeTolerance,
      )
    ) {
      return false;
    }
    if (!scope.track(new oc.BRepCheck_Analyzer(shape, true, false, false)).IsValid()) {
      return false;
    }
    if (scope.track(new oc.BRepCheck_Analyzer(shape, true, false, true)).IsValid()) {
      return true;
    }
    // A topological copy carries its own tolerances; the geometry is shared and unchanged.
    const copy = scope.track(scope.track(new oc.BRepBuilderAPI_Copy(shape, false, false)).Shape());
    scope
      .track(new oc.ShapeFix_ShapeTolerance())
      .SetTolerance(copy, stepEdgeTolerance, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    return scope.track(new oc.BRepCheck_Analyzer(copy, true, false, true)).IsValid();
  } finally {
    scope.dispose();
  }
}

function countSolids(oc: OpenCascadeInstance, shape: TopoDS_Shape): number {
  const scope = createOcScope();
  try {
    const explorer = scope.track(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID));
    let solids = 0;
    while (explorer.More()) {
      solids += 1;
      explorer.Next();
    }
    return solids;
  } finally {
    scope.dispose();
  }
}

function withStep<T>(oc: OpenCascadeInstance, bytes: Uint8Array<ArrayBuffer>, consume: (pieces: StepPiece[]) => T): T {
  const scope = createOcScope();
  const path = '/tmp/sinopia-export.step';
  oc.FS.writeFile(path, bytes);
  try {
    const reader = scope.track(new oc.STEPCAFControl_Reader());
    reader.SetNameMode(true);
    // Some writers (SMLib) name each solid inside one product; read those names as sub-shapes.
    // The first reader registers this parameter, so it is set once the reader exists.
    oc.Interface_Static.SetIVal('read.stepcaf.subshapes.name', 1);
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
    /** Pieces named on the solids of one product, only when every solid has a name. */
    const namedSolids = (product: TDF_Label, shape: TopoDS_Shape): Map<string, TopoDS_Shape[]> | undefined => {
      const labels = scope.track(new oc.NCollection_Sequence_TDF_Label());
      if (!oc.XCAFDoc_ShapeTool.GetSubShapes(product, labels)) {
        return undefined;
      }
      const groups = new Map<string, TopoDS_Shape[]>();
      let solids = 0;
      for (let index = 1; index <= labels.Length(); index += 1) {
        const sub = scope.track(labels.Value(index));
        const solid = scope.track(oc.XCAFDoc_ShapeTool.GetShape(sub));
        const name = nameOf(sub);
        if (name && solid.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID) {
          solids += 1;
          groups.set(name, [...(groups.get(name) ?? []), solid]);
        }
      }
      // A single name is the product itself; an unnamed solid would otherwise go unchecked.
      return groups.size > 1 && solids === countSolids(oc, shape) ? groups : undefined;
    };
    // Two solids under one name stay one piece, so the solids check reports them.
    const compound = (solids: TopoDS_Shape[]): TopoDS_Shape => {
      if (solids.length === 1) {
        return solids[0]!;
      }
      const builder = scope.track(new oc.BRep_Builder());
      const result = scope.track(new oc.TopoDS_Compound());
      builder.MakeCompound(result);
      for (const solid of solids) {
        builder.Add(result, solid);
      }
      return result;
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
        const named = namedSolids(product, shape);
        if (named) {
          for (const [name, solids] of named) {
            pieces.push({ name, shape: scope.track(compound(solids).Moved(location, false)) });
          }
        } else {
          pieces.push({ name: nameOf(label) || nameOf(product), shape: scope.track(shape.Located(location, false)) });
        }
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

/** Model names not found exactly once in the file, then file names the model does not have. */
const differentNames = (pieces: StepInspection[], expected: string[]): string[] => {
  const read = pieces.map(({ name }) => name);
  const count = (names: string[], name: string): number => names.filter((other) => other === name).length;
  const different = [
    ...expected.filter((name) => count(read, name) !== 1 || count(expected, name) !== 1),
    ...read.filter((name) => !expected.includes(name)),
  ];
  return [...new Set(different)];
};

/** Filtering is followed by a second read, so the badge always covers the downloadable bytes. */
export function checkStepExport(oc: OpenCascadeInstance, request: StepCheckRequest): StepCheckResult {
  try {
    let { bytes } = request;
    let pieces = inspectStep(oc, bytes);
    let different = differentNames(pieces, request.expectedNames);
    if (request.expectedNames.length === 0 || different.length > 0) {
      return { status: 'needsFix', problem: 'names', pieces: different };
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
      different = differentNames(pieces, request.selectedNames);
      if (different.length > 0) {
        return { status: 'needsFix', problem: 'names', pieces: different };
      }
    }
    if (pieces.some(({ solids }) => solids !== 1)) {
      return { status: 'needsFix', problem: 'solids' };
    }
    const invalid = pieces.filter(({ valid }) => !valid).map(({ name }) => name);
    if (invalid.length > 0) {
      return { status: 'needsFix', problem: 'invalid', pieces: invalid };
    }
    return { status: 'verified', bytes, pieces };
  } catch {
    return { status: 'needsFix', problem: 'read' };
  }
}
