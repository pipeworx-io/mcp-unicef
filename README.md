# mcp-unicef

UNICEF Data (UN Children's Fund) MCP — global statistics on child health,

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `list_dataflows` | Browse or keyword-search UNICEF's datasets (dataflows). UNICEF Data covers child health, nutrition, education, child protection, child mortality, child poverty, immunization, water/sanitation/hygiene (WASH) and the child-related SDGs. Each result has an `id` (the dataflowId you pass to dataflow_structure / get_data), a `version`, and an English name. There are ~70 datasets; pass `query` to filter. Example: list_dataflows({ query: "mortality" }) or list_dataflows({ query: "nutrition" }). |
| `dataflow_structure` | Get the structure (Data Structure Definition) of one UNICEF dataset: its ordered dimensions and, for each, the valid codes (e.g. countries, indicators, sex, age, wealth quintile). Use this to learn how to build the dot-separated SDMX `key` for get_data. The key has one position per dimension, in `dimension_order`; an empty position is a wildcard. Always call this before get_data. Example: dataflow_structure({ dataflow_id: "CME" }). |
| `get_data` | Pull observations from a UNICEF dataset. `key` is a dot-separated SDMX dimension filter, one position per dimension in the order given by dataflow_structure; leave a position empty to wildcard it. Call dataflow_structure first to learn the dimension order and valid codes. Example: get_data({ dataflow_id: "CME", key: ".CME_MRY0T4.." }) filters by INDICATOR=CME_MRY0T4 (under-five mortality rate) and wildcards REF_AREA/SEX/WEALTH_QUINTILE. Omit `key` (or pass "") to fetch all series — can be large. Returns decoded series with their dimension labels and per-period values. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "unicef": {
      "url": "https://gateway.pipeworx.io/unicef/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/unicef/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Unicef data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
