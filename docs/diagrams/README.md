# retrieva-backend diagrams (diagram-as-code)

Icon-based system-design diagrams written as Python with
[mingrammer `diagrams`](https://diagrams.mingrammer.com/) (Graphviz), kept **with the docs** so they
never drift. Same house standard as the retrieva docs-site diagrams.

## Generate

```bash
brew install graphviz          # or: apt-get install -y graphviz  (system dep)
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python discovery_flow.py       # → ../architecture/img/discovery-flow.{png,svg}
python embed-svg-images.py ../architecture/img   # inline icons as base64 (self-contained SVG)
```

Commit the regenerated image(s) alongside the source change. Embed the **PNG** in GitHub-rendered
markdown (always renders); the SVG is the crisp/zoomable variant.

## Files

- `discovery_flow.py` — the async discovery sweep flow (RTV-91c) → embedded in `docs/connectors/discovery.md`.
- `embed-svg-images.py` — post-process: inline icon PNGs as base64 so SVGs render standalone. Run after generating.
- `icons/` — brand PNGs for components with no built-in `diagrams` icon (Authentik, BullMQ, Langfuse, …).
