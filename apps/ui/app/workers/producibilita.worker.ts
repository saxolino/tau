import { esponiProducibilita } from '@taucad/smlib/producibilita/worker';

// The producibility checks' own SMLib kernel (E1): measures off the UI thread and off the project's kernel worker.
esponiProducibilita();
