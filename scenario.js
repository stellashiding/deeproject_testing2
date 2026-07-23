import { APP_CONFIG, CORE_FAILURE_TAGS, RHCA_CORE, SCENARIOS } from "./config.js";
import { getState, mutate, recordEvent, ensureTrajectory } from "./state.js";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const scenario = () => SCENARIOS.find(item => item.id === getState().currentScenarioId) || SCENARIOS[0];
const CORE_DIMENSIONS = ["R", "H", "C", "A"];
const completedDimensions = (state, turnId) => new Set(state.ratedDimensionsByTurn?.[turnId] || []);
const isTurnFullyRated = (state, turnId) => CORE_DIMENSIONS.every(key => completedDimensions(state, turnId).has(key));

function writeHumanTrajectory(state) {
  const evaluations = state.turnEvaluations[state.currentScenarioId] || {};
  const frameworkCriteria = state.framework.criteria || [];
  const targets = [state.activeEvaluationTurn || state.selectedTargets[0]].filter(Boolean);
  targets.forEach(turnId => {
    const existing = evaluations[turnId] || { tags: [] };
    const customForTurn = state.customTags.filter(tag => tag.evidenceTurn === turnId).map(tag => tag.label);
    const domainScores = Object.fromEntries(frameworkCriteria.map(criterion => [criterion.name, state.ratings[criterion.relationship] ?? null]));
    let trajectoryState = "at-risk";
    if (turnId === state.failureOnset) trajectoryState = "violated";
    if (turnId === state.recoveryTurn) trajectoryState = "recovered";
    evaluations[turnId] = { ...existing, human: { ...state.ratings }, domainScores, tags: [...new Set([...(existing.tags || []), ...state.selectedTags, ...customForTurn])], evidenceTurns: [...state.evidenceTurns], state: trajectoryState, humanUpdatedAt: new Date().toISOString() };
  });
  state.turnEvaluations[state.currentScenarioId] = evaluations;
}

function messageCard(turn) {
  const state = getState();
  const target = state.selectedTargets.includes(turn.id);
  const evidence = state.evidenceTurns.includes(turn.id);
  const selectable = turn.role === "assistant";
  return `<article class="message-card ${turn.role} ${target ? "selected-target" : ""}" data-turn="${turn.id}">
    <div class="message-meta"><span>${turn.role === "user" ? "User" : "Assistant"} ${turn.id}</span><span>Round ${turn.round}</span></div>
    <pre>${esc(turn.text)}</pre>
    <div class="message-actions">
      ${selectable ? `<span class="fixed-target">Evaluate this response</span>` : ""}
      <label><input type="checkbox" data-evidence="${turn.id}" ${evidence ? "checked" : ""} ${state.humanEvaluationLocked ? "disabled" : ""}> Use as evidence</label>
      ${selectable ? `<button class="text-button" data-onset="${turn.id}" ${state.humanEvaluationLocked ? "disabled" : ""}>Mark failure onset</button>` : ""}
    </div>
  </article>`;
}

function dimensionEditor(key, dimension) {
  const state = getState();
  const activeTurn = state.activeEvaluationTurn || state.selectedTargets[0];
  const touched = completedDimensions(state, activeTurn).has(key);
  const score = touched ? state.turnEvaluations[state.currentScenarioId]?.[activeTurn]?.human?.[key] ?? state.ratings[key] : null;
  return `<fieldset class="dimension-card">
    <legend><b>${key}</b> ${esc(dimension.name)}</legend>
    <p>${esc(dimension.question)}</p>
    <div class="score-options">${[1, 2, 3].map(value => `<label title="${esc(dimension.anchors[value])}"><input type="radio" name="score-${key}" value="${value}" ${score === value ? "checked" : ""} ${state.humanEvaluationLocked ? "disabled" : ""}><span>${value}</span></label>`).join("")}</div>
    <small>${score ? esc(dimension.anchors[score]) : "Select a rating."}</small>
  </fieldset>`;
}

