/* oxlint-disable new-cap -- OpenCascade exposes C++ constructor names. */
import type { OpenCascadeInstance } from 'libcascade/init';
import { createOcScope } from '@taucad/occt-core';

/**
 * IGES for foundries and mould makers (E3a). SMLib 0.5 reads IGES but does not write it, so this conversion is the one
 * delivery step that still runs on OpenCASCADE (LGPL, in its own disposable worker): the verified STEP, with its
 * product names and colours, becomes an IGES 5.3 file of solids (MSBO, entity 186) in millimetres. The check is not
 * done here: SMLib reads the IGES back and compares solids and volumes with the STEP (`rileggi` of the delivery worker).
 *
 * @param oc - An OpenCASCADE instance of the export worker.
 * @param step - The delivery STEP (already read back by SMLib).
 * @returns The IGES bytes.
 */
export function convertStepToIges(oc: OpenCascadeInstance, step: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const scope = createOcScope();
  const input = '/tmp/sinopia-delivery.step';
  const output = '/tmp/sinopia-delivery.igs';
  oc.FS.writeFile(input, step);
  try {
    const reader = scope.track(new oc.STEPCAFControl_Reader());
    reader.SetNameMode(true);
    reader.SetColorMode(true);
    const document = scope.track(new oc.TDocStd_Document(scope.track(new oc.TCollection_ExtendedString())));
    if (!reader.Perform(input, document, scope.track(new oc.Message_ProgressRange()))) {
      throw new Error('IGES_STEP_READ_FAILED');
    }
    // A first writer registers the IGES parameters; the document writer reads them when it is made: solids as B-rep
    // (MSBO, 186) rather than trimmed faces, lengths in millimetres.
    scope.track(new oc.IGESControl_Writer());
    oc.Interface_Static.SetIVal('write.iges.brep.mode', 1);
    oc.Interface_Static.SetCVal('write.iges.unit', 'MM');
    const writer = scope.track(new oc.IGESCAFControl_Writer(scope.track(new oc.XSControl_WorkSession()), true));
    writer.SetNameMode(true);
    writer.SetColorMode(true);
    if (!writer.Perform(document, output, scope.track(new oc.Message_ProgressRange()))) {
      throw new Error('IGES_WRITE_FAILED');
    }
    return new Uint8Array(oc.FS.readFile(output));
  } finally {
    scope.dispose();
    for (const path of [input, output]) {
      try {
        oc.FS.unlink(path);
      } catch {
        // A failed writer may not have created its file.
      }
    }
  }
}
