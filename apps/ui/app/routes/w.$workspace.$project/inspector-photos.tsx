import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Camera, LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import type { SnapshotFrom } from 'xstate';
import { asKnownArtifact } from '@taucad/runtime';
import { Button } from '@taucad/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';
import { ToggleGroup, ToggleGroupItem } from '@taucad/ui/components/toggle-group';
import { cn } from '@taucad/ui/utils/cn';
import { randomUuid } from '@taucad/utils/id';
import { findPieceMaterial, pieceFinishes, pieceMaterials } from '@taucad/viewer/cad/piece-materials';
import type { PieceFinish, PieceMaterialId } from '@taucad/viewer/cad/piece-materials';
import { getModelInteractionUnitState } from '@taucad/viewer/machines/model-interaction.machine';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { useProject } from '#hooks/use-project.js';
import { useSinopiaCadLink } from '#hooks/use-sinopia-cad-sync.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { sinopiaCreatorUrl, sinopiaShootingUrl } from '#lib/sinopia-app-links.js';
import { takeSampleSectionRequest } from '#lib/sinopia-section-request.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import type { cadMachine } from '#machines/cad.machine.js';
import { chiaveFoto, fotoPronta, statiFoto, ultimePerChiave } from '#lib/foto-campione/galleria.js';
import type { FotoCampione, StatoFoto } from '#lib/foto-campione/galleria.js';
import { stessaForma } from '#lib/foto-campione/confronto.js';
import { improntaFoto, materialeNormale } from '#lib/foto-campione/impronta.js';
import type { LivelloFoto, MaterialeFoto } from '#lib/foto-campione/impronta.js';
import {
  codificaPngFoto,
  iouSagome,
  latoMappe,
  meshDaGlb,
  rendiMappe,
  sha256Foto,
  vistePhoto,
} from '#lib/foto-campione/mappe-condivise.js';
import type { MeshFoto, SagomaFoto, VistaFoto } from '#lib/foto-campione/mappe-condivise.js';
import { fotoDiProva } from '#lib/foto-campione/prova.js';
import { sagomaDaFoto, sogliaIouFoto } from '#lib/foto-campione/sagoma.js';
import { decodificaFoto } from '#services/foto-campione-immagini.js';
import {
  elencaFotoCampione,
  ErroreFoto,
  generaFotoCampione,
  leggiPrezziCad,
  scaricaFoto,
  versioneInviata,
} from '#services/sinopia-foto.js';
import type { CodiceErroreFoto, PrezzoCad } from '#services/sinopia-foto.js';

/**
 * «Foto del campione» in the inspector (SinopiaCAD D6): pick a view and a material (the piece's own, by default) and a
 * level, see the cost, make one photo. The photo shows the version sent to Sinopia: Sinopia renders the maps from that
 * version's GLB (the request carries no picture) and the photo lands among the project's images (Riepilogo, Shooting,
 * Lookbook). The CAD downloads the same GLB to know the fingerprint, to measure the photo's silhouette with the same
 * twin renderer and to see whether the model on screen is still that version. A changed measure or a new delivery turns
 * the photos grey («Da rifare»); nothing is made again by itself, a slider drag costs nothing.
 *
 * `?prova=foto` (development builds only) swaps Sinopia for a local stand-in: the model on screen plays the sent
 * version, no call, no credit.
 */

const selectRendering = (state: SnapshotFrom<typeof cadMachine> | undefined) => state?.context.rendering;
const selectBuilding = (state: SnapshotFrom<typeof cadMachine> | undefined): boolean =>
  state?.hasTag('cad-loading') ?? false;

const prezzoDi: Readonly<Record<LivelloFoto, PrezzoCad>> = { standard: 'cad_photo', fedele: 'cad_photo_fedele' };
const prezziDiProva: Partial<Record<PrezzoCad, number>> = { cad_photo: 2, cad_photo_fedele: 3, cad_recognize: 2 };

const messaggioErrore: Readonly<Partial<Record<CodiceErroreFoto, PlainMessageKey>>> = {
  CREDITS_NOT_CONFIGURED: 'fotoCampione.errors.creditsNotConfigured',
  CREDIT_COST_CHANGED: 'fotoCampione.errors.creditCostChanged',
  INSUFFICIENT_CREDITS: 'fotoCampione.errors.insufficientCredits',
  CAD_MODEL_NOT_FOUND: 'fotoCampione.errors.cadModelNotFound',
  CAD_VERSION_MISSING: 'fotoCampione.errors.versionMissing',
  CAD_MODEL_UNREADABLE: 'fotoCampione.errors.modelUnreadable',
  PHOTO_REFUSED: 'fotoCampione.errors.photoRefused',
  PROVIDER_SPEND_BLOCKED: 'fotoCampione.errors.levelPaused',
  RATE_LIMITED: 'fotoCampione.errors.rateLimited',
  BILLING_ACCOUNT_RESTRICTED: 'fotoCampione.errors.restricted',
  REQUEST_IN_PROGRESS: 'fotoCampione.errors.inProgress',
  AI_REQUEST_CONFLICT: 'fotoCampione.errors.conflict',
};

