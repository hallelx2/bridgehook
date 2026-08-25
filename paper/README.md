# BridgeHook preprint

LaTeX source for the BridgeHook systems/experience paper. Self-contained:
all figures are TikZ, no external images.

## Build

```bash
pdflatex -interaction=nonstopmode main.tex
bibtex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
```

Produces `main.pdf`. Only widely available packages are used (geometry,
hyperref, booktabs, tikz + arrows.meta/positioning/calc, listings, xcolor,
amsmath, caption), so it builds on Overleaf or a stock TeX Live install.

## arXiv submission notes

- Submit the **source tarball**, and include the compiled `main.bbl` so arXiv
  does not need to run BibTeX:
  ```bash
  tar czf bridgehook-arxiv.tar.gz main.tex references.bib main.bbl
  ```
- **License:** default to **CC BY** (maximizes reuse/citation) unless a target
  venue forbids CC-BY preprints.
- **Abstract field:** arXiv's abstract box is plain text. Strip LaTeX before
  pasting — remove `\texttt{}`, `\emph{}`, `\cite{}`, `\,`, escaped chars
  (`\&`, `\_`), and `~`.
- **Categories:** primary **cs.SE**; cross-list **cs.NI** and **cs.CR**.

## TODOs left for the author

- [ ] **Author block:** fill affiliation + contact email (`main.tex`, `\author`).
- [ ] **Evaluation numbers:** run the methodology in §5.2 and replace every
      `---` placeholder in Table 2 (`tab:latency`) with measured median/p95
      values; add the hardware/region/commit fingerprint line.
- [ ] **Feature table sanity-check** (Table 1): re-verify each tool's account/
      self-host/freemium column against current docs at submission time.
- [ ] **Domain:** if `bridgehook.dev` is registered before submission, update
      §4 and the Limitations note (currently states it is not provisioned).
- [ ] Optional: add a screenshot/architecture appendix if a figure is desired
      beyond the two TikZ diagrams (keep it self-contained if so).
```
