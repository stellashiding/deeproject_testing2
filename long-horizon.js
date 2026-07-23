import { CORE_FAILURE_TAGS, RHCA_CORE, SCENARIOS } from "./config.js";
import { getState, mutate, recordEvent } from "./state.js";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const parseTags = value => String(value || "").split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const riskClass = value => value >= .5 ? "risk-high" : value >= .25 ? "risk-medium" : "risk-low";

function sourceScore(evaluation, dimension, view) {
  if (view === "disagreement") return Math.abs((evaluation.human?.[dimension] || 0) - (evaluation.auto?.[dimension] || 0));
  return evaluation[view]?.[dimension] ?? null;
}

function scoreCell(value, view, turnId, rowId) {
  if (value === null) return `<button class="heat-cell empty" data-turn-detail="${turnId}">—</button>`;
  if (view === "disagreement") return `<button class="heat-cell disagreement-${Math.min(value, 2)}" data-turn-detail="${turnId}" title="Absolute Human–Auto difference">${value}</button>`;
  return `<button class="heat-cell score-${value}" data-turn-detail="${turnId}" data-row="${esc(rowId)}">${value}</button>`;
}

function tagCell(active, turnId) {
  return `<button class="heat-cell tag-${active ? "on" : "off"}" data-turn-detail="${turnId}">${active ? "●" : "—"}</button>`;
}