function customTags() {
  const tags = getState().customTags;
  if (!tags.length) return `<p class="empty-copy">No domain-specific tags added yet.</p>`;
  return tags.map((tag, index) => `<div class="custom-tag"><span><b>${esc(tag.label)}</b><small>${esc(tag.dimension)} - ${esc(RHCA_CORE[tag.dimension].name)} - evidence ${esc(tag.evidenceTurn)}</small></span><button data-remove-tag="${index}" class="icon-button" aria-label="Remove ${esc(tag.label)}">×</button></div>`).join("");
}

function renderEvaluationPanel() {
  const state = getState();
  const item = scenario();
  return `<aside class="evaluation-panel">
    <div class="panel-title"><div><span class="eyebrow">Human-guided evaluation</span><h2>Rate each response</h2></div><span class="count-badge">${state.ratedTurns.length}/${state.selectedTargets.length} rated</span></div>
    <div class="selection-summary">${state.selectedTargets.map(id => `<span>${id}</span>`).join("")}</div>
    ${state.selectedTargets.length ? `<label class="stacked-label">Active turn to ${state.humanEvaluationLocked ? "inspect" : "rate"}<select id="activeEvaluationTurn">${state.selectedTargets.map(id => `<option value="${id}" ${state.activeEvaluationTurn === id ? "selected" : ""}>${id}</option>`).join("")}</select></label>` : ""}
    ${state.selectedTargets.length < 2 ? `<div class="notice warning">Consistency is cross-turn. Select at least two assistant responses for stronger evidence.</div>` : ""}
    <fieldset class="human-evaluation-form" ${state.humanEvaluationLocked ? "disabled" : ""}>
    <section><div class="section-title"><h3>Core evaluation dimensions</h3><span>All four required</span></div>${Object.entries(RHCA_CORE).map(([key, value]) => dimensionEditor(key, value)).join("")}</section>
    <section><div class="section-title"><h3>Core failure tags</h3><span>Paper-derived</span></div><div class="tag-grid">${CORE_FAILURE_TAGS.map(tag => `<label class="tag-check"><input type="checkbox" data-core-tag="${tag.id}" ${state.selectedTags.includes(tag.id) ? "checked" : ""}><span><b>${esc(tag.label)}</b><small>${tag.dimension}</small></span></label>`).join("")}</div></section>
    <section><div class="section-title"><h3>Domain-specific tags</h3><span>Must map to RHCA</span></div><div id="customTagList">${customTags()}</div>
      <div class="mini-form"><input id="customTagName" placeholder="e.g., Oversimplification" aria-label="Custom tag name"><select id="customTagDimension" aria-label="Related RHCA dimension"><option value="">Related dimension</option>${Object.entries(RHCA_CORE).map(([key, d]) => `<option value="${key}">${key} - ${esc(d.name)}</option>`).join("")}</select><select id="customTagEvidence" aria-label="Evidence turn"><option value="">Evidence turn</option>${item.turns.map(t => `<option value="${t.id}">${t.id}</option>`).join("")}</select><button id="addCustomTag" class="button secondary">Add tag</button></div>
    </section>
    <section><div class="section-title"><h3>Failure timeline</h3><span>Long-horizon</span></div><div class="field-row"><label>Failure onset<select id="failureOnset"><option value="none">No failure</option>${item.turns.filter(t => t.role === "assistant").map(t => `<option value="${t.id}" ${state.failureOnset === t.id ? "selected" : ""}>${t.id}</option>`).join("")}</select></label><label>Recovery<select id="recoveryTurn"><option value="none">No recovery</option><option value="partial" ${state.recoveryTurn === "partial" ? "selected" : ""}>Partial</option>${item.turns.filter(t => t.role === "assistant").map(t => `<option value="${t.id}" ${state.recoveryTurn === t.id ? "selected" : ""}>${t.id}</option>`).join("")}</select></label></div></section>
    <section><label class="stacked-label">Review note<textarea id="reviewNote" placeholder="Explain the behavioral failure and cite evidence turns.">${esc(state.reviewNote)}</textarea></label></section>
    </fieldset>
    ${state.humanEvaluationLocked
      ? `<div class="locked-evaluation"><b>Evaluation saved</b><span>Your ratings, evidence, and notes are saved locally.</span></div>`
      : `<div class="human-lock-actions"><button id="lockHumanEvaluation" class="button primary full">Save evaluation</button></div>`}
  </aside>`;
}