/**
 * Answers after which Sinopia refunded the request: its id cannot be used again. A network error or a failed close
 * («the photo is in the project») keep it, so the retry replays instead of charging twice.
 */
const rimborsata = (errore: ErroreFoto): boolean =>
  errore.codice === 'PHOTO_REFUSED' ||
  errore.codice === 'PROVIDER_SPEND_BLOCKED' ||
  (errore.codice === 'PROVIDER_UNAVAILABLE' && errore.stato === 502);

type Scelta = Readonly<{ vista: VistaFoto; materiale: MaterialeFoto; livello: LivelloFoto }>;
/** A photo being made or one that failed: it holds its slot in the gallery until the next attempt. */
type Transitoria = Scelta &
  Readonly<{ chiave: string; stato: 'in-corso' } | { chiave: string; stato: 'errore'; messaggio: PlainMessageKey }>;

/** The material a photo starts from: the selected piece's, else the first piece that has one, else brass. */
function useMaterialeDelPezzo(): MaterialeFoto {
  const { modelInteractionRef } = useProject();
  const { piece } = useInspectorSelection();
  const scelta = useSelector(modelInteractionRef, (state) => {
    const { context } = state;
    if (piece) {
      const propria = getModelInteractionUnitState(context, piece.unitId).materialByComponentId[piece.node.id];
      if (propria) {
        return `${propria.material}|${propria.finish ?? ''}`;
      }
    }
    for (const unitId of context.unitOrder) {
      const prima = Object.values(getModelInteractionUnitState(context, unitId).materialByComponentId).find(Boolean);
      if (prima) {
        return `${prima.material}|${prima.finish ?? ''}`;
      }
    }
    return 'brass|';
  });
  return useMemo(() => {
    const [id = 'brass', finitura] = scelta.split('|');
    return materialeNormale({
      id: id as PieceMaterialId,
      ...(finitura ? { finitura: finitura as PieceFinish } : {}),
    });
  }, [scelta]);
}

/**
 * The sample photo section of the inspector.
 *
 * @returns The section.
 */
