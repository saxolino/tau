import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ImageIcon, Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useOptionalFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { useCadViewport } from '#hooks/use-cad-viewport.js';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { leggiRiferimentiProgetto } from '#services/riferimenti-progetto.js';
import type { RiferimentiLetti, RiferimentoProgetto } from '#services/riferimenti-progetto.js';
import { readSinopiaProjectName } from '#services/sinopia-references.js';
import { useWorkspaceLanes } from '#routes/w.$workspace.$project/project-workspace-context.js';

/**
 * Il riferimento nel riquadro 3D: se il modello nasce da un'immagine (la foto riconosciuta, un'immagine di Sinopia o una
 * caricata), un pulsante piccolo nella barra del riquadro, con la miniatura dell'immagine, apre un pannello accanto al
 * modello per confrontarli. Il pannello non è modale: il modello resta girabile sotto. Si chiude con lo stesso pulsante,
 * con la X o con Esc. Senza immagini il pulsante non c'è.
 */

/** Lo stato condiviso fra il pulsante (nella barra) e il pannello (sopra il riquadro). */
export type RiferimentoVisore = Readonly<{
  riferimenti: readonly RiferimentoProgetto[];
  /** Le immagini già lette, per percorso: object URL validi finché il visore resta aperto sul progetto. */
  urls: Readonly<Record<string, string>>;
  /** I percorsi che non si riescono a leggere. */
  illeggibili: ReadonlySet<string>;
  progettoSinopia: RiferimentiLetti['progettoSinopia'];
  isOpen: boolean;
  indice: number;
  isLarge: boolean;
  toggle: () => void;
  close: (options?: { restoreFocus?: boolean }) => void;
  setIndice: (indice: number) => void;
  setLarge: (isLarge: boolean) => void;
  // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- required by React
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}>;

const vuoto: RiferimentiLetti = { riferimenti: [] };

/** Le famiglie dei pezzi piatti: la faccia `sopra` è la faccia a vista («di fronte»), il fianco è il bordo («di taglio»). */
const pezziPiatti: ReadonlySet<string> = new Set(['fibbia', 'placca', 'pendente', 'borchia', 'occhiello']);

/** Le parole di ogni faccia nella didascalia di una vista generata. */
const parolaFaccia: Readonly<Record<string, PlainMessageKey>> = {
  fianco_esterno: 'riferimento.faces.fianco',
  fianco_interno: 'riferimento.faces.fiancoInterno',
  dietro: 'riferimento.faces.dietro',
  davanti: 'riferimento.faces.davanti',
  sopra: 'riferimento.faces.sopra',
  sotto: 'riferimento.faces.sotto',
  asse_dito: 'riferimento.faces.fronte',
  tre_quarti_pietra: 'riferimento.faces.treQuarti',
};

/**
 * La didascalia di una vista generata: il ruolo e da dove guarda («Vista principale · di fianco»).
 *
 * @param t - La traduzione.
 * @param vista - Ruolo, faccia e famiglia della vista.
 * @returns Il testo.
 */
function testoVista(t: (chiave: PlainMessageKey) => string, vista: NonNullable<RiferimentoProgetto['vista']>): string {
  const ruolo = t(vista.ruolo === 'principale' ? 'riferimento.views.principale' : 'riferimento.views.controllo');
  const piatto = vista.famiglia !== undefined && pezziPiatti.has(vista.famiglia);
  const chiave =
    piatto && vista.faccia === 'sopra'
      ? 'riferimento.faces.fronte'
      : piatto && vista.faccia === 'fianco_esterno'
        ? 'riferimento.faces.taglio'
        : vista.faccia === undefined
          ? undefined
          : parolaFaccia[vista.faccia];
  return chiave ? `${ruolo} · ${t(chiave)}` : ruolo;
}
const nessuno: ReadonlySet<string> = new Set();

