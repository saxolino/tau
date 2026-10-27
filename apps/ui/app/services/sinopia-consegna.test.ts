/* eslint-disable @typescript-eslint/naming-convention -- Fake PostgREST rows and RPC arguments keep Supabase wire names. */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createExportFile } from '@taucad/types/constants';
import type { ExportFile } from '@taucad/types';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';
import {
  chiamatePreventivo,
  chiediPreventivo,
  fornitoriPerTipo,
  libreriaConFileCad,
  percorsiLibreria,
  rigaLibreria,
  salvaInLibreria,
  SinopiaConsegnaError,
  testoPreventivo,
  tipoLibreria,
} from '#services/sinopia-consegna.js';

vi.mock('#lib/sinopia-data-client.js', () => ({
  getSinopiaDataClient: vi.fn(),
  requireSinopiaUser: vi.fn(async (userId: string) => ({ userId, token: 'jwt' })),
}));

const owner = '10000000-0000-4000-8000-000000000001';
const supplier = '50000000-0000-4000-8000-000000000005';
const projectId = '20000000-0000-4000-8000-000000000001';
const modelId = '30000000-0000-4000-8000-000000000001';
const conversation = '60000000-0000-4000-8000-000000000006';
const link: SinopiaCadLink = { modelId, projectId, userId: owner, baseRevisionId: null };
const step = createExportFile('step', 'model', new TextEncoder().encode('ISO-10303-21;'));
const glb = createExportFile('glb', 'model', new Uint8Array([103, 108, 84, 70]));
const foto = createExportFile('png', 'preview', new Uint8Array([137, 80, 78, 71]));
const tavola: ExportFile = { name: 'Fibbia.pdf', bytes: new Uint8Array([37, 80, 68, 70]), mimeType: 'application/pdf' };

type Request = { url: URL; method: string; body: string };

/** A real supabase-js client over an in-memory transport: no network, no database. */
function fixture(
  options: { columns?: boolean; failInsert?: boolean; failSend?: boolean; cadInbox?: boolean; stepCheck?: number } = {},
) {
  const requests: Request[] = [];
  const response = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    requests.push({ url, method, body });
    if (url.pathname === '/rest/v1/library_components' && method === 'GET') {
      return options.columns === false
        ? response({ code: '42703', message: 'column library_components.file_path does not exist' }, 400)
        : response([]);
    }
    if (url.pathname === '/rest/v1/library_components' && method === 'POST') {
      return options.failInsert
        ? response({ code: '23514', message: 'check' }, 400)
        : new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/projects') {
      return response({ vertical: 'footwear' });
    }
    if (url.pathname === '/rest/v1/supplier_products') {
      return response([
        {
          supplier_id: supplier,
          supplier: { id: supplier, company_name: 'Minuterie Brenta', city: 'Stra', country: 'IT', is_demo: false },
        },
        {
          supplier_id: supplier,
          supplier: { id: supplier, company_name: 'Minuterie Brenta', city: 'Stra', country: 'IT', is_demo: false },
        },
        {
          supplier_id: '50000000-0000-4000-8000-000000000007',
          supplier: {
            id: '50000000-0000-4000-8000-000000000007',
            company_name: 'Accessori Demo',
            city: null,
            country: null,
            is_demo: true,
          },
        },
        { supplier_id: 'not-a-uuid', supplier: null },
      ]);
    }
    if (url.pathname === '/rest/v1/rpc/start_network_conversation') {
      return response(conversation);
    }
    if (url.pathname === '/rest/v1/rpc/network_cad_attachments_enabled') {
      return options.cadInbox
        ? response(true)
        : response({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    }
    if (url.pathname === '/functions/v1/verifica-allegato-cad') {
      const status = options.stepCheck ?? 200;
      return status === 200
        ? response({ kind: 'step' })
        : response({ error: 'Content does not match its type' }, status);
    }
    if (url.pathname === '/rest/v1/rpc/send_contextual_network_message') {
      return options.failSend ? response({ code: 'P0001', message: 'Invalid message' }, 400) : response({ id: 'm' });
    }
    if (url.pathname.startsWith('/storage/v1/object/') && method === 'POST') {
      return response({ Key: url.pathname });
    }
    if (url.pathname.startsWith('/storage/v1/object/') && method === 'DELETE') {
      return response([]);
    }
    throw new Error(`Unexpected fake request: ${method} ${url.pathname}`);
  };
  const client = createClient('https://sinopia.invalid', 'public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher },
  });
  return { requests, apri: async () => ({ client, userId: owner }) };
}