export function renderScenario(root) {
  const state = getState();
  const item = scenario();
  root.innerHTML = `<div class="page scenario-page">
    <header class="page-header"><div><span class="eyebrow">Task 1 · Interaction Review</span><h1>Evaluate the literature-search interaction</h1><p>Rate each assistant response, select supporting evidence, and identify failure onset and recovery.</p></div><span class="status-pill">Fixed study scenario</span></header>
    <div class="context-strip"><div><span>Case family</span><b>${esc(item.family)}</b></div><div><span>User</span><b>${esc(item.learner)}</b></div><div><span>Goal</span><b>${esc(item.goal)}</b></div><div>
  <span>Mode</span>
  <b>${Math.max(...item.turns.map(turn => turn.round))} rounds - guided</b>
</div></div>
    <div class="scenario-layout">
      <aside class="context-panel"><span class="eyebrow">Active context</span><h2>Long-horizon constraints</h2>${item.constraints.map(c => `<div class="constraint">✓ ${esc(c)}</div>`).join("")}<h3>Trace capabilities</h3><div class="chip-row">${item.capabilities.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div>${item.retrieval ? `<h3>Retrieved curriculum</h3>${item.retrieval.map(r => `<div class="retrieval-item">${esc(r)}</div>`).join("")}` : ""}<div class="notice"><b>Evaluation target</b> is the assistant response being rated. <b>Evidence turns</b> can include user or assistant messages.</div></aside>
      <section class="conversation-panel"><div class="conversation-head"><div><span class="eyebrow">${esc(item.subtitle)}</span><h2>${esc(item.title)}</h2></div><div class="legend"><span class="dot target"></span>Target <span class="dot evidence"></span>Evidence</div></div>${item.turns.filter(t => t.round <= state.revealedRound).map(messageCard).join("")}</section>
      ${renderEvaluationPanel()}
    </div>
  </div>`;
  bindScenarioEvents(root);
}

