import type * as Smlib from '@classcad/smlibwasm';
import type {
  DefinizioneParametro,
  FamigliaQualsiasi,
  IdFamiglia,
  ParametriAnnidati,
  ValoreParametro,
} from '#famiglie/famiglia.js';
import { leggiParametro, scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import type { CameraVerifica } from '#verifica/camera.js';
import { momenti } from '#verifica/maschera.js';
import type { LatoOccluso } from '#verifica/maschera.js';
import { confronta, immagineDifferenza, iouMorbido, obiettivo, preparaConfronto, prior } from '#verifica/metrica.js';
import type { ConfrontoMaschera, StimaParametri } from '#verifica/metrica.js';
import { nelderMead } from '#verifica/nelder-mead.js';
import type { ImmagineRaster } from '#verifica/png.js';
import { meshDaForme, silhouetteMesh, silhouetteMeshMorbida, tolleranzaPerPixel } from '#verifica/silhouette.js';
import type { MascheraBinaria, MeshPiatta } from '#verifica/silhouette.js';

/**
 * Ottimizzatore a tre fasi della verifica silhouette ↔ maschera (specifica D3, §3.4, task T-D3-05).
 *
 * - **A, camera** (40 valutazioni per avvio): azimuth ±25°, elevation ±20°, rollo ±15°, centro `cx, cy` ±15 % del
 *   lato, `pxPerMm` ±25 % solo se la scala è stimata. La geometria non si ricostruisce: la mesh della stima si fa una
 *   volta e ogni camera costa la proiezione (via B di `silhouette.ts`, ≈ 3 ms con il chamfer), nessuna chiamata al
 *   kernel. Prima del simplesso, centro e scala si allineano con i momenti (baricentro e area), il rollo con l'asse
 *   principale se la vista è poco confidente. Con confidenza della vista < 0,5: tre avvii (az, az + 180°, −az).
 * - **B, parametri** (60 per giro, fino a 3 giri): i parametri `silhouetteSensibile` della famiglia, normalizzati sui
 *   loro limiti, simplesso iniziale ±15 % del valore stimato; ogni valutazione ricostruisce (`costruisci` +
 *   `tessellate`) dentro `lib.scope`, quindi i corpi intermedi sono liberati subito. Fra un giro e l'altro la camera si
 *   riallinea (fase A breve, gratis) e il simplesso riparte dimezzato: con 8–10 variabili il simplesso si appiattisce e
 *   il riavvio è il rimedio noto. Scostamento motivato dal §3.4 (60 + 25 valutazioni): la valutazione costa
 *   100–200 ms invece dei 330 stimati, quindi il budget di 45 s ne contiene di più.
 * - **C, congiunta** (60): A ∪ B, solo se B ha migliorato l'obiettivo di più di 0,01.
 *
 * Arresto anticipato: IoU sopra soglia, ristagno (miglioramento < 0,002 nelle ultime max(10, 2·(n+1)) valutazioni
 * dopo il simplesso iniziale), budget di tempo (45 s) o `AbortSignal`. Sincrono: gira nel worker dedicato della
 * verifica (`verifica.worker.ts`), dove `KernelWorker` lo interrompe terminando il worker; nel processo il segnale si
 * controlla fra una valutazione e l'altra (≤ ~0,3 s).
 */

export type FonteScala = 'misura_nota' | 'libreria' | 'catalogo' | 'taglia' | 'forma' | 'stima';

/** Vista stimata dal classificatore (§2.4), nel telaio della famiglia. */
export type VistaStimata = {
  azimuth: number;
  elevation: number;
  rollo: number;
  /** Confidenza della vista: sotto 0,5 tre avvii per l'azimut e rollo dai momenti. */
  confidenza?: number;
  latiOcclusi?: readonly LatoOccluso[];
};

export type OpzioniOttimizzatore = {
  /** Budget di tempo totale in ms (predefinito 45 000). */
  budgetMs?: number;
  valutazioni?: { camera?: number; parametri?: number; congiunta?: number };
  /**
   * IoU oltre cui una fase si ferma: 0,95 per la camera (§3.4), 0,985 per parametri e congiunta (con 0,95 sui
   * sintetici restavano 0,5–1,5 mm sulle misure; il pavimento di discretizzazione a 256² è 0,988–0,996).
   */
  iouArresto?: { camera?: number; parametri?: number };
  /** Ristagno: finestra di valutazioni e miglioramento minimo (predefinito 10 e 0,002). */
  ristagno?: { finestra?: number; soglia?: number };
  /** Lato del simplesso iniziale dei parametri, in frazione dell'intervallo (predefinito: ±15 % del valore stimato). */
  passoParametri?: number;
  /** Giri parametri → riallineamento della camera (predefinito 3). */
  giriParametri?: number;
  /** Ricentra (baricentro) ogni geometria candidata della fase B (predefinito sì). */
  centraParametri?: boolean;
  /** Campioni per lato di pixel della silhouette nell'obiettivo (predefinito 4: IoU morbido; 1 = binario). */
  sovracampionamento?: number;
  /** Variabili della camera nelle fasi A: `tutta` (§3.4) o `piano` (solo rollo, centro e scala). */
  cameraFaseA?: 'tutta' | 'piano';
  /** Chiavi da ottimizzare in B (predefinito: le `silhouetteSensibile` numeriche con limiti). */
  chiavi?: readonly string[];
  /** Avvii della fase A: `auto` = 3 se la confidenza della vista è < 0,5. */
  avvii?: 'auto' | 1 | 3;
  /** Valori imposti per la costruzione della verifica (per il tacco `costruzione.lato = dx`: la foto ne ha uno). */
  parametriVerifica?: Readonly<Record<string, ValoreParametro>>;
  segnale?: AbortSignal;
  /** Orologio in ms (predefinito `performance.now`). */
  adesso?: () => number;
};

/** Ingresso della verifica: famiglia, stima del classificatore, vista, scala e maschera preparata. */
export type IngressoVerifica = {
  famiglia: IdFamiglia;
  variante?: string;
  stima: StimaParametri;
  vista: VistaStimata;
  /** Pixel della maschera per mm (già moltiplicati per `k`), o null se ignota; la fonte decide se è libera. */
  scala: { pxPerMm: number | null; fonte: FonteScala };
  maschera: MascheraBinaria & { valida: Uint8Array; copertura?: Float32Array };
  opzioni?: OpzioniOttimizzatore;
};

export type NomeFase = 'camera' | 'parametri' | 'congiunta';

export type EsitoFase = {
  fase: NomeFase;
  valutazioni: number;
  f: number;
  iou: number;
  ms: number;
  motivo: 'convergenza' | 'valutazioni' | 'arresto' | 'saltata';
};

export type EsitoVerifica = {
  famiglia: IdFamiglia;
  variante?: string;
  /** Parametri ottimizzati e normalizzati (con i valori della stima per le chiavi non ottimizzate). */
  parametri: ParametriAnnidati;
  camera: CameraVerifica;
  iou: number;
  chamferMm: number;
  f: number;
  chiaviOttimizzate: string[];
  fasi: EsitoFase[];
  avvii: Array<{ azimuth: number; f: number; iou: number }>;
  valutazioni: number;
  ricostruzioni: number;
  tempoMs: number;
  /** Fermato da budget o segnale prima della fine. */
  interrotto: boolean;
  silhouette: MascheraBinaria;
  /** Immagine differenza 256² (rosso = solo modello, blu = solo maschera). */
  differenza: ImmagineRaster;
};

type Stato = { camera: CameraVerifica; parametri: ParametriAnnidati };

type Variabile = {
  nome: string;
  min: number;
  max: number;
  leggi: (stato: Stato) => number;
  scrivi: (stato: Stato, valore: number) => void;
};

type Geometria = { mesh: MeshPiatta | null; violazioni: number; prior: number; parametri: ParametriAnnidati };

const VALUTAZIONI = { camera: 40, parametri: 60, congiunta: 60 } as const;

/**
 * Valori imposti nelle costruzioni della verifica che non cambiano il contorno esterno ma costano tempo: nel tacco la
 * cavità (svuotato solo a iniezione), il perno e i fori della seduta stanno dentro la silhouette (−60 % del tempo di
 * `costruisci`). Il lato `coppia` diventa `dx`: la foto mostra un pezzo solo.
 */
export const SEMPLIFICAZIONI_SILHOUETTE: Readonly<
  Partial<Record<IdFamiglia, Readonly<Record<string, ValoreParametro>>>>
> = {
  tacco: { 'costruzione.processo': 'stampa_3d_resina', 'anima.diametro': 0, 'fori.numero': 0 },
};
const UNITA_OTTIMIZZABILI = new Set(['mm', 'deg', 'frazione', 'n']);

class Interruzione extends Error {}

/**
 * Le chiavi che la fase B muove per una famiglia: i parametri numerici marcati `silhouetteSensibile`, con limiti.
 * @param famiglia - Famiglia del registro.
 * @returns Definizioni dei parametri ottimizzabili.
 */
export function parametriSensibili(famiglia: FamigliaQualsiasi): DefinizioneParametro[] {
  return famiglia.parametri.filter(
    (definizione) =>
      definizione.silhouetteSensibile &&
      !definizione.derivato &&
      UNITA_OTTIMIZZABILI.has(definizione.unita) &&
      definizione.min !== undefined &&
      definizione.max !== undefined,
  );
}

const clona = <T>(valore: T): T => structuredClone(valore);

/**
 * Esegue la verifica: tre fasi di Nelder–Mead sulla silhouette della famiglia contro la maschera.
 * @param lib - Libreria SMLib (quella del worker).
 * @param ingresso - Famiglia, stima, vista, scala, maschera e opzioni.
 * @returns Parametri e camera ottimizzati, IoU, chamfer, fasi, tempi, silhouette e immagine differenza.
 */
export function verificaSilhouette(lib: typeof Smlib, ingresso: IngressoVerifica): EsitoVerifica {
  const famiglia = famiglie[ingresso.famiglia];
  if (!famiglia) {
    throw new RangeError(`Famiglia sconosciuta o non ancora realizzata: ${ingresso.famiglia}.`);
  }
  const opzioni = ingresso.opzioni ?? {};
  const adesso = opzioni.adesso ?? (() => performance.now());
  const inizio = adesso();
  const scadenza = inizio + (opzioni.budgetMs ?? 45_000);
  const variante = ingresso.variante;
  const valutazioniMassime = { ...VALUTAZIONI, ...opzioni.valutazioni };
  const iouCamera = opzioni.iouArresto?.camera ?? 0.95;
  const iouParametri = opzioni.iouArresto?.parametri ?? 0.985;
  const finestra = opzioni.ristagno?.finestra ?? 10;
  const sogliaRistagno = opzioni.ristagno?.soglia ?? 0.002;
  const { larghezza, altezza } = ingresso.maschera;
  const riferimento: ConfrontoMaschera = preparaConfronto(ingresso.maschera);
  const lato = Math.max(larghezza, altezza);

  // Stima normalizzata: la base di ogni valutazione (le chiavi non ottimizzate restano quelle del classificatore).
  const base = famiglia.normalizza(ingresso.stima.parametri, { variante }) as ParametriAnnidati;
  const verificaImposti: Record<string, ValoreParametro> = {
    ...SEMPLIFICAZIONI_SILHOUETTE[ingresso.famiglia],
    ...opzioni.parametriVerifica,
  };
  if (leggiParametro(base, 'costruzione.lato') === 'coppia' && !('costruzione.lato' in verificaImposti)) {
    verificaImposti['costruzione.lato'] = 'dx';
  }
  const definizioni = opzioni.chiavi
    ? famiglia.parametri.filter((definizione) => opzioni.chiavi!.includes(definizione.chiave))
    : parametriSensibili(famiglia);

  const scalaLibera = ingresso.scala.fonte === 'stima' || ingresso.scala.pxPerMm === null;
  let ricostruzioni = 0;
  let valutazioniTotali = 0;
  let interrotto = false;
  const cache = new Map<string, Geometria>();
  let tolleranza = 0.05;

  const geometria = (parametri: ParametriAnnidati): Geometria => {
    const chiave = JSON.stringify(parametri);
    const trovata = cache.get(chiave);
    if (trovata) {
      return trovata;
    }
    const violazioni = famiglia.vincoli(parametri).length;
    const normalizzati = famiglia.normalizza(parametri, { variante }) as ParametriAnnidati;
    const imposti = clona(normalizzati);
    for (const [percorso, valore] of Object.entries(verificaImposti)) {
      scriviParametro(imposti, percorso, valore);
    }
    const costruzione = famiglia.normalizza(imposti, { variante }) as ParametriAnnidati;
    let mesh: MeshPiatta | null = null;
    try {
      // Tutto ciò che il kernel crea qui (pezzi, intermedi, mesh) è liberato all'uscita: restano array JavaScript.
      mesh = lib.scope(() =>
        meshDaForme(
          lib,
          famiglia.costruisci(lib, costruzione, { variante }).map((pezzo) => pezzo.shape as Smlib.Shape),
          tolleranza,
        ),
      );
    } catch {
      mesh = null;
    }
    ricostruzioni++;
    const risultato: Geometria = {
      mesh,
      violazioni,
      prior: prior(normalizzati, ingresso.stima, definizioni),
      parametri: normalizzati,
    };
    if (cache.size >= 48) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(chiave, risultato);
    return risultato;
  };

  type Valutazione = { f: number; iou: number; chamferMm: number; silhouette: MascheraBinaria };
  const valuta = (stato: Stato): Valutazione => {
    const { mesh, violazioni, prior: termine } = geometria(stato.parametri);
    valutazioniTotali++;
    if (!mesh) {
      const vuota: MascheraBinaria = { larghezza, altezza, dati: new Uint8Array(larghezza * altezza) };
      return { f: 2 + violazioni * 0.2, iou: 0, chamferMm: lato / stato.camera.pxPerMm, silhouette: vuota };
    }
    if (sovracampionamento <= 1) {
      const silhouette = silhouetteMesh(mesh, stato.camera, { larghezza, altezza });
      const { iou, chamferMm } = confronta(silhouette, riferimento, stato.camera.pxPerMm);
      return { f: obiettivo({ iou, chamferMm, prior: termine, violazioni }), iou, chamferMm, silhouette };
    }
    // Obiettivo sull'IoU morbido (coperture frazionarie), soglie e risultato sull'IoU binario del §3.3.
    const morbida = silhouetteMeshMorbida(mesh, stato.camera, { larghezza, altezza, fattore: sovracampionamento });
    const silhouette: MascheraBinaria = { larghezza, altezza, dati: morbida.dati };
    const { iou, chamferMm } = confronta(silhouette, riferimento, stato.camera.pxPerMm);
    const iouF = iouMorbido(morbida.copertura, riferimento);
    return { f: obiettivo({ iou: iouF, chamferMm, prior: termine, violazioni }), iou, chamferMm, silhouette };
  };

  const controllaTempo = (): void => {
    if (opzioni.segnale?.aborted || adesso() > scadenza) {
      interrotto = true;
      throw new Interruzione();
    }
  };

  // Una fase: Nelder–Mead sulle variabili date, partendo dallo stato; ritorna lo stato migliore.
  const fase = (
    nome: NomeFase,
    stato: Stato,
    variabili: readonly Variabile[],
    massimo: number,
    sogliaIou: number,
    passo: number | number[],
    prepara?: (stato: Stato) => void,
  ): { stato: Stato; valutazione: Valutazione; esito: EsitoFase } => {
    const avvio = adesso();
    const daX = (x: readonly number[]): Stato => {
      const nuovo: Stato = { camera: { ...stato.camera }, parametri: clona(stato.parametri) };
      for (const [indice, variabile] of variabili.entries()) {
        variabile.scrivi(nuovo, variabile.min + x[indice]! * (variabile.max - variabile.min));
      }
      return nuovo;
    };
    const x0 = variabili.map((variabile) => (variabile.leggi(stato) - variabile.min) / (variabile.max - variabile.min));
    let migliore = { stato, valutazione: valuta(stato) };
    const storia: number[] = [migliore.valutazione.f];
    let motivo: EsitoFase['motivo'] = 'saltata';
    if (variabili.length > 0 && migliore.valutazione.iou < sogliaIou) {
      try {
        const risultato = nelderMead(
          (x) => {
            controllaTempo();
            const candidato = daX(x);
            prepara?.(candidato);
            const valutazione = valuta(candidato);
            if (valutazione.f < migliore.valutazione.f) {
              migliore = { stato: candidato, valutazione };
            }
            storia.push(migliore.valutazione.f);
            return valutazione.f;
          },
          x0,
          {
            valutazioniMassime: massimo,
            passo,
            arresto: ({ valutazioni }) =>
              migliore.valutazione.iou >= sogliaIou ||
              (valutazioni > variabili.length + 1 + Math.max(finestra, 2 * (variabili.length + 1)) &&
                storia.at(-1 - Math.max(finestra, 2 * (variabili.length + 1)))! - storia.at(-1)! < sogliaRistagno),
          },
        );
        motivo = risultato.motivo;
      } catch (error) {
        if (!(error instanceof Interruzione)) {
          throw error;
        }
        motivo = 'arresto';
      }
    }
    return {
      ...migliore,
      esito: {
        fase: nome,
        valutazioni: storia.length,
        f: migliore.valutazione.f,
        iou: migliore.valutazione.iou,
        ms: adesso() - avvio,
        motivo,
      },
    };
  };

  // Variabili della camera: angoli entro ±25°/±20°/±15° dalla vista di partenza dell'avvio (§3.4), centro ±15 % del
  // lato attorno alla camera corrente.
  const variabiliCamera = (
    camera: CameraVerifica,
    soloPiano = false,
    angoli: Pick<CameraVerifica, 'azimuth' | 'elevation' | 'rollo' | 'pxPerMm'> = camera,
  ): Variabile[] => {
    const deltaCentro = (0.15 * lato) / camera.pxPerMm;
    const variabili: Variabile[] = [
      {
        nome: 'azimuth',
        min: angoli.azimuth - 25,
        max: angoli.azimuth + 25,
        leggi: (s) => s.camera.azimuth,
        scrivi: (s, v) => {
          s.camera.azimuth = v;
        },
      },
      {
        nome: 'elevation',
        min: Math.max(-90, angoli.elevation - 20),
        max: Math.min(90, angoli.elevation + 20),
        leggi: (s) => s.camera.elevation,
        scrivi: (s, v) => {
          s.camera.elevation = v;
        },
      },
      {
        nome: 'rollo',
        min: angoli.rollo - 15,
        max: angoli.rollo + 15,
        leggi: (s) => s.camera.rollo,
        scrivi: (s, v) => {
          s.camera.rollo = v;
        },
      },
      {
        nome: 'cx',
        min: camera.cx - deltaCentro,
        max: camera.cx + deltaCentro,
        leggi: (s) => s.camera.cx,
        scrivi: (s, v) => {
          s.camera.cx = v;
        },
      },
      {
        nome: 'cy',
        min: camera.cy - deltaCentro,
        max: camera.cy + deltaCentro,
        leggi: (s) => s.camera.cy,
        scrivi: (s, v) => {
          s.camera.cy = v;
        },
      },
    ];
    if (scalaLibera) {
      variabili.push({
        nome: 'pxPerMm',
        min: angoli.pxPerMm * 0.75,
        max: angoli.pxPerMm * 1.25,
        leggi: (s) => s.camera.pxPerMm,
        scrivi: (s, v) => {
          s.camera.pxPerMm = v;
        },
      });
    }
    return soloPiano ? variabili.filter((variabile) => !['azimuth', 'elevation'].includes(variabile.nome)) : variabili;
  };

  const variabiliParametri: Variabile[] = definizioni.map((definizione) => ({
    nome: definizione.chiave,
    min: definizione.min!,
    max: definizione.max!,
    leggi: (s) => Number(leggiParametro(s.parametri, definizione.chiave)),
    scrivi: (s, v) => {
      scriviParametro(s.parametri, definizione.chiave, definizione.unita === 'n' ? Math.round(v) : v);
    },
  }));

  // Simplesso iniziale dei parametri: per le misure ±15 % del valore stimato (fra 2 % e 10 % dell'intervallo), per
  // angoli, frazioni e bombature 5 % dell'intervallo.
  const passiParametri = definizioni.map((definizione) => {
    if (opzioni.passoParametri !== undefined) {
      return opzioni.passoParametri;
    }
    const valore = Math.abs(Number(leggiParametro(base, definizione.chiave)));
    const intervallo = definizione.max! - definizione.min!;
    return definizione.unita === 'mm' && definizione.min! >= 0
      ? Math.min(0.1, Math.max(0.02, (0.15 * valore) / intervallo))
      : 0.05;
  });

  // Camera iniziale dai momenti: centro (e scala, se libera) che portano baricentro e area della silhouette su quelli
  // della maschera; rollo dall'asse principale se la vista è poco confidente.
  const momentiMaschera = momenti(ingresso.maschera, ingresso.maschera.valida);
  const allinea = (camera: CameraVerifica, mesh: MeshPiatta, rolloDaMomenti: boolean): CameraVerifica => {
    const allineata = { ...camera };
    if (rolloDaMomenti) {
      // Solo se entrambe le forme sono allungate (l'asse di una forma quasi tonda o quadrata è casuale) e la
      // correzione resta nei ±45° dello schema D2.
      const s0 = momenti(silhouetteMesh(mesh, allineata, { larghezza, altezza }));
      const allungata = (m: { semiassi: [number, number] }): boolean => m.semiassi[0] > 1.25 * m.semiassi[1];
      let delta = momentiMaschera.angoloAsse - s0.angoloAsse;
      delta = ((((delta + 90) % 180) + 180) % 180) - 90;
      if (allungata(s0) && allungata(momentiMaschera) && Math.abs(delta) <= 45) {
        allineata.rollo += delta;
      }
    }
    for (let giro = 0; giro < 2; giro++) {
      const s = momenti(silhouetteMesh(mesh, allineata, { larghezza, altezza }));
      if (s.area === 0) {
        break;
      }
      const xc = allineata.cx + (s.baricentro[0] - larghezza / 2) / allineata.pxPerMm;
      const yc = allineata.cy - (s.baricentro[1] - altezza / 2) / allineata.pxPerMm;
      if (scalaLibera) {
        allineata.pxPerMm *= Math.sqrt(momentiMaschera.area / s.area);
      }
      allineata.cx = xc - (momentiMaschera.baricentro[0] - larghezza / 2) / allineata.pxPerMm;
      allineata.cy = yc + (momentiMaschera.baricentro[1] - altezza / 2) / allineata.pxPerMm;
    }
    return allineata;
  };

  // Scala iniziale: quella dichiarata, o una stima grossolana che `allinea` corregge con le aree.
  let pxPerMmIniziale = ingresso.scala.pxPerMm ?? 1;
  tolleranza = tolleranzaPerPixel(pxPerMmIniziale);
  const fasi: EsitoFase[] = [];
  const avvii: EsitoVerifica['avvii'] = [];
  const confidenzaVista = ingresso.vista.confidenza ?? 0.5;
  const numeroAvvii =
    opzioni.avvii === 'auto' || opzioni.avvii === undefined ? (confidenzaVista < 0.5 ? 3 : 1) : opzioni.avvii;
  const azimutAvvii = [ingresso.vista.azimuth, ingresso.vista.azimuth + 180, -ingresso.vista.azimuth].slice(
    0,
    numeroAvvii,
  );

  const giriParametri = opzioni.giriParametri ?? 3;
  const sovracampionamento = opzioni.sovracampionamento ?? 4;
  const cameraNelPiano = opzioni.cameraFaseA === 'piano';
  // Simplesso iniziale della camera in unità fisiche: 3° di azimut e di elevazione, 2° di rollo, 2 px di centro,
  // 3 % di scala; `fattore` lo riduce nei riallineamenti.
  const passiCamera = (variabili: readonly Variabile[], camera: CameraVerifica, fattore = 1): number[] =>
    variabili.map((variabile) => {
      const fisico =
        variabile.nome === 'azimuth' || variabile.nome === 'elevation'
          ? 3
          : variabile.nome === 'rollo'
            ? 2
            : variabile.nome === 'pxPerMm'
              ? 0.03 * camera.pxPerMm
              : 2 / camera.pxPerMm;
      return (fattore * fisico) / (variabile.max - variabile.min);
    });

  // In B ogni geometria candidata si ricentra (baricentro sulla maschera): altrimenti un'altezza sbagliata si corregge
  // solo da un lato e la camera ferma tiene l'altro bordo fuori posto fino al riallineamento successivo.
  const centraParametri = opzioni.centraParametri ?? true;
  const ricentra = (stato: Stato): void => {
    const { mesh } = geometria(stato.parametri);
    if (!mesh) {
      return;
    }
    const s = momenti(silhouetteMesh(mesh, stato.camera, { larghezza, altezza }), riferimento.valida);
    if (s.area === 0) {
      return;
    }
    stato.camera.cx += (s.baricentro[0] - momentiMaschera.baricentro[0]) / stato.camera.pxPerMm;
    stato.camera.cy -= (s.baricentro[1] - momentiMaschera.baricentro[1]) / stato.camera.pxPerMm;
  };

  let corrente: { stato: Stato; valutazione: Valutazione } | undefined;
  // Camera di partenza dell'avvio scelto: i limiti degli angoli restano attorno a lei in tutte le fasi.
  let riferimento0: CameraVerifica | undefined;
  try {
    // Fase A, per ogni avvio.
    let meshStima = geometria(base).mesh;
    if (scalaLibera && meshStima) {
      // Scala ignota: prima stima dalle aree, poi la tessellazione si rifà con la tolleranza giusta (⅓ di pixel).
      const { azimuth, elevation, rollo } = ingresso.vista;
      const iniziale: CameraVerifica = { azimuth, elevation, rollo, pxPerMm: pxPerMmIniziale, cx: 0, cy: 0 };
      pxPerMmIniziale = allinea(iniziale, meshStima, false).pxPerMm;
      tolleranza = tolleranzaPerPixel(pxPerMmIniziale);
      cache.clear();
      meshStima = geometria(base).mesh;
    }
    for (const azimuth of azimutAvvii) {
      controllaTempo();
      let camera: CameraVerifica = {
        azimuth: ((((azimuth + 180) % 360) + 360) % 360) - 180,
        elevation: ingresso.vista.elevation,
        rollo: ingresso.vista.rollo,
        pxPerMm: pxPerMmIniziale,
        cx: 0,
        cy: 0,
      };
      if (meshStima) {
        camera = allinea(camera, meshStima, confidenzaVista < 0.5);
      }
      const variabili = variabiliCamera(camera, cameraNelPiano);
      const risultato = fase(
        'camera',
        { camera, parametri: clona(base) },
        variabili,
        valutazioniMassime.camera,
        iouCamera,
        passiCamera(variabili, camera),
      );
      fasi.push(risultato.esito);
      avvii.push({ azimuth: camera.azimuth, f: risultato.valutazione.f, iou: risultato.valutazione.iou });
      if (!corrente || risultato.valutazione.f < corrente.valutazione.f) {
        corrente = risultato;
        riferimento0 = camera;
      }
    }
    // Fase B a giri: parametri con la camera ferma, poi la camera si riallinea (costa solo proiezioni) e i parametri
    // ripartono con un simplesso dimezzato. Il riavvio rimedia al simplesso che si appiattisce con 8–10 variabili.
    const dopoCamera = corrente!.valutazione.f;
    for (let giro = 0; giro < giriParametri && !interrotto; giro++) {
      const prima = corrente!.valutazione.f;
      const risultatoB = fase(
        'parametri',
        corrente!.stato,
        variabiliParametri,
        valutazioniMassime.parametri,
        iouParametri,
        passiParametri.map((passo) => passo * 0.5 ** giro),
        centraParametri ? ricentra : undefined,
      );
      fasi.push(risultatoB.esito);
      corrente = risultatoB;
      if (
        interrotto ||
        prima - risultatoB.valutazione.f < sogliaRistagno ||
        risultatoB.valutazione.iou >= iouParametri
      ) {
        break;
      }
      const variabili = variabiliCamera(corrente.stato.camera, cameraNelPiano, riferimento0);
      const risultatoA = fase(
        'camera',
        corrente.stato,
        variabili,
        valutazioniMassime.camera,
        iouParametri,
        passiCamera(variabili, corrente.stato.camera, 0.5),
      );
      fasi.push(risultatoA.esito);
      corrente = risultatoA;
    }
    // Fase C: congiunta, solo se B è servita.
    if (!interrotto && dopoCamera - corrente!.valutazione.f > 0.01 && corrente!.valutazione.iou < iouParametri) {
      const variabiliC = variabiliCamera(corrente!.stato.camera, false, riferimento0);
      const variabili = [...variabiliC, ...variabiliParametri];
      const passi = [
        ...passiCamera(variabiliC, corrente!.stato.camera, 0.5),
        ...passiParametri.map((passo) => passo * 0.25),
      ];
      const risultatoC = fase(
        'congiunta',
        corrente!.stato,
        variabili,
        valutazioniMassime.congiunta,
        iouParametri,
        passi,
      );
      fasi.push(risultatoC.esito);
      corrente = risultatoC;
    }
  } catch (error) {
    if (!(error instanceof Interruzione)) {
      throw error;
    }
  }
  if (!corrente) {
    // Interrotta prima di qualsiasi fase: si valuta la stima così com'è.
    const camera: CameraVerifica = {
      azimuth: ingresso.vista.azimuth,
      elevation: ingresso.vista.elevation,
      rollo: ingresso.vista.rollo,
      pxPerMm: pxPerMmIniziale,
      cx: 0,
      cy: 0,
    };
    corrente = { stato: { camera, parametri: clona(base) }, valutazione: valuta({ camera, parametri: clona(base) }) };
  }
  const finale = geometria(corrente.stato.parametri);
  return {
    famiglia: ingresso.famiglia,
    ...(variante === undefined ? {} : { variante }),
    parametri: finale.parametri,
    camera: corrente.stato.camera,
    iou: corrente.valutazione.iou,
    chamferMm: corrente.valutazione.chamferMm,
    f: corrente.valutazione.f,
    chiaviOttimizzate: definizioni.map((definizione) => definizione.chiave),
    fasi,
    avvii,
    valutazioni: valutazioniTotali,
    ricostruzioni,
    tempoMs: adesso() - inizio,
    interrotto,
    silhouette: corrente.valutazione.silhouette,
    differenza: immagineDifferenza(corrente.valutazione.silhouette, riferimento),
  };
}