describe('Salva in Libreria', () => {
  it('should map part types to the Library types the constraint admits', () => {
    expect(tipoLibreria('heel')).toBe('heel');
    expect(tipoLibreria('top_lift')).toBe('heel');
    expect(tipoLibreria('midsole_wedge')).toBe('sole');
    expect(tipoLibreria('buckle')).toBe('closure');
    expect(tipoLibreria('eyelet')).toBe('hardware');
    expect(tipoLibreria('ornament')).toBe('accessory');
    expect(tipoLibreria(undefined)).toBe('accessory');
  });

  it('should build a private row of the account, typed, measured from the solid, with its CAD files', () => {
    const riga = rigaLibreria({
      id: '70000000-0000-4000-8000-000000000007',
      userId: owner,
      nome: '  Fibbia Riviera  ',
      tipo: 'buckle',
      vertical: 'not-a-vertical',
      immagine: 'https://sinopia.invalid/storage/v1/object/public/library-components/x.png',
      materiale: { chiave: 'ottone', nome: 'Ottone', colore: '#b8995a' },
      larghezza: 44,
      altezza: 32,
      ingombro: [44, 32, 5.2],
      filePath: percorsiLibreria(owner, '70000000-0000-4000-8000-000000000007').step,
      glbPath: null,
      link,
      pezzi: [{ nome: 'Telaio', materiale: 'ottone', processo: 'tranciatura_lamiera', pesoGrammi: 12.345 }],
    });
    expect(riga).toMatchObject({
      user_id: owner,
      name: 'Fibbia Riviera',
      type: 'closure',
      vertical: 'accessories',
      catalog_section: 'structure',
      is_public: false,
      material: 'Ottone',
      color: '#b8995a',
      width_mm: 44,
      height_mm: 32,
      file_path: `components/${owner}/cad/70000000-0000-4000-8000-000000000007/model.step`,
      glb_path: null,
      tags: ['sinopiacad', 'buckle'],
      metadata: {
        source: 'sinopiacad',
        cad_model_id: modelId,
        project_id: projectId,
        part_type: 'buckle',
        ingombro_mm: [44, 32, 5.2],
        pezzi: [{ nome: 'Telaio', materiale: 'ottone', processo: 'tranciatura_lamiera', peso_g: 12.35 }],
      },
    });
  });

  it('should show the entry only when the CAD columns answer (fail-closed)', async () => {
    const pronta = fixture();
    expect(await libreriaConFileCad(pronta.apri)).toBe(true);
    expect(pronta.requests[0]?.url.searchParams.get('select')).toBe('id,file_path,glb_path');
    expect(pronta.requests[0]?.url.searchParams.get('limit')).toBe('0');
    expect(await libreriaConFileCad(fixture({ columns: false }).apri)).toBe(false);
    expect(
      await libreriaConFileCad(async () => {
        throw new Error('no session');
      }),
    ).toBe(false);
  });

  it('should upload the photo publicly, STEP and GLB privately in the account folder, then insert the row', async () => {
    const test = fixture();
    const id = await salvaInLibreria(
      {
        link,
        step,
        glb,
        foto,
        nome: 'Fibbia',
        tipo: 'buckle',
        larghezza: 44,
        altezza: 32,
        ingombro: [44, 32, 5],
        pezzi: [],
      },
      test.apri,
    );
    const uploads = test.requests.filter(
      ({ url, method }) => url.pathname.startsWith('/storage/') && method === 'POST',
    );
    expect(uploads.map(({ url }) => decodeURIComponent(url.pathname))).toEqual([
      `/storage/v1/object/library-components/${owner}/${id}.png`,
      `/storage/v1/object/creator-private/components/${owner}/cad/${id}/model.step`,
      `/storage/v1/object/creator-private/components/${owner}/cad/${id}/model.glb`,
    ]);
    const insert = test.requests.find(
      ({ url, method }) => url.pathname === '/rest/v1/library_components' && method === 'POST',
    );
    expect(JSON.parse(insert!.body)).toMatchObject({
      id,
      user_id: owner,
      vertical: 'footwear',
      type: 'closure',
      file_path: `components/${owner}/cad/${id}/model.step`,
      glb_path: `components/${owner}/cad/${id}/model.glb`,
      thumbnail_url: expect.stringContaining(`/library-components/${owner}/${id}.png`),
    });
  });

  it('should remove its own uploads when the row is refused, and upload nothing without the columns', async () => {
    const rifiutata = fixture({ failInsert: true });
    await expect(
      salvaInLibreria(
        {
          link,
          step,
          glb,
          foto,
          nome: 'Fibbia',
          tipo: 'buckle',
          larghezza: 1,
          altezza: 1,
          ingombro: [1, 1, 1],
          pezzi: [],
        },
        rifiutata.apri,
      ),
    ).rejects.toMatchObject({ problema: 'failed' });
    const removed = rifiutata.requests.filter(({ method }) => method === 'DELETE').map(({ body }) => JSON.parse(body));
    expect(removed).toHaveLength(2);
    expect(removed.flatMap(({ prefixes }) => prefixes as string[])).toHaveLength(3);

    const senzaColonne = fixture({ columns: false });
    await expect(
      salvaInLibreria(
        {
          link,
          step,
          glb,
          foto,
          nome: 'Fibbia',
          tipo: undefined,
          larghezza: 1,
          altezza: 1,
          ingombro: [1, 1, 1],
          pezzi: [],
        },
        senzaColonne.apri,
      ),
    ).rejects.toMatchObject({ problema: 'columns' });
    expect(senzaColonne.requests.some(({ url }) => url.pathname.startsWith('/storage/'))).toBe(false);
  });

  it('should refuse a missing or wrong file before any call', async () => {
    const test = fixture();
    await expect(
      salvaInLibreria(
        {
          link,
          step: glb,
          glb,
          foto,
          nome: 'X',
          tipo: undefined,
          larghezza: 1,
          altezza: 1,
          ingombro: [1, 1, 1],
          pezzi: [],
        },
        test.apri,
      ),
    ).rejects.toBeInstanceOf(SinopiaConsegnaError);
    expect(test.requests).toHaveLength(0);
  });
});