export function renderLongHorizon(root) {
  const state = getState();
  const scenario = SCENARIOS.find(x => x.id === state.currentScenarioId) || SCENARIOS[0];
  const turns = scenario.turns.filter(x => x.role === "assistant");
  const evaluations = state.turnEvaluations[state.currentScenarioId] || {};
  const prediction = state.predictions[state.currentScenarioId] || {};
  const view = state.comparatorView || "human";
  const criteria = state.framework.criteria || [];
  const configuredTags = criteria.flatMap(c => parseTags(c.tags));
  const customTags = state.customTags.map(tag => tag.label);
  const observedTags = turns.flatMap(turn => evaluations[turn.id]?.tags || []);
  const coreTagNames = CORE_FAILURE_TAGS.filter(tag => state.selectedTags.includes(tag.id) || observedTags.includes(tag.id)).map(tag => tag.id);
  const allTags = [...new Set([...coreTagNames, ...configuredTags, ...customTags, ...observedTags])];
  const selectedTurn = state.selectedTrajectoryTurn || turns[0].id;
  const selectedEvaluation = evaluations[selectedTurn] || {};

  const timeline = turns.map(turn => {
    const trajectoryState = evaluations[turn.id]?.state || "unknown";
    return `<button class="compact-turn ${trajectoryState} ${selectedTurn === turn.id ? "active" : ""}" data-turn-detail="${turn.id}"><b>${turn.id}</b><span>${esc(trajectoryState)}</span></button>`;
  }).join(`<span class="timeline-link">→</span>`);

  const rhcaRows = Object.entries(RHCA_CORE).map(([key, dimension]) => {
    const cells = turns.map(turn => scoreCell(sourceScore(evaluations[turn.id] || {}, key, view), view, turn.id, key)).join("");
    const predictedRisk = prediction.rhcaRisk?.[key];
    return `<div class="heat-row"><div class="heat-label"><b>${key}</b><span>${esc(dimension.name)}</span></div>${cells}<div class="prediction-cell ${riskClass(predictedRisk || 0)}">${predictedRisk == null ? "—" : Math.round(predictedRisk * 100) + "%"}</div></div>`;
  }).join("");

  const criterionRows = criteria.map(criterion => {
    const cells = turns.map(turn => {
      const evaluation = evaluations[turn.id] || {};
      const value = evaluation.domainScores?.[criterion.name] ?? sourceScore(evaluation, criterion.relationship, view);
      return scoreCell(value, view, turn.id, criterion.name);
    }).join("");
    return `<div class="heat-row"><div class="heat-label domain"><b>${esc(criterion.name)}</b><span>${criterion.relationship} · domain criterion</span></div>${cells}<div class="prediction-cell">—</div></div>`;
  }).join("");

  const tagRows = allTags.map(tag => {
    const cells = turns.map(turn => tagCell((evaluations[turn.id]?.tags || []).map(x => x.toLowerCase()).includes(tag.toLowerCase()), turn.id)).join("");
    const predictedRisk = prediction.tagRisk?.[tag];
    return `<div class="heat-row"><div class="heat-label tag"><b>${esc(tag.replaceAll("_", " "))}</b><span>failure tag</span></div>${cells}<div class="prediction-cell ${riskClass(predictedRisk || 0)}">${predictedRisk == null ? "—" : Math.round(predictedRisk * 100) + "%"}</div></div>`;
  }).join("");

  const comparatorCards = ["human", "auto", "llm", "disagreement"].map(id => `<button class="comparator-toggle ${view === id ? "active" : ""}" data-comparator="${id}">${id === "auto" ? "Auto-RHCA" : id === "llm" ? "LLM judge" : id[0].toUpperCase() + id.slice(1)}</button>`).join("");
  const selectedTurnText = turns.find(turn => turn.id === selectedTurn)?.text || "";

  root.innerHTML = `<div class="page trajectory-page">
    <header class="page-header"><div><span class="eyebrow">Non-static behavioral evaluation</span><h1>Turn-level trajectory analytics</h1><p>Trace how RHCA, domain criteria, and failures emerge, persist, recover, or relapse across turns.</p></div><div class="source-switcher">${comparatorCards}</div></header>
    <section class="compact-timeline card"><div class="section-title"><h2>Trace navigator</h2><span>Observed history → projected risk</span></div><div class="timeline-strip">${timeline}<span class="timeline-link prediction">⇢</span><div class="compact-turn predicted"><b>${esc(prediction.nextTurn || "Next")}</b><span>prediction</span></div></div></section>
    <section class="card heatmap-card"><div class="section-title"><div><h2>Behavioral trajectory heatmap</h2><p>Click any cell to inspect the underlying turn and evidence.</p></div><div class="heat-legend"><span class="score-1">1</span> failure <span class="score-2">2</span> partial <span class="score-3">3</span> meets</div></div>
      <div class="trajectory-scroll"><div class="trajectory-matrix" style="--turn-count:${turns.length}"><div class="heat-row heat-header"><div class="heat-label">Signal</div>${turns.map(t => `<div>${t.id}</div>`).join("")}<div>Next risk</div></div><div class="heat-section-label">RHCA core · ${esc(view)}</div>${rhcaRows}<div class="heat-section-label">Domain-specific criteria</div>${criterionRows || `<p class="empty-copy">Add criteria in Framework Builder.</p>`}<div class="heat-section-label">Failure tags · core + domain + user-added</div>${tagRows || `<p class="empty-copy">No failure tags in this trace.</p>`}</div></div>
    </section>
    <div class="trajectory-bottom"><section class="card turn-inspector"><div class="section-title"><h2>${esc(selectedTurn)} evidence</h2><span>${esc(selectedEvaluation.state || "unknown")}</span></div><p class="turn-text">${esc(selectedTurnText)}</p><div class="chip-row">${(selectedEvaluation.tags || []).map(tag => `<span class="chip">${esc(tag)}</span>`).join("") || `<span class="subtle">No tags</span>`}</div><div class="notice"><b>Evidence turns:</b> ${esc((selectedEvaluation.evidenceTurns || state.evidenceTurns || []).join(", ") || "not selected")}</div></section>
    <section class="card prediction-panel"><div class="section-title"><h2>Next-turn risk projection</h2><span>${esc(prediction.confidence || "unknown")} confidence</span></div><div class="prediction-stats"><article><span>Failure persistence</span><b>${Math.round((prediction.persistence || 0) * 100)}%</b></article><article><span>Recovery</span><b>${Math.round((prediction.recovery || 0) * 100)}%</b></article></div><div class="notice warning"><b>Prototype computation:</b> ${esc(prediction.source || "not configured")}. This is a transparent technology probe, not a trained production forecast.</div></section></div>
    <section class="card comparator-explanation"><b>Comparator boundary:</b> Human annotations are the reference; Auto-RHCA is the target computational system; LLM judge is included only as a research baseline. The disagreement view shows where automation diverges from human evidence.</section>
  </div>`;

  root.querySelectorAll("[data-comparator]").forEach(button => button.addEventListener("click", () => { mutate(s => { s.comparatorView = button.dataset.comparator; }, "trajectory.comparator_changed", { source: button.dataset.comparator }); renderLongHorizon(root); }));
  root.querySelectorAll("[data-turn-detail]").forEach(button => button.addEventListener("click", () => { mutate(s => { s.selectedTrajectoryTurn = button.dataset.turnDetail; }, "trajectory.turn_inspected", { turnId: button.dataset.turnDetail }); renderLongHorizon(root); }));
  recordEvent("view.long_horizon_opened", { comparator: view });
}
