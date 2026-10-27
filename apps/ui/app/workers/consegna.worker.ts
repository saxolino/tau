import { esponiConsegna } from '@taucad/smlib/consegna/worker';

// SinopiaCAD's delivery (E3a) on its own SMLib kernel: STEP rewritten and read back, IGES read back, DXF and the
// drawings of the PDF sheet, off the UI thread and off the project's kernel worker. No OpenCASCADE here.
esponiConsegna();