/**
 * Legge i riferimenti del progetto aperto e tiene lo stato del pannello. La cartella si rilegge a ogni apertura, così
 * un'immagine aggiunta dopo si vede; le immagini si leggono solo quando servono: la prima per la miniatura del
 * pulsante, la corrente (e la sua maschera) a pannello aperto.
 *
 * @param isEnabled - Falso dove il riferimento non si offre (la vista condivisa in sola lettura).
 * @returns Lo stato per il pulsante e il pannello.
 */
export function useRiferimentoVisore(isEnabled: boolean): RiferimentoVisore {
  const { projectId } = useProject();
  // Optional, as the file tree is: a viewer drawn outside a file manager (a preview, a test) simply has no reference.
  const recordFiles = useOptionalFileManager()?.recordFiles;
  const radice = `/projects/${projectId}`;
  const [letti, setLetti] = useState<RiferimentiLetti>(vuoto);
  const [lettura, setLettura] = useState(0);
  const [isOpen, setOpen] = useState(false);
  const [indice, setIndice] = useState(0);
  const [isLarge, setLarge] = useState(false);
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  const [illeggibili, setIlleggibili] = useState<ReadonlySet<string>>(nessuno);
  // The object URLs belong to one project: a reading still in flight for the previous one must not land in this one.
  const creati = useRef<{ radice: string; mappa: Map<string, string> }>({ radice, mappa: new Map() });
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isEnabled || !recordFiles) {
      return undefined;
    }
    const corsa = { viva: true };
    // async-iife: bootstrap -- the folder is read again at each opening; an unreadable folder shows no button.
    void (async (): Promise<void> => {
      try {
        const nuovi = await leggiRiferimentiProgetto(recordFiles, radice);
        if (corsa.viva) {
          // The same folder read again keeps its state: the whole viewer does not render again for nothing.
          setLetti((attuali) => (JSON.stringify(attuali) === JSON.stringify(nuovi) ? attuali : nuovi));
        }
      } catch (error) {
        console.error('Failed to read the project references:', error, { lettura });
      }
    })();
    return () => {
      corsa.viva = false;
    };
  }, [isEnabled, lettura, radice, recordFiles]);

  // Another project in the same viewer: its images are other files.
  useEffect(() => {
    const voce = creati.current.radice === radice ? creati.current : { radice, mappa: new Map<string, string>() };
    creati.current = voce;
    return () => {
      for (const url of voce.mappa.values()) {
        if (url) {
          URL.revokeObjectURL(url);
        }
      }
      voce.mappa.clear();
      setUrls({});
      setIlleggibili(nessuno);
      setLetti(vuoto);
      setOpen(false);
      setIndice(0);
    };
  }, [radice]);

  const carica = useCallback(
    async (percorso: string, tipo: string): Promise<void> => {
      const voce = creati.current;
      if (!recordFiles || voce.radice !== radice || voce.mappa.has(percorso)) {
        return;
      }
      voce.mappa.set(percorso, '');
      try {
        const bytes = await recordFiles.readFile(`${radice}/${percorso}`);
        const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
        if (creati.current !== voce || voce.mappa.get(percorso) !== '') {
          URL.revokeObjectURL(url);
          return;
        }
        voce.mappa.set(percorso, url);
        setUrls((attuali) => ({ ...attuali, [percorso]: url }));
      } catch (error) {
        console.error('Failed to read a reference image:', error, { percorso });
        voce.mappa.delete(percorso);
        if (creati.current !== voce) {
          return;
        }
        setIlleggibili((attuali) => new Set([...attuali, percorso]));
      }
    },
    [radice, recordFiles],
  );

  const { riferimenti } = letti;
  const primo = riferimenti[0];
  const corrente = riferimenti[Math.min(indice, Math.max(0, riferimenti.length - 1))];
  // Keyed by the paths, not the objects: re-reading the folder at each opening gives new objects for the same files.
  const primoPercorso = primo?.percorso;
  const primoTipo = primo?.tipo;
  useEffect(() => {
    if (primoPercorso !== undefined && primoTipo !== undefined) {
      // async-iife: bootstrap -- the button's thumbnail, read once per file and kept while the project is open.
      void (async (): Promise<void> => {
        await carica(primoPercorso, primoTipo);
      })();
    }
  }, [carica, primoPercorso, primoTipo]);
  const correntePercorso = isOpen ? corrente?.percorso : undefined;
  const correnteTipo = corrente?.tipo;
  const correnteMaschera = isOpen ? corrente?.maschera : undefined;
  useEffect(() => {
    // async-iife: bootstrap -- the open picture and its mask, read once per file and kept while the project is open.
    void (async (): Promise<void> => {
      await Promise.all([
        correntePercorso !== undefined && correnteTipo !== undefined
          ? carica(correntePercorso, correnteTipo)
          : undefined,
        correnteMaschera === undefined ? undefined : carica(correnteMaschera, 'image/png'),
      ]);
    })();
  }, [carica, correnteMaschera, correntePercorso, correnteTipo]);

  const toggle = useCallback(() => {
    if (!isOpen) {
      setLettura((numero) => numero + 1);
    }
    setOpen(!isOpen);
  }, [isOpen]);
  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    setOpen(false);
    if (options?.restoreFocus) {
      toggleRef.current?.focus();
    }
  }, []);

  return {
    riferimenti,
    urls,
    illeggibili,
    progettoSinopia: letti.progettoSinopia,
    isOpen: isOpen && riferimenti.length > 0,
    indice: Math.min(indice, Math.max(0, riferimenti.length - 1)),
    isLarge,
    toggle,
    close,
    setIndice,
    setLarge,
    toggleRef,
  };
}