function bindScenarioEvents(root) {
  const refresh = () => renderScenario(root);
  root.querySelectorAll("[data-target]").forEach(input => input.addEventListener("change", () => { mutate(s => {
    const id = input.dataset.target;
    if (input.checked && s.selectedTargets.length >= APP_CONFIG.maxEvaluationTargets) { input.checked = false; return; }
    s.selectedTargets = input.checked ? [...s.selectedTargets, id] : s.selectedTargets.filter(x => x !== id);
    if (!s.selectedTargets.includes(s.activeEvaluationTurn)) s.activeEvaluationTurn = s.selectedTargets[0] || null;
  }, "evaluation.targets_changed", { turn: input.dataset.target, selected: input.checked }); refresh(); }));

  const activeTurnSelect = root.querySelector("#activeEvaluationTurn");
  if (activeTurnSelect) activeTurnSelect.addEventListener("change", event => { mutate(s => {
    s.activeEvaluationTurn = event.target.value;
    const savedRatings = s.turnEvaluations[s.currentScenarioId]?.[s.activeEvaluationTurn]?.human;
    const touched = completedDimensions(s, s.activeEvaluationTurn);
    s.ratings = Object.fromEntries(CORE_DIMENSIONS.map(key => [key, touched.has(key) ? savedRatings?.[key] ?? null : null]));
  }, "evaluation.active_turn_changed", { turnId: event.target.value }); refresh(); });

  root.querySelectorAll("[data-evidence]").forEach(input => input.addEventListener("change", () => { mutate(s => {
    const id = input.dataset.evidence;
    s.evidenceTurns = input.checked ? [...new Set([...s.evidenceTurns, id])] : s.evidenceTurns.filter(x => x !== id);
  }, "evaluation.evidence_changed", { turn: input.dataset.evidence, selected: input.checked }); refresh(); }));

  root.querySelectorAll("[data-onset]").forEach(button => button.addEventListener("click", () => { mutate(s => { s.failureOnset = button.dataset.onset; }, "evaluation.failure_onset_marked", { turn: button.dataset.onset }); refresh(); }));
  root.querySelectorAll("[name^='score-']").forEach(input => input.addEventListener("change", () => { mutate(s => {
    const dimension = input.name.slice(-1);
    s.ratings[dimension] = Number(input.value);
    s.ratedDimensionsByTurn ||= {};
    s.ratedDimensionsByTurn[s.activeEvaluationTurn] = [...new Set([...(s.ratedDimensionsByTurn[s.activeEvaluationTurn] || []), dimension])];
    writeHumanTrajectory(s);
    s.ratedTurns = s.selectedTargets.filter(turnId => isTurnFullyRated(s, turnId));
  }, "evaluation.rating_changed", { turn: getState().activeEvaluationTurn, dimension: input.name.slice(-1), score: Number(input.value) }); refresh(); }));
  root.querySelectorAll("[data-core-tag]").forEach(input => input.addEventListener("change", () => mutate(s => { const id = input.dataset.coreTag; s.selectedTags = input.checked ? [...s.selectedTags, id] : s.selectedTags.filter(x => x !== id); }, "evaluation.core_tag_changed", { tag: input.dataset.coreTag, selected: input.checked })));
  root.querySelector("#failureOnset").addEventListener("change", e => mutate(s => { s.failureOnset = e.target.value; }, "evaluation.failure_onset_changed"));
  root.querySelector("#recoveryTurn").addEventListener("change", e => mutate(s => { s.recoveryTurn = e.target.value; }, "evaluation.recovery_changed"));
  root.querySelector("#reviewNote").addEventListener("input", e => mutate(s => { s.reviewNote = e.target.value; }, "evaluation.note_edited", { length: e.target.value.length }));
  root.querySelector("#addCustomTag").addEventListener("click", () => {
    const label = root.querySelector("#customTagName").value.trim();
    const dimension = root.querySelector("#customTagDimension").value;
    const evidenceTurn = root.querySelector("#customTagEvidence").value;
    if (!label || !dimension || !evidenceTurn) return window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: "Custom tags require a name, RHCA dimension, and evidence turn." }));
    mutate(s => { s.customTags.push({ id: crypto.randomUUID(), label, dimension, evidenceTurn, source: "domain_custom" }); writeHumanTrajectory(s); }, "evaluation.custom_tag_added", { label, dimension, evidenceTurn }); refresh();
  });
  root.querySelectorAll("[data-remove-tag]").forEach(button => button.addEventListener("click", () => { mutate(s => s.customTags.splice(Number(button.dataset.removeTag), 1), "evaluation.custom_tag_removed"); refresh(); }));
  const lockHuman = root.querySelector("#lockHumanEvaluation");
  if (lockHuman) lockHuman.addEventListener("click", () => {
    const current = getState();
    const incompleteTurns = current.selectedTargets.filter(turnId => !isTurnFullyRated(current, turnId));
    if (incompleteTurns.length) return window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: `Please complete all four evaluation dimensions for ${incompleteTurns.join(", ")}.` }));
    if (!current.evidenceTurns.length) return window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: "Select at least one supporting evidence turn." }));
    mutate(s => {
      writeHumanTrajectory(s);
      s.humanSnapshot = structuredClone({
        scenarioId: s.currentScenarioId,
        selectedTargets: s.selectedTargets,
        activeEvaluationTurn: s.activeEvaluationTurn,
        evidenceTurns: s.evidenceTurns,
        ratings: s.ratings,
        selectedTags: s.selectedTags,
        customTags: s.customTags,
        failureOnset: s.failureOnset,
        recoveryTurn: s.recoveryTurn,
        reviewNote: s.reviewNote,
        reviewDecision: "saved",
        submittedAt: new Date().toISOString()
      });
      s.humanEvaluationLocked = true;
      s.reviewDecision = "saved";
      s.completed.scenario = true;
    }, "task.scenario_completed", { scenarioId: current.currentScenarioId, targets: current.selectedTargets.length, evidence: current.evidenceTurns.length });
    refresh();
  });
  recordEvent("view.scenario_opened");
}