export function InspectorPhotos(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { geometryUnits, mainEntryPath } = useProject();
  const cadRef = geometryUnits.get(mainEntryPath);
  const rendering = useSelector(cadRef, selectRendering);
  const isBuilding = useSelector(cadRef, selectBuilding);
  const session = useSinopiaSession();
  const link = useSinopiaCadLink();
  const queryClient = useQueryClient();
  const location = useLocation();
  const isTrial = import.meta.env.DEV && new URLSearchParams(location.search).get('prova') === 'foto';
  const userId = session.status === 'signed-in' ? session.user.id : undefined;

  // The committed model on screen (a slider being dragged renders transiently: it never counts).
  const glb = rendering?.success && !rendering.transient ? asKnownArtifact(rendering.artifact) : undefined;
  const modello = glb?.mimeType === 'model/gltf-binary' && rendering?.success ? rendering.hash : undefined;
  const contenuto = glb?.mimeType === 'model/gltf-binary' ? glb.content : undefined;

  const materialeDelPezzo = useMaterialeDelPezzo();
  const [vista, setVista] = useState<VistaFoto>('tre-quarti');
  const [materialeScelto, setMaterialeScelto] = useState<MaterialeFoto | undefined>(undefined);
  const materiale = materialeScelto ?? materialeDelPezzo;
  const [livello, setLivello] = useState<LivelloFoto>('standard');

  const prezzi = useQuery({
    queryKey: ['sinopia', 'prezzi-cad', userId],
    queryFn: async () => leggiPrezziCad(),
    enabled: !isTrial && userId !== undefined,
    staleTime: 60_000,
  });
  const listino = isTrial ? prezziDiProva : prezzi.data;
  const remote = useQuery({
    queryKey: ['sinopia', 'foto-campione', link?.modelId],
    queryFn: async () => elencaFotoCampione(link!),
    enabled: !isTrial && link !== undefined,
  });
  // The last version sent with a GLB: what the photo shows. A delivery made meanwhile shows up within half a minute.
  const consegna = useQuery({
    queryKey: ['sinopia', 'versione-inviata', link?.modelId],
    queryFn: async () => (await versioneInviata(link!)) ?? null,
    enabled: !isTrial && link !== undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const glbInviato = useQuery({
    queryKey: ['sinopia', 'glb-inviato', consegna.data?.glb.path],
    queryFn: async () => scaricaFoto(consegna.data!.glb),
    enabled: !isTrial && consegna.data !== undefined && consegna.data !== null,
    staleTime: Infinity,
  });
  const [locali, setLocali] = useState<FotoCampione[]>([]);
  const galleria = useMemo(
    () => ultimePerChiave(isTrial ? locali : (remote.data ?? [])),
    [isTrial, locali, remote.data],
  );
  // Sinopia's «Fai lo shooting» with no photo yet lands here: the section comes into view, once.
  const sezioneRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (link !== undefined && takeSampleSectionRequest(link.modelId.toLowerCase())) {
      sezioneRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [link]);

  const [transitorie, setTransitorie] = useState<ReadonlyMap<string, Transitoria>>(new Map());
  const [stati, setStati] = useState<ReadonlyMap<string, StatoFoto>>(new Map());
  const [iou, setIou] = useState<ReadonlyMap<string, number>>(new Map());
  const [miniature, setMiniature] = useState<ReadonlyMap<string, string>>(new Map());
  const [improntaCorrente, setImprontaCorrente] = useState<string | undefined>(undefined);
  /** The sent version as the photo sees it: the SHA-256 of its GLB and its mesh. */
  const [inviata, setInviata] = useState<Readonly<{ sha: string; mesh: MeshFoto }> | undefined>(undefined);
  /** Whether the screen still shows the sent version; `undefined` while it cannot be told. */
  const [schermoUguale, setSchermoUguale] = useState<boolean | undefined>(undefined);

  const meshSchermo = useRef<{ modello: string; mesh: MeshFoto } | undefined>(undefined);
  const sagome = useRef(new Map<string, SagomaFoto>());
  const pendenti = useRef(new Map<string, string>());
  const caricate = useRef(new Set<string>());
  const misurate = useRef(new Set<string>());
  const byteFoto = useRef(new Map<string, Uint8Array<ArrayBuffer>>());
  const vivo = useRef(true);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      for (const url of urls.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // The sent version's GLB → fingerprint and mesh (in the trial the model on screen plays the sent version).
  const byteInviati = isTrial ? contenuto : glbInviato.data;
  useEffect(() => {
    let attuale = true;
    if (byteInviati === undefined) {
      setInviata(undefined);
      return;
    }
    // async-iife: one digest and one parse per sent GLB; a GLB that cannot be read leaves the photo unavailable.
    void (async (): Promise<void> => {
      try {
        const sha = await sha256Foto(byteInviati);
        const mesh = meshDaGlb(byteInviati);
        if (attuale) {
          setInviata({ sha, mesh });
        }
      } catch (error) {
        console.error('Failed to read the sent GLB:', error);
        if (attuale) {
          setInviata(undefined);
        }
      }
    })();
    return () => {
      attuale = false;
    };
  }, [byteInviati]);

  // Is the model on screen still the sent version? Compared by shape (sizes, silhouette and depth at 256²).
  useEffect(() => {
    if (isTrial) {
      setSchermoUguale(true);
      return;
    }
    if (inviata === undefined || modello === undefined || contenuto === undefined) {
      setSchermoUguale(undefined);
      return;
    }
    try {
      if (meshSchermo.current?.modello !== modello) {
        meshSchermo.current = { modello, mesh: meshDaGlb(contenuto) };
      }
      setSchermoUguale(stessaForma(inviata.mesh, meshSchermo.current.mesh).stessa);
    } catch (error) {
      console.error('Failed to compare the model with the sent version:', error);
      setSchermoUguale(undefined);
    }
  }, [contenuto, inviata, isTrial, modello]);

  /** The silhouette of a view of the sent version (the twin renderer: the same Sinopia rendered the maps with). */
  const sagomaDi = useCallback(
    (perVista: VistaFoto): SagomaFoto | undefined => {
      if (inviata === undefined) {
        return undefined;
      }
      const chiave = `${inviata.sha}:${perVista}`;
      const nota = sagome.current.get(chiave);
      if (nota) {
        return nota;
      }
      const sagoma = rendiMappe(inviata.mesh, perVista, latoMappe).sagoma;
      sagome.current.set(chiave, sagoma);
      return sagoma;
    },
    [inviata],
  );

  // Each photo against the sent version and the screen: «Pronta» or «Da rifare».
  useEffect(() => {
    let attuale = true;
    void statiFoto(galleria, inviata?.sha, schermoUguale !== false).then((prossimi) => {
      if (attuale) {
        setStati(prossimi);
      }
    });
    return () => {
      attuale = false;
    };
  }, [galleria, inviata, schermoUguale]);

  // The fingerprint of the photo the button would ask for: the cache check.
  useEffect(() => {
    let attuale = true;
    if (inviata === undefined) {
      setImprontaCorrente(undefined);
      return;
    }
    void improntaFoto({ glb: inviata.sha, vista, materiale, livello }).then((impronta) => {
      if (attuale) {
        setImprontaCorrente(impronta);
      }
    });
    return () => {
      attuale = false;
    };
  }, [inviata, livello, materiale, vista]);

  // Thumbnails of the photos kept on Sinopia (one download each, kept for the silhouette check).
  useEffect(() => {
    for (const foto of galleria) {
      if (foto.sorgente.tipo !== 'storage' || caricate.current.has(foto.id)) {
        continue;
      }
      caricate.current.add(foto.id);
      const sorgente = foto.sorgente;
      // async-iife: one download per photo; a failure leaves the card without picture and says why in the console.
      void (async (): Promise<void> => {
        try {
          const bytes = await scaricaFoto(sorgente);
          const url = URL.createObjectURL(new Blob([bytes]));
          urls.current.push(url);
          if (!vivo.current) {
            return;
          }
          byteFoto.current.set(foto.id, bytes);
          setMiniature((prima) => new Map(prima).set(foto.id, url));
        } catch (error) {
          console.error('Failed to load a sample photo:', error);
        }
      })();
    }
  }, [galleria]);

  // The silhouette check of each photo that still shows the sent version (the maps of its view, made once).
  useEffect(() => {
    for (const foto of galleria) {
      const bytes = byteFoto.current.get(foto.id);
      if (stati.get(foto.id) !== 'pronta' || !bytes || iou.has(foto.id) || misurate.current.has(foto.id)) {
        continue;
      }
      misurate.current.add(foto.id);
      // async-iife: decode and compare; a photo that cannot be decoded keeps no measure.
      void (async (): Promise<void> => {
        try {
          const sagoma = sagomaDi(foto.vista);
          if (!sagoma) {
            return;
          }
          const valore = iouSagome(sagomaDaFoto(await decodificaFoto(bytes), sagoma.larghezza), sagoma);
          if (vivo.current) {
            setIou((prima) => new Map(prima).set(foto.id, valore));
          }
        } catch (error) {
          console.error('Failed to measure a sample photo:', error);
        }
      })();
    }
  }, [galleria, iou, miniature, sagomaDi, stati]);

  const genera = useCallback(
    async (scelta: Scelta): Promise<void> => {
      if (inviata === undefined) {
        return;
      }
      const materialeFoto = materialeNormale(scelta.materiale);
      const chiave = chiaveFoto(scelta);
      setTransitorie((prima) =>
        new Map(prima).set(chiave, { ...scelta, materiale: materialeFoto, chiave, stato: 'in-corso' }),
      );
      const fine = (prossima?: Transitoria): void => {
        if (!vivo.current) {
          return;
        }
        setTransitorie((prima) => {
          const mappa = new Map(prima);
          if (prossima) {
            mappa.set(chiave, prossima);
          } else {
            mappa.delete(chiave);
          }
          return mappa;
        });
      };
      let improntaChiesta: string | undefined;
      try {
        const impronta = await improntaFoto({ glb: inviata.sha, ...scelta, materiale: materialeFoto });
        improntaChiesta = impronta;
        if (isTrial) {
          // Let the card show before the stand-in takes the main thread for a moment.
          await new Promise((resolve) => {
            setTimeout(resolve, 900);
          });
          const mappe = rendiMappe(inviata.mesh, scelta.vista, latoMappe);
          const immagine = fotoDiProva(mappe, materialeFoto, scelta.livello);
          const bytes = await codificaPngFoto(immagine);
          const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
          urls.current.push(url);
          const id = randomUuid();
          if (!vivo.current) {
            return;
          }
          setMiniature((prima) => new Map(prima).set(id, url));
          setIou((prima) => new Map(prima).set(id, iouSagome(sagomaDaFoto(immagine, mappe.lato), mappe.sagoma)));
          setLocali((prima) => [
            ...prima,
            {
              id,
              ...scelta,
              materiale: materialeFoto,
              impronta,
              creata: Date.now(),
              sorgente: { tipo: 'url', url },
              aiAct: 'ai-generated',
            },
          ]);
          fine();
          return;
        }
        if (!link || !consegna.data) {
          throw new ErroreFoto(link ? 'CAD_VERSION_MISSING' : 'CAD_MODEL_NOT_FOUND', 0, 'No sent version');
        }
        const costo = listino?.[prezzoDi[scelta.livello]];
        if (costo === undefined) {
          throw new ErroreFoto('CREDITS_NOT_CONFIGURED', 0, 'No price');
        }
        // The same fingerprint retried after a lost answer keeps its request id: Sinopia replays it, it does not charge twice.
        const requestId = pendenti.current.get(impronta) ?? randomUuid();
        pendenti.current.set(impronta, requestId);
        const esito = await generaFotoCampione({
          requestId,
          maxCreditCost: costo,
          cadModelId: link.modelId,
          versionNumber: consegna.data.versionNumber,
          vista: scelta.vista,
          materiale: materialeFoto,
          livello: scelta.livello,
        });
        pendenti.current.delete(impronta);
        if (esito.impronta !== impronta) {
          // Sinopia rendered a different GLB than the one read here (a delivery in between): the gallery will say so.
          console.warn('Sample photo: Sinopia fingerprinted another GLB', esito.versionNumber);
          void queryClient.invalidateQueries({ queryKey: ['sinopia', 'versione-inviata', link.modelId] });
        }
        await queryClient.invalidateQueries({ queryKey: ['sinopia', 'foto-campione', link.modelId] });
        console.info('Sample photo saved in Sinopia:', esito.assetId, esito.replayed ? '(replayed)' : '');
        fine();
      } catch (error) {
        console.error('Sample photo failed:', error);
        if (
          error instanceof ErroreFoto &&
          (error.codice === 'AI_REQUEST_CONFLICT' || error.codice === 'CREDIT_COST_CHANGED')
        ) {
          pendenti.current.clear();
          void queryClient.invalidateQueries({ queryKey: ['sinopia', 'prezzi-cad'] });
        } else if (improntaChiesta !== undefined && error instanceof ErroreFoto && rimborsata(error)) {
          // Refunded: the request id is spent on Sinopia's side, the next click needs a new one.
          pendenti.current.delete(improntaChiesta);
        }
        if (error instanceof ErroreFoto && error.codice === 'CAD_VERSION_MISSING' && link) {
          void queryClient.invalidateQueries({ queryKey: ['sinopia', 'versione-inviata', link.modelId] });
        }
        fine({
          ...scelta,
          materiale: materialeFoto,
          chiave,
          stato: 'errore',
          messaggio:
            (error instanceof ErroreFoto ? messaggioErrore[error.codice] : undefined) ?? 'fotoCampione.errors.generic',
        });
      }
    },
    [consegna.data, inviata, isTrial, link, listino, queryClient],
  );

  const pronta = fotoPronta(
    galleria.filter((foto) => stati.get(foto.id) === 'pronta'),
    improntaCorrente,
  );
  const costo = listino?.[prezzoDi[livello]];
  const inCorso = transitorie.get(chiaveFoto({ vista, materiale, livello }))?.stato === 'in-corso';
  const collegato = isTrial || (userId !== undefined && link !== undefined);
  const prezzoInLettura = !isTrial && prezzi.isPending && userId !== undefined;

  const versioneInLettura = !isTrial && link !== undefined && (consegna.isPending || glbInviato.isPending);
  const motivo: PlainMessageKey | undefined =
    !isTrial && userId === undefined
      ? 'fotoCampione.signedOut'
      : !isTrial && link === undefined
        ? 'fotoCampione.unlinked'
        : !isTrial && consegna.isError
          ? 'fotoCampione.versionUnreadable'
          : !isTrial && consegna.data === null
            ? 'fotoCampione.notDelivered'
            : versioneInLettura
              ? 'fotoCampione.versionLoading'
              : !isTrial && glbInviato.isError
                ? 'fotoCampione.versionUnreadable'
                : modello === undefined
                  ? isBuilding
                    ? 'fotoCampione.modelBuilding'
                    : 'fotoCampione.noModel'
                  : inviata === undefined
                    ? 'fotoCampione.versionLoading'
                    : schermoUguale === false
                      ? 'fotoCampione.changedSinceDelivery'
                      : prezzoInLettura
                        ? 'fotoCampione.priceLoading'
                        : costo === undefined
                          ? 'fotoCampione.priceMissing'
                          : pronta
                            ? 'fotoCampione.alreadyReady'
                            : undefined;
  const isDisabled = motivo !== undefined || inCorso;

  const definito = findPieceMaterial(materiale.id);
  const transitorieSenzaFoto = [...transitorie.values()];
  const nomeMateriale = (voce: MaterialeFoto): string =>
    `${t(`materials.names.${voce.id}`)}${voce.finitura ? ` · ${t(`materials.finishes.${voce.finitura}`)}` : ''}`;
  const percentuale = (valore: number): string => formatNumber(valore * 100, language, { maximumFractionDigits: 0 });

  return (
    <section
      ref={sezioneRef}
      aria-label={t('fotoCampione.title')}
      className='border-t border-border px-4 pt-3 pb-4'
      data-slot='inspector-photos'
      data-modello={modello}
      data-glb={inviata?.sha}
      data-stesso-modello={schermoUguale === undefined ? undefined : String(schermoUguale)}
    >
      <Eyebrow as='h3'>{t('fotoCampione.title')}</Eyebrow>
      <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>{t('fotoCampione.hint')}</p>
      {!isTrial && consegna.data ? (
        <p className='mt-1 text-[11px] leading-4 text-titanium-foreground' data-slot='sample-photo-version'>
          {t('fotoCampione.version', { number: consegna.data.versionNumber })}
        </p>
      ) : null}
      {isTrial ? (
        <p className='mt-1 text-[11px] leading-4 text-titanium-foreground'>{t('fotoCampione.trial')}</p>
      ) : null}

      <div className='mt-3 space-y-2.5'>
        <div className='space-y-1'>
          <span className='text-xs text-muted-foreground'>{t('fotoCampione.view')}</span>
          <ToggleGroup
            type='single'
            variant='outline'
            size='sm'
            aria-label={t('fotoCampione.view')}
            className='grid w-full grid-cols-3'
            value={vista}
            onValueChange={(valore) => {
              if (valore) {
                setVista(valore as VistaFoto);
              }
            }}
          >
            {vistePhoto.map((voce) => (
              <ToggleGroupItem
                key={voce}
                value={voce}
                className='text-xs data-[state=on]:border-titanium data-[state=on]:text-foreground'
              >
                {t(`fotoCampione.views.${voce}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className='space-y-1'>
          <span className='text-xs text-muted-foreground'>{t('fotoCampione.material')}</span>
          <div className='flex min-w-0 items-center gap-1.5'>
            <Select
              size='sm'
              value={materiale.id}
              onValueChange={(valore) => {
                setMaterialeScelto(
                  materialeNormale({
                    id: valore as PieceMaterialId,
                    ...(materiale.finitura ? { finitura: materiale.finitura } : {}),
                  }),
                );
              }}
            >
              <SelectTrigger className='min-w-0 flex-1 text-xs' aria-label={t('fotoCampione.material')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position='popper'>
                {pieceMaterials.map(({ id }) => (
                  <SelectItem key={id} value={id}>
                    {t(`materials.names.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {definito?.kind === 'metal' ? (
              <Select
                size='sm'
                value={materiale.finitura ?? 'polished'}
                onValueChange={(valore) => {
                  setMaterialeScelto({ id: materiale.id, finitura: valore as PieceFinish });
                }}
              >
                <SelectTrigger className='w-24 shrink-0 text-xs' aria-label={t('fotoCampione.finish')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position='popper'>
                  {pieceFinishes.map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(`materials.finishes.${id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <div className='space-y-1'>
          <span className='text-xs text-muted-foreground'>{t('fotoCampione.level')}</span>
          <ToggleGroup
            type='single'
            variant='outline'
            size='sm'
            aria-label={t('fotoCampione.level')}
            className='grid w-full grid-cols-2'
            value={livello}
            onValueChange={(valore) => {
              if (valore) {
                setLivello(valore as LivelloFoto);
              }
            }}
          >
            {(['standard', 'fedele'] as const).map((voce) => {
              const senzaPrezzo = listino !== undefined && listino[prezzoDi[voce]] === undefined;
              return (
                <ToggleGroupItem
                  key={voce}
                  value={voce}
                  disabled={senzaPrezzo && voce === 'fedele'}
                  className='gap-1 text-xs data-[state=on]:border-titanium data-[state=on]:text-foreground'
                >
                  {t(`fotoCampione.levels.${voce}`)}
                  {senzaPrezzo && voce === 'fedele' ? (
                    <span className='font-mono text-[10px] text-muted-foreground'>{t('fotoCampione.comingSoon')}</span>
                  ) : null}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          <p className='text-[11px] leading-4 text-muted-foreground'>{t(`fotoCampione.levelHints.${livello}`)}</p>
        </div>

        <Button
          className='w-full'
          disabled={isDisabled}
          onClick={() => {
            void genera({ vista, materiale, livello });
          }}
        >
          {inCorso ? (
            <LoaderCircle aria-hidden className='size-4 animate-spin' />
          ) : (
            <Camera aria-hidden className='size-4' />
          )}
          {inCorso
            ? t('fotoCampione.generating')
            : costo === undefined
              ? t('fotoCampione.title')
              : costo === 1
                ? t('fotoCampione.generateOne')
                : t('fotoCampione.generate', { cost: costo })}
        </Button>
        {motivo ? (
          <p className='text-[11px] leading-4 text-muted-foreground' role='status'>
            {t(motivo)}
          </p>
        ) : null}
      </div>

      {galleria.length > 0 || transitorieSenzaFoto.length > 0 ? (
        <div className='mt-4'>
          <Eyebrow as='h3'>{t('fotoCampione.gallery')}</Eyebrow>
          <ul className='mt-2 grid grid-cols-2 gap-2'>
            {transitorieSenzaFoto.map((voce) => (
              <li key={`t:${voce.chiave}`} className='min-w-0' data-slot='sample-photo' data-state={voce.stato}>
                <div
                  className={cn(
                    'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-md border bg-background p-2 text-center',
                    voce.stato === 'errore' ? 'border-destructive/60' : 'border-dashed border-titanium',
                  )}
                >
                  {voce.stato === 'in-corso' ? (
                    <>
                      <LoaderCircle aria-hidden className='size-5 animate-spin text-titanium-foreground' />
                      <span className='text-[11px] leading-4 text-muted-foreground'>
                        {t('fotoCampione.generating')}
                      </span>
                    </>
                  ) : (
                    <>
                      <TriangleAlert aria-hidden className='size-4 text-destructive' />
                      <span className='text-[11px] leading-4 text-muted-foreground'>{t(voce.messaggio)}</span>
                    </>
                  )}
                </div>
                <CardCaption
                  stato={voce.stato}
                  testo={`${t(`fotoCampione.views.${voce.vista}`)} · ${t(`fotoCampione.levels.${voce.livello}`)}`}
                  materiale={nomeMateriale(voce.materiale)}
                  statoTesto={t(`fotoCampione.states.${voce.stato}`)}
                />
                {voce.stato === 'errore' ? (
                  <Button
                    variant='ghost'
                    size='xs'
                    className='mt-0.5 -ml-2'
                    disabled={inviata === undefined || schermoUguale === false}
                    onClick={() => {
                      void genera(voce);
                    }}
                  >
                    <RotateCcw aria-hidden />
                    {t('fotoCampione.retry')}
                  </Button>
                ) : null}
              </li>
            ))}
            {galleria
              .filter((foto) => !transitorie.has(chiaveFoto(foto)))
              .map((foto) => {
                const stato = stati.get(foto.id);
                const url = foto.sorgente.tipo === 'url' ? foto.sorgente.url : miniature.get(foto.id);
                const valore = stato === 'pronta' ? iou.get(foto.id) : undefined;
                const sotto = valore !== undefined && valore < sogliaIouFoto;
                return (
                  <li key={foto.id} className='min-w-0' data-slot='sample-photo' data-state={stato ?? 'unknown'}>
                    <a
                      href={url}
                      target='_blank'
                      rel='noreferrer'
                      aria-label={t('fotoCampione.open')}
                      className='relative block aspect-square overflow-hidden rounded-md border border-border bg-background'
                    >
                      {url ? (
                        <img
                          src={url}
                          alt=''
                          className={cn('size-full object-cover', stato === 'da-rifare' && 'opacity-45 grayscale')}
                        />
                      ) : null}
                      <span
                        className='absolute right-1 bottom-1 rounded-sm bg-black/55 px-1 font-mono text-[10px] leading-4 text-white'
                        title={t('fotoCampione.aiLabel')}
                      >
                        AI
                      </span>
                    </a>
                    <CardCaption
                      stato={stato}
                      testo={`${t(`fotoCampione.views.${foto.vista}`)} · ${t(`fotoCampione.levels.${foto.livello}`)}`}
                      materiale={nomeMateriale(foto.materiale)}
                      statoTesto={stato ? t(`fotoCampione.states.${stato}`) : undefined}
                      {...(stato === 'da-rifare' ? { nota: t('fotoCampione.staleHint') } : {})}
                    />
                    {valore === undefined ? null : (
                      <p
                        className={cn(
                          'flex items-start gap-1 text-[11px] leading-4 tabular-nums',
                          sotto ? 'text-warning' : 'text-muted-foreground',
                        )}
                        title={t('fotoCampione.iouHint')}
                      >
                        {sotto ? <TriangleAlert aria-hidden className='mt-0.5 size-3 shrink-0' /> : null}
                        {sotto
                          ? t('fotoCampione.iouWarning', { value: percentuale(valore) })
                          : t('fotoCampione.iou', { value: percentuale(valore) })}
                      </p>
                    )}
                    <Button
                      variant='ghost'
                      size='xs'
                      className='mt-0.5 -ml-2'
                      disabled={
                        inviata === undefined ||
                        schermoUguale === false ||
                        listino?.[prezzoDi[foto.livello]] === undefined
                      }
                      onClick={() => {
                        void genera(foto);
                      }}
                    >
                      <RotateCcw aria-hidden />
                      {t('fotoCampione.regenerate')}
                    </Button>
                  </li>
                );
              })}
          </ul>
        </div>
      ) : collegato && inviata !== undefined ? (
        <p className='mt-3 text-[11px] leading-4 text-muted-foreground'>{t('fotoCampione.empty')}</p>
      ) : null}
      {!isTrial && link ? (
        <ContinuaSuSinopia
          projectId={link.projectId}
          modelId={link.modelId}
          ultimaFoto={galleria.find((foto) => foto.sorgente.tipo === 'storage')?.id}
        />
      ) : null}
    </section>
  );
}

/**
 * The two gestures that continue on Sinopia (one-way: Sinopia never changes the model): «Porta nel Creator» puts the
 * newest sample photo (or the model's render) on the project's canvas; «Fai lo shooting» opens the Shooting Studio with
 * that photo already chosen, or, with no photo yet, says to make one here first.
 */
function ContinuaSuSinopia({
  projectId,
  modelId,
  ultimaFoto,
}: Readonly<{ projectId: string; modelId: string; ultimaFoto: string | undefined }>): React.JSX.Element {
  const { t } = useTranslation();
  const creator = sinopiaCreatorUrl(projectId, modelId);
  const shooting = ultimaFoto === undefined ? undefined : sinopiaShootingUrl(projectId, ultimaFoto, modelId);
  return (
    <div className='mt-4 space-y-2 border-t border-border pt-3' data-slot='continue-on-sinopia'>
      <Eyebrow as='p'>{t('fotoCampione.continua.title')}</Eyebrow>
      <div className='flex flex-wrap gap-2'>
        {creator ? (
          <Button asChild variant='outline' size='sm' title={t('fotoCampione.continua.creatorHint')}>
            <a href={creator}>
              <Sparkles aria-hidden />
              {t('fotoCampione.continua.creator')}
            </a>
          </Button>
        ) : null}
        {shooting ? (
          <Button asChild variant='outline' size='sm' title={t('fotoCampione.continua.shootingHint')}>
            <a href={shooting}>
              <Camera aria-hidden />
              {t('fotoCampione.continua.shooting')}
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        ) : (
          <Button variant='outline' size='sm' disabled aria-describedby='shooting-serve-foto'>
            <Camera aria-hidden />
            {t('fotoCampione.continua.shooting')}
          </Button>
        )}
      </div>
      {shooting ? null : (
        <p id='shooting-serve-foto' className='text-[11px] leading-4 text-muted-foreground'>
          {t('fotoCampione.continua.shootingFirst')}
        </p>
      )}
    </div>
  );
}

/** Under a photo: its state as a small chip, then view · level, then the material. */
function CardCaption({
  stato,
  statoTesto,
  testo,
  materiale,
  nota,
}: Readonly<{
  stato: StatoFoto | 'in-corso' | 'errore' | undefined;
  statoTesto: string | undefined;
  testo: string;
  materiale: string;
  nota?: string;
}>): React.JSX.Element {
  return (
    <div className='mt-1 min-w-0'>
      {statoTesto ? (
        <span
          className={cn(
            'inline-block rounded-full border px-1.5 font-mono text-[10px] leading-4 tracking-[0.08em] uppercase',
            stato === 'pronta' && 'border-titanium text-titanium-foreground',
            stato === 'da-rifare' && 'border-border bg-muted text-muted-foreground',
            stato === 'errore' && 'border-destructive/60 text-destructive',
            stato === 'in-corso' && 'border-dashed border-titanium text-titanium-foreground',
          )}
          title={nota}
        >
          {statoTesto}
        </span>
      ) : null}
      <p className='mt-0.5 truncate text-[11px] leading-4' title={testo}>
        {testo}
      </p>
      <p className='truncate text-[11px] leading-4 text-muted-foreground' title={materiale}>
        {materiale}
      </p>
    </div>
  );
}