/**
 * Il pulsante nella barra del riquadro: la miniatura dell'immagine (in grigio a riposo, a colori al passaggio e a
 * pannello aperto). Non c'è se il modello non ha un riferimento.
 *
 * @param props - Lo stato del riferimento.
 * @returns Il pulsante, o niente.
 */
export function ViewerReferenceToggle({ riferimento }: Readonly<{ riferimento: RiferimentoVisore }>): React.ReactNode {
  const { t } = useTranslation();
  const { riferimenti, urls, isOpen, toggle, close, toggleRef } = riferimento;
  const primo = riferimenti[0];
  if (!primo) {
    return null;
  }
  const miniatura = urls[primo.percorso];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={toggleRef}
          variant='ghost'
          size='icon-sm'
          aria-label={t('riferimento.name')}
          aria-pressed={isOpen}
          data-active={isOpen}
          data-slot='viewer-reference-toggle'
          className='group/riferimento data-[active=true]:bg-accent'
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isOpen) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          {miniatura ? (
            <img
              src={miniatura}
              alt=''
              draggable={false}
              className='size-4.5 rounded-xs object-cover opacity-65 ring-1 ring-border grayscale transition-[opacity,filter] duration-150 ease-out group-hover/riferimento:opacity-100 group-hover/riferimento:grayscale-0 group-data-[active=true]/riferimento:opacity-100 group-data-[active=true]/riferimento:grayscale-0'
            />
          ) : (
            <ImageIcon aria-hidden='true' className='size-4' />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isOpen ? t('riferimento.hide') : t('riferimento.show')}</TooltipContent>
    </Tooltip>
  );
}

/** Da dove viene l'immagine, sotto l'immagine; il testo intero al passaggio quando non ci sta. */
function Didascalia({ testo }: Readonly<{ testo: string }>): React.JSX.Element {
  return (
    <figcaption className='truncate px-1.5 pt-1 pb-0.5 text-xs text-muted-foreground' title={testo}>
      {testo}
    </figcaption>
  );
}

