"""Retrieva — Discovery sweep (async) · diagram-as-code (RTV-91c).

The async discovery flow: API enqueues a BullMQ job → the discovery worker sweeps the source IdP,
LLM-maps each app to a proposed arrangement (in the caller's entity scope), and persists the result to
`discovery_runs` + the proposal inbox → a human confirms into the Register. Icon-based, matching the
retrieva docs-site diagrams. Self-contained (inlined theme, vendored icons).

mingrammer `diagrams` + Graphviz.
Run:  python discovery_flow.py   (needs: pip install diagrams ; brew/apt install graphviz)
Then: python embed-svg-images.py   (inline icons as base64 so the SVG renders standalone)
Out:  ../architecture/img/discovery-flow.{png,svg}
"""
from __future__ import annotations

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.onprem.client import Users
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.network import Kong
from diagrams.programming.language import NodeJS
from diagrams.programming.flowchart import Action, Document, ManualInput

# ----------------------------------------------------------------- theme (inlined)
SLATE, CYAN, GREEN, TEXT, MUTED, AMBER, VIOLET = (
    "#0f172a", "#22d3ee", "#34d399", "#e2e8f0", "#94a3b8", "#f59e0b", "#a78bfa",
)
ICONS = Path(__file__).resolve().parent / "icons"
OUT = Path(__file__).resolve().parent.parent / "architecture" / "img"
OUT.mkdir(parents=True, exist_ok=True)


def node(cls, label, icon=None):
    p = ICONS / icon if icon else None
    return Custom(label, str(p)) if p and p.exists() else cls(label)


def cl(pencolor=CYAN):
    return {"bgcolor": "#111c33", "pencolor": pencolor, "fontcolor": pencolor,
            "fontname": "Helvetica-Bold", "fontsize": "13", "style": "rounded", "penwidth": "1.6"}


GRAPH = {"bgcolor": SLATE, "fontcolor": TEXT, "fontname": "Helvetica", "fontsize": "20",
         "pad": "0.6", "nodesep": "0.5", "ranksep": "0.85", "splines": "spline"}
NODE = {"fontcolor": TEXT, "fontname": "Helvetica", "fontsize": "11"}
EDGE = {"color": MUTED, "fontcolor": MUTED, "fontname": "Helvetica", "fontsize": "9"}


def flow(label="", color=CYAN):
    return Edge(label=label, color=color, fontcolor=MUTED)


def dep(label="", color=MUTED):
    return Edge(label=label, color=color, fontcolor=MUTED, style="dashed")


with Diagram(
    "Retrieva — Discovery sweep (async)  ·  autonomous discovery · human-gated",
    filename=str(OUT / "discovery-flow"),
    outformat=["png", "svg"],
    direction="TB",
    show=False,
    graph_attr=GRAPH,
    node_attr=NODE,
    edge_attr=EDGE,
):
    caller = Users("Analyst / caller\nbrowser")

    with Cluster("1 · API  ·  Express", graph_attr=cl(GREEN)):
        api = node(NodeJS, "POST /discovery/{source}/run\n→ 202 { runId }", icon="express.png")

    with Cluster("2 · Queue  ·  BullMQ", graph_attr=cl(AMBER)):
        job = node(NodeJS, "discoveryJobs\nrun-discovery", icon="bullmq.png")

    with Cluster("3 · Discovery worker  ·  in the caller's entity scope", graph_attr=cl(CYAN)):
        listapps = Action("source /apps\n(read-only)")
        llm = Kong("LLM map → proposal\nLiteLLM gateway")
        dedupe = Action("dedupe")
        listapps >> flow() >> llm >> flow() >> dedupe
        trace = node(Kong, "Langfuse\nper-run trace", icon="langfuse.png")

    with Cluster("4 · Postgres", graph_attr=cl(AMBER)):
        runs = PostgreSQL("discovery_runs\ncounts · status")
        inbox = PostgreSQL("discovery_proposals\nINBOX · pending")

    human = ManualInput("human confirms\n+ legalEntityName")
    register = Document("Register of\nInformation")

    # ---- flows ----
    caller >> flow("HTTPS") >> api >> flow("enqueue") >> job >> flow() >> listapps
    dedupe >> flow() >> runs
    dedupe >> flow("real run") >> inbox
    llm >> dep("trace", VIOLET) >> trace
    caller >> dep("poll /runs/:id · /proposals") >> runs
    inbox >> flow("confirm") >> human >> flow() >> register