describe('Chiedi preventivo', () => {
  it('should list the suppliers that publish the part type, most products first', async () => {
    const test = fixture();
    const fornitori = await fornitoriPerTipo('buckle', test.apri);
    expect(fornitori).toEqual([
      { id: supplier, nome: 'Minuterie Brenta', luogo: 'Stra, IT', prodotti: 2, demo: false },
      { id: '50000000-0000-4000-8000-000000000007', nome: 'Accessori Demo', luogo: null, prodotti: 1, demo: true },
    ]);
    const query = test.requests[0]!.url.searchParams;
    expect(query.get('part_type')).toBe('eq.buckle');
    expect(query.get('is_active')).toBe('eq.true');
    expect(query.get('is_public')).toBe('eq.true');
  });

  it('should write the request: type, quantity, pieces with material, process, size and weight, attachments', () => {
    const testo = testoPreventivo({
      progetto: 'Fibbia Riviera',
      tipo: 'Fibbia',
      quantita: 500,
      nota: ' Finitura oro galvanico ',
      pezzi: [
        {
          nome: 'Telaio',
          materiale: 'Ottone',
          processo: 'Tranciatura lamiera',
          pesoGrammi: 12.34,
          ingombro: [44, 32, 3],
        },
        { nome: 'Ardiglione', materiale: 'Ottone' },
      ],
      misure: [],
      allegati: ['Fibbia.pdf', 'preview.png'],
      versione: 3,
      lingua: 'it',
    });
    expect(testo.split('\n')).toEqual([
      'Richiesta di preventivo · Fibbia · progetto «Fibbia Riviera»',
      'Quantità: 500 pz',
      '',
      'Pezzi:',
      '· Telaio — Ottone — Tranciatura lamiera — 44 × 32 × 3 mm — 12,3 g',
      '· Ardiglione — Ottone',
      '',
      'Allegati: Fibbia.pdf, preview.png.',
      'STEP e GLB nella versione 3 del CAD nel progetto Sinopia: te li giro qui se ti servono.',
      '',
      'Finitura oro galvanico',
    ]);
  });

  it('should build the existing inbox calls: conversation, references in the account folder, message with the project', () => {
    let next = 0;
    const chiamate = chiamatePreventivo({
      userId: owner,
      fornitoreId: supplier,
      progettoId: projectId,
      file: [tavola, foto],
      clientId: '80000000-0000-4000-8000-000000000008',
      idFile: () => `90000000-0000-4000-8000-00000000000${String(++next)}`,
    });
    expect(chiamate.avvia).toEqual({ p_expected_actor: owner, p_other: supplier });
    expect(chiamate.allegati.map(({ allegato }) => allegato)).toEqual([
      {
        path: `${owner}/90000000-0000-4000-8000-000000000001`,
        name: 'Fibbia.pdf',
        type: 'application/pdf',
        size_bytes: 4,
      },
      { path: `${owner}/90000000-0000-4000-8000-000000000002`, name: 'preview.png', type: 'image/png', size_bytes: 4 },
    ]);
    expect(
      chiamate.invia(conversation, {
        testo: ' Richiesta ',
        allegati: chiamate.allegati.map(({ allegato }) => allegato),
      }),
    ).toEqual({
      p_expected_actor: owner,
      p_conversation: conversation,
      p_client_id: '80000000-0000-4000-8000-000000000008',
      p_content: 'Richiesta',
      p_context: { source_project_id: projectId },
      p_attachments: chiamate.allegati.map(({ allegato }) => allegato),
    });
    expect(() => chiamate.invia(conversation, { testo: '  ', allegati: [] })).toThrow(SinopiaConsegnaError);
    // The inbox takes images, PDF and the STEP (once admitted), nothing else, and never a message to oneself.
    expect(() =>
      chiamatePreventivo({
        userId: owner,
        fornitoreId: supplier,
        progettoId: projectId,
        file: [glb],
        clientId: '80000000-0000-4000-8000-000000000008',
        idFile: () => '90000000-0000-4000-8000-000000000001',
      }),
    ).toThrow(SinopiaConsegnaError);
    expect(() =>
      chiamatePreventivo({
        userId: owner,
        fornitoreId: owner,
        progettoId: projectId,
        file: [],
        clientId: '80000000-0000-4000-8000-000000000008',
        idFile: () => '90000000-0000-4000-8000-000000000001',
      }),
    ).toThrow(SinopiaConsegnaError);
  });

  it('should start the conversation, upload the references, send the message and return the conversation', async () => {
    const test = fixture();
    const esito = await chiediPreventivo(
      {
        link,
        fornitoreId: supplier,
        testo: (conStep) => (conStep ? 'Con STEP' : 'Richiesta'),
        file: [tavola, foto],
        step,
        clientId: '80000000-0000-4000-8000-000000000008',
      },
      test.apri,
    );
    // Before the migration the probe is missing: no STEP is uploaded and the text says so.
    expect(esito).toEqual({ conversazione: conversation, stepAllegato: false });
    expect(
      test.requests.map(({ url, method }) => `${method} ${url.pathname.replace(/[\da-f-]{36}/gu, '<id>')}`),
    ).toEqual([
      'POST /rest/v1/rpc/network_cad_attachments_enabled',
      'POST /rest/v1/rpc/start_network_conversation',
      'POST /storage/v1/object/network-references/<id>/<id>',
      'POST /storage/v1/object/network-references/<id>/<id>',
      'POST /rest/v1/rpc/send_contextual_network_message',
    ]);
    const sent = JSON.parse(test.requests.at(-1)!.body) as {
      p_context: unknown;
      p_attachments: unknown[];
      p_content: string;
    };
    expect(sent.p_context).toEqual({ source_project_id: projectId });
    expect(sent.p_attachments).toHaveLength(2);
    expect(sent.p_content).toBe('Richiesta');
  });

  it('should attach the verified STEP once the inbox admits it and the server has read it', async () => {
    const test = fixture({ cadInbox: true });
    const esito = await chiediPreventivo(
      {
        link,
        fornitoreId: supplier,
        testo: (conStep) => (conStep ? 'Con STEP' : 'Richiesta'),
        file: [tavola, foto],
        step: { ...step, name: 'Fibbia Riviera.step' },
        clientId: '80000000-0000-4000-8000-000000000008',
      },
      test.apri,
    );
    expect(esito.stepAllegato).toBe(true);
    const uploads = test.requests.filter(
      ({ url, method }) => method === 'POST' && url.pathname.startsWith('/storage/'),
    );
    expect(uploads).toHaveLength(3);
    const check = test.requests.find(({ url }) => url.pathname === '/functions/v1/verifica-allegato-cad')!;
    const stepPath = decodeURIComponent(uploads[2]!.url.pathname).replace('/storage/v1/object/network-references/', '');
    expect(JSON.parse(check.body)).toEqual({ path: stepPath });
    const sent = JSON.parse(test.requests.at(-1)!.body) as {
      p_content: string;
      p_attachments: Array<{ name: string; type: string; path: string }>;
    };
    expect(sent.p_content).toBe('Con STEP');
    expect(sent.p_attachments.at(-1)).toMatchObject({
      name: 'Fibbia Riviera.step',
      type: 'application/step',
      path: stepPath,
    });
  });

  it('should leave out and remove a STEP the server refuses, and still send the request', async () => {
    const test = fixture({ cadInbox: true, stepCheck: 422 });
    const esito = await chiediPreventivo(
      {
        link,
        fornitoreId: supplier,
        testo: (conStep) => (conStep ? 'Con STEP' : 'Richiesta'),
        file: [tavola, foto],
        step,
        clientId: '80000000-0000-4000-8000-000000000008',
      },
      test.apri,
    );
    expect(esito.stepAllegato).toBe(false);
    const sent = JSON.parse(
      test.requests.find(({ url }) => url.pathname === '/rest/v1/rpc/send_contextual_network_message')!.body,
    ) as { p_content: string; p_attachments: Array<{ type: string }> };
    expect(sent.p_content).toBe('Richiesta');
    expect(sent.p_attachments.map(({ type }) => type)).toEqual(['application/pdf', 'image/png']);
    const removal = test.requests.find(({ method }) => method === 'DELETE')!;
    expect((JSON.parse(removal.body) as { prefixes: string[] }).prefixes).toHaveLength(1);
  });

  it('should remove the uploaded references when the message is refused', async () => {
    const test = fixture({ failSend: true });
    await expect(
      chiediPreventivo(
        {
          link,
          fornitoreId: supplier,
          testo: () => 'Richiesta',
          file: [tavola],
          clientId: '80000000-0000-4000-8000-000000000008',
        },
        test.apri,
      ),
    ).rejects.toMatchObject({ problema: 'failed' });
    const removal = test.requests.find(({ method }) => method === 'DELETE');
    expect(removal?.url.pathname).toBe('/storage/v1/object/network-references');
    expect((JSON.parse(removal!.body) as { prefixes: string[] }).prefixes).toHaveLength(1);
  });
});