/**
 * La didascalia di un'immagine scelta da Sinopia: col nome del progetto Sinopia del modello, letto solo qui (a pannello
 * aperto) e solo per l'account che lo possiede; senza rete o senza accesso resta «Da Sinopia».
 *
 * @param props - L'origine già tradotta, il nome del pezzo della Libreria e il progetto Sinopia del modello.
 * @returns La didascalia.
 */
function DidascaliaSinopia({
  origine,
  dettaglio,
  progetto,
}: Readonly<{
  origine: string;
  dettaglio: string | undefined;
  progetto: NonNullable<RiferimentiLetti['progettoSinopia']>;
}>): React.JSX.Element {
  const session = useSinopiaSession();
  const utente = session.status === 'signed-in' ? session.user.id : undefined;
  const nome = useQuery({
    queryKey: ['sinopia', 'project-name', utente, progetto.id],
    queryFn: async ({ signal }) => readSinopiaProjectName(progetto.id, signal),
    enabled: utente !== undefined && utente === progetto.userId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return <Didascalia testo={[origine, nome.data, dettaglio].filter(Boolean).join(' · ')} />;
}

/**
 * Il pannello del riferimento, in alto a destra sotto il cubo di vista, dove nessun'altra cosa del riquadro sta: non
 * copre la barra né l'ispettore, che è fuori dal riquadro (su tablet, dove l'ispettore è un foglio sopra il lato destro,
 * il pannello va a sinistra). L'immagine intera, con la parte riconosciuta in evidenza
 * quando c'è la sua maschera (il resto velato, come in «Dalla parte al CAD»); sotto, da dove viene.
 *
 * @param props - Lo stato del riferimento e se sopra c'è il cubo di vista.
 * @returns Il pannello, o niente quando è chiuso.
 */
export function ViewerReferencePanel({
  riferimento,
  isBelowGizmo,
}: Readonly<{ riferimento: RiferimentoVisore; isBelowGizmo: boolean }>): React.ReactNode {
  const { t } = useTranslation();
  const titoloId = useId();
  const pannelloRef = useRef<HTMLDivElement>(null);
  const [rapporti, setRapporti] = useState<Readonly<Record<string, number>>>({});
  const { riferimenti, urls, illeggibili, progettoSinopia, isOpen, indice, isLarge, close, setIndice, setLarge } =
    riferimento;
  const corrente = riferimenti[indice];
  // On a tablet the inspector is a sheet over the viewer's right side: the panel then takes the left, below the chip of
  // the selected piece.
  const isTablet = useCadViewport() === 'tablet';
  const isInspectorSheetOpen = useWorkspaceLanes().chat;
  const aSinistra = isTablet && isInspectorSheetOpen;
  // Opening moves the keyboard into the panel, so Esc and the arrows work at once; the pointer user sees no ring.
  useEffect(() => {
    if (isOpen) {
      pannelloRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen]);

  if (!isOpen || !corrente) {
    return null;
  }
  const url = urls[corrente.percorso];
  const maschera = corrente.maschera ? urls[corrente.maschera] : undefined;
  const illeggibile = illeggibili.has(corrente.percorso);
  const totale = riferimenti.length;
  const origine = corrente.vista ? testoVista(t, corrente.vista) : t(`riferimento.origins.${corrente.origine}`);
  const didascalia = corrente.dettaglio ? `${origine} · ${corrente.dettaglio}` : origine;
  const rapporto = rapporti[corrente.percorso] ?? 4 / 3;
  const vai = (passo: number): void => {
    setIndice((indice + passo + totale) % totale);
  };

  return (
    <div
      ref={pannelloRef}
      role='dialog'
      aria-labelledby={titoloId}
      tabIndex={-1}
      data-slot='viewer-reference'
      data-size={isLarge ? 'large' : 'small'}
      className={cn(
        'absolute z-0 flex flex-col rounded-lg border bg-sidebar p-1 shadow-md outline-none focus-visible:focus-outline',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150',
        aSinistra
          ? 'top-16 left-3 max-h-[calc(100%-8rem)]'
          : isBelowGizmo
            ? 'top-29 right-3 max-h-[calc(100%-11rem)]'
            : 'top-3 right-3 max-h-[calc(100%-4.5rem)]',
        isLarge ? 'w-[clamp(16rem,50cqw,34rem)]' : 'w-[clamp(11rem,28cqw,18rem)]',
      )}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close({ restoreFocus: true });
        } else if (totale > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          event.stopPropagation();
          vai(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div className='flex h-7 shrink-0 items-center gap-0.5 pl-1.5'>
        <Eyebrow id={titoloId} className='truncate'>
          {t('riferimento.name')}
        </Eyebrow>
        {totale > 1 ? (
          <span className='ml-1.5 shrink-0 font-mono text-[10px] leading-4 text-muted-foreground tabular-nums'>
            {t('riferimento.position', { current: indice + 1, total: totale })}
          </span>
        ) : null}
        <Button
          variant='ghost'
          size='icon-xs'
          className='ml-auto'
          aria-label={isLarge ? t('riferimento.reduce') : t('riferimento.enlarge')}
          onClick={() => {
            setLarge(!isLarge);
          }}
        >
          {isLarge ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label={t('riferimento.close')}
          onClick={() => {
            close({ restoreFocus: true });
          }}
        >
          <X />
        </Button>
      </div>
      <figure className='flex min-h-0 flex-col'>
        <div
          className='relative min-h-0 w-full overflow-hidden rounded-md bg-sidebar'
          style={{ aspectRatio: rapporto }}
        >
          {url ? (
            <img
              key={url}
              src={url}
              alt={didascalia}
              draggable={false}
              className='absolute inset-0 size-full object-contain'
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setRapporti((attuali) => ({ ...attuali, [corrente.percorso]: naturalWidth / naturalHeight }));
                }
              }}
            />
          ) : (
            <p
              role={illeggibile ? 'alert' : 'status'}
              aria-busy={!illeggibile}
              className='absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground'
            >
              {illeggibile ? t('riferimento.unavailable') : t('riferimento.loading')}
            </p>
          )}
          {url && maschera ? (
            /* The part's mask as a watermark: the rest of the photo veiled, the part as it is. Sized and centred like
               the picture's object-contain, so the two stay aligned at any panel size. */
            <div
              aria-hidden='true'
              data-slot='viewer-reference-mask'
              className='pointer-events-none absolute inset-0 bg-sidebar/60'
              style={{
                maskImage: `linear-gradient(black, black), url(${maschera})`,
                maskMode: 'alpha, luminance',
                maskSize: '100% 100%, contain',
                maskPosition: 'center',
                maskRepeat: 'no-repeat',
                maskComposite: 'exclude',
              }}
            />
          ) : null}
          {totale > 1 ? (
            /* One picture after the other, at once: the arrows sit on the picture's edges, always visible. */
            <>
              <Button
                variant='outline'
                size='icon-xs'
                className='absolute top-1/2 left-1 -translate-y-1/2 rounded-full bg-sidebar/80 shadow-xs backdrop-blur-sm'
                aria-label={t('riferimento.previous')}
                onClick={() => {
                  vai(-1);
                }}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant='outline'
                size='icon-xs'
                className='absolute top-1/2 right-1 -translate-y-1/2 rounded-full bg-sidebar/80 shadow-xs backdrop-blur-sm'
                aria-label={t('riferimento.next')}
                onClick={() => {
                  vai(1);
                }}
              >
                <ChevronRight />
              </Button>
            </>
          ) : null}
        </div>
        {corrente.origine === 'sinopia' && progettoSinopia ? (
          <DidascaliaSinopia origine={origine} dettaglio={corrente.dettaglio} progetto={progettoSinopia} />
        ) : (
          <Didascalia testo={didascalia} />
        )}
      </figure>
    </div>
  );
}
