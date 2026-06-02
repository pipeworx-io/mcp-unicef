interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * UNICEF Data (UN Children's Fund) MCP — global statistics on child health,
 * nutrition, education, protection, child mortality, poverty, water/sanitation
 * and the child-related SDGs, via UNICEF's public SDMX 2.1 REST API. No key.
 *
 * Base: https://sdmx.data.unicef.org/ws/public/sdmxapi/rest  (agency = UNICEF)
 *
 * SDMX defaults to XML. We request JSON via Accept headers:
 *   - structures (dataflows, DSDs, codelists): application/vnd.sdmx.structure+json
 *   - data:                                    application/vnd.sdmx.data+json
 * NOTE: unlike some SDMX hosts, UNICEF returns 406 if you append
 * ";version=1.0" to the data Accept header — use the bare data+json type.
 *
 * Data path form is the comma-separated SDMX reference: the dataflowId must be
 * given as `UNICEF,{FLOW},{VERSION}` (e.g. `UNICEF,CME,1.0`), followed by the
 * dot-separated dimension key. We build that triplet automatically from the
 * dataflow's id + version, so callers just pass the bare dataflowId (e.g. "CME").
 *
 * The DSD (data structure) id often differs from the dataflowId (e.g. dataflow
 * CME -> DSD DSD_CME), so we resolve structure via the dataflow itself
 * (/dataflow/UNICEF/{id}/latest?references=all) rather than guessing the DSD id.
 *
 * If a JSON response can't be parsed we fall back to returning the raw text.
 *
 * Tools:
 *  - list_dataflows:     browse / keyword-search UNICEF's ~70 datasets
 *  - dataflow_structure: ordered dimensions + their valid codes for one dataset
 *  - get_data:           pull observations for a dataset using an SDMX key
 */


const BASE = 'https://sdmx.data.unicef.org/ws/public/sdmxapi/rest';
const AGENCY = 'UNICEF';
const UA = 'pipeworx-mcp-unicef/1.0 (+https://pipeworx.io)';
const ACCEPT_STRUCTURE = 'application/vnd.sdmx.structure+json';
const ACCEPT_DATA = 'application/vnd.sdmx.data+json';

const tools: McpToolExport['tools'] = [
  {
    name: 'list_dataflows',
    description:
      "Browse or keyword-search UNICEF's datasets (dataflows). UNICEF Data covers child health, nutrition, education, child protection, child mortality, child poverty, immunization, water/sanitation/hygiene (WASH) and the child-related SDGs. Each result has an `id` (the dataflowId you pass to dataflow_structure / get_data), a `version`, and an English name. There are ~70 datasets; pass `query` to filter. Example: list_dataflows({ query: \"mortality\" }) or list_dataflows({ query: \"nutrition\" }).",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive substring filter on dataset id or name, e.g. "mortality", "education", "immunization".',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 50).',
        },
      },
    },
  },
  {
    name: 'dataflow_structure',
    description:
      'Get the structure (Data Structure Definition) of one UNICEF dataset: its ordered dimensions and, for each, the valid codes (e.g. countries, indicators, sex, age, wealth quintile). Use this to learn how to build the dot-separated SDMX `key` for get_data. The key has one position per dimension, in `dimension_order`; an empty position is a wildcard. Always call this before get_data. Example: dataflow_structure({ dataflow_id: "CME" }).',
    inputSchema: {
      type: 'object',
      properties: {
        dataflow_id: {
          type: 'string',
          description: 'UNICEF dataflow id from list_dataflows, e.g. "CME" (child mortality), "NUTRITION", "EDUCATION".',
        },
      },
      required: ['dataflow_id'],
    },
  },
  {
    name: 'get_data',
    description:
      'Pull observations from a UNICEF dataset. `key` is a dot-separated SDMX dimension filter, one position per dimension in the order given by dataflow_structure; leave a position empty to wildcard it. Call dataflow_structure first to learn the dimension order and valid codes. Example: get_data({ dataflow_id: "CME", key: ".CME_MRY0T4.." }) filters by INDICATOR=CME_MRY0T4 (under-five mortality rate) and wildcards REF_AREA/SEX/WEALTH_QUINTILE. Omit `key` (or pass "") to fetch all series — can be large. Returns decoded series with their dimension labels and per-period values.',
    inputSchema: {
      type: 'object',
      properties: {
        dataflow_id: {
          type: 'string',
          description: 'UNICEF dataflow id, e.g. "CME". The agency,flow,version reference is built automatically.',
        },
        key: {
          type: 'string',
          description:
            'Dot-separated dimension filter (one position per dimension, empty = wildcard), e.g. ".CME_MRY0T4..". Omit for all series.',
        },
        start_period: { type: 'string', description: 'Start period, e.g. "2010".' },
        end_period: { type: 'string', description: 'End period, e.g. "2022".' },
        last_n: { type: 'number', description: 'Return only the last N observations per series.' },
        max_series: { type: 'number', description: 'Cap the number of decoded series returned (default 200).' },
      },
      required: ['dataflow_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_dataflows':
      return listDataflows(args);
    case 'dataflow_structure':
      return dataflowStructure(args);
    case 'get_data':
      return getData(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listDataflows(args: Record<string, unknown>) {
  const filter = ((args.query as string) ?? '').toLowerCase();
  const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
  const json = await sdmxGet(`/dataflow/${AGENCY}/all/latest`, ACCEPT_STRUCTURE);
  if (typeof json === 'string') return { format: 'xml', raw: json.slice(0, 4000) };
  const flows = (json as StructureResponse).data?.dataflows ?? [];
  const items = flows
    .map((f) => ({ id: f.id, version: f.version ?? '1.0', name: pickName(f) }))
    .filter((f) => !filter || f.id.toLowerCase().includes(filter) || f.name.toLowerCase().includes(filter));
  return { total: items.length, dataflows: items.slice(0, limit) };
}

async function dataflowStructure(args: Record<string, unknown>) {
  const id = reqStr(args, 'dataflow_id', '"CME"');
  // Resolve via the dataflow (DSD id often differs from the dataflow id, e.g. CME -> DSD_CME).
  const json = await sdmxGet(`/dataflow/${AGENCY}/${encodeURIComponent(id)}/latest?references=all`, ACCEPT_STRUCTURE);
  if (typeof json === 'string') return { format: 'xml', raw: json.slice(0, 4000) };
  const data = (json as StructureResponse).data ?? {};
  const dsd = data.dataStructures?.[0];
  if (!dsd) throw new Error(`UNICEF: no data structure found for dataflow ${id}`);
  const codelists = new Map<string, Codelist>();
  for (const cl of data.codelists ?? []) codelists.set(`${cl.agencyID}:${cl.id}`, cl);

  const dims = (dsd.dataStructureComponents?.dimensionList?.dimensions ?? [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((d) => {
      const ref = parseEnumeration(d.localRepresentation?.enumeration);
      const cl = ref ? codelists.get(ref) : undefined;
      const codes = (cl?.codes ?? []).map((c) => ({ id: c.id, name: pickName(c) }));
      return {
        id: d.id,
        position: d.position,
        codelist: ref,
        code_count: codes.length,
        codes: codes.slice(0, 200),
        codes_truncated: codes.length > 200,
      };
    });

  const flow = data.dataflows?.[0];
  return {
    dataflow_id: id,
    dataflow_version: flow?.version ?? '1.0',
    dsd_id: dsd.id,
    dimension_order: dims.map((d) => d.id),
    key_template: dims.map(() => '').join('.'),
    note: 'Build the get_data `key` by placing one code (or empty for wildcard) per dimension, in dimension_order, dot-separated.',
    dimensions: dims,
  };
}

async function getData(args: Record<string, unknown>) {
  const id = reqStr(args, 'dataflow_id', '"CME"');
  const key = (args.key as string | undefined)?.trim() || 'all';
  const maxSeries = typeof args.max_series === 'number' && args.max_series > 0 ? args.max_series : 200;

  // The data endpoint needs the full agency,flow,version reference. Resolve the
  // dataflow's version (falling back to 1.0) so callers only pass the bare id.
  const version = await resolveVersion(id);
  const flowRef = `${AGENCY},${id},${version}`;

  const params = new URLSearchParams();
  if (args.start_period) params.set('startPeriod', String(args.start_period));
  if (args.end_period) params.set('endPeriod', String(args.end_period));
  if (typeof args.last_n === 'number' && args.last_n > 0) params.set('lastNObservations', String(args.last_n));
  const qs = params.toString();
  const path = `/data/${encodeURIComponent(flowRef)}/${key}${qs ? `?${qs}` : ''}`;

  const json = await sdmxGet(path, ACCEPT_DATA);
  if (typeof json === 'string') return { format: 'xml', dataflow_id: id, key, raw: json.slice(0, 4000) };
  return normalizeData(id, key, json as DataResponse, maxSeries);
}

async function resolveVersion(id: string): Promise<string> {
  try {
    const json = await sdmxGet(`/dataflow/${AGENCY}/${encodeURIComponent(id)}/latest`, ACCEPT_STRUCTURE);
    if (typeof json !== 'string') {
      const flow = (json as StructureResponse).data?.dataflows?.[0];
      if (flow?.version) return flow.version;
    }
  } catch {
    // fall through to default
  }
  return '1.0';
}

function normalizeData(id: string, key: string, json: DataResponse, maxSeries: number) {
  const root = json.data ?? json; // SDMX-JSON 1.0/2.0 wrap dataSets+structure under `data`
  const struct = root.structure;
  const seriesDims = struct?.dimensions?.series ?? [];
  const obsValues = struct?.dimensions?.observation?.[0]?.values ?? [];
  const series = root.dataSets?.[0]?.series ?? {};
  const keys = Object.keys(series);

  const out = keys.slice(0, maxSeries).map((skey) => {
    const idx = skey.split(':').map(Number);
    const dims: Record<string, string> = {};
    seriesDims.forEach((d, i) => {
      const v = d.values?.[idx[i]];
      if (v) dims[d.id] = pickName(v) || v.id || '';
    });
    const observations: { period: string; value: number | string | null }[] = [];
    for (const [oidx, ovals] of Object.entries(series[skey].observations ?? {})) {
      const period = obsValues[Number(oidx)]?.id ?? oidx;
      const raw = ovals?.[0];
      const num = raw == null ? null : Number(raw);
      observations.push({ period, value: raw == null ? null : Number.isFinite(num) ? num : String(raw) });
    }
    observations.sort((a, b) => (a.period < b.period ? -1 : 1));
    return { series_key: skey, dimensions: dims, observations };
  });

  return {
    dataflow_id: id,
    key,
    series_count: keys.length,
    series_returned: out.length,
    series_truncated: keys.length > out.length,
    series: out,
  };
}

async function sdmxGet(path: string, accept: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: accept, 'User-Agent': UA } });
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`UNICEF: ${res.status} ${body}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Server ignored the JSON Accept header (returned XML/text) — hand it back raw.
    return text;
  }
}

function pickName(o: { name?: string; names?: Record<string, string> } | undefined): string {
  if (!o) return '';
  if (typeof o.name === 'string' && o.name) return o.name;
  return o.names?.en ?? '';
}

function parseEnumeration(urn: string | undefined): string | undefined {
  if (!urn) return undefined;
  // urn:sdmx:org.sdmx.infomodel.codelist.Codelist=UNICEF:CL_COUNTRY(1.0)  ->  UNICEF:CL_COUNTRY
  const m = urn.match(/=([^:]+):([^(]+)/);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

interface NamedItem {
  id: string;
  name?: string;
  names?: Record<string, string>;
}

interface Dataflow extends NamedItem {
  version?: string;
}

interface Codelist extends NamedItem {
  agencyID?: string;
  codes?: NamedItem[];
}

interface Dimension {
  id: string;
  position?: number;
  localRepresentation?: { enumeration?: string };
}

interface DataStructure {
  id: string;
  dataStructureComponents?: { dimensionList?: { dimensions?: Dimension[] } };
}

interface StructureResponse {
  data?: {
    dataflows?: Dataflow[];
    dataStructures?: DataStructure[];
    codelists?: Codelist[];
  };
}

interface DataRoot {
  dataSets?: { series?: Record<string, { observations?: Record<string, (number | string | null)[]> }> }[];
  structure?: {
    dimensions?: {
      series?: { id: string; name?: string; names?: Record<string, string>; values?: NamedItem[] }[];
      observation?: { id: string; values?: NamedItem[] }[];
    };
  };
}

interface DataResponse extends DataRoot {
  data?: DataRoot;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
