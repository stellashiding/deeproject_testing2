import { APP_CONFIG, CORE_FAILURE_TAGS, RHCA_CORE, SCENARIOS } from "./config.js";
import { getState, mutate, recordEvent, ensureTrajectory } from "./state.js";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const scenario = () => SCENARIOS.find(item => item.id === getState().currentScenarioId) || SCENARIOS[0];
const CORE_DIMENSIONS = ["R", "H", "C", "A"];
const ICON_USER = `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="8" r="3.25"></circle><path d="M5.75 19c.7-3.35 3.05-5.25 6.25-5.25s5.55 1.9 6.25 5.25"></path></svg>`;
const ICON_AI = `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 3.5l1.05 3.05L16 7.6l-2.95 1.05L12 11.7l-1.05-3.05L8 7.6l2.95-1.05L12 3.5Z"></path><path d="M6.4 12.1l.72 2.08 2.08.72-2.08.72L6.4 17.7l-.72-2.08-2.08-.72 2.08-.72.72-2.08Z"></path><path d="M17.25 13.35l.82 2.38 2.38.82-2.38.82-.82 2.38-.82-2.38-2.38-.82 2.38-.82.82-2.38Z"></path></svg>`;
const SCENARIO_ILLUSTRATION = `<svg viewBox="0 0 180 96" focusable="false" aria-hidden="true">
  <rect class="scene-screen" x="48" y="18" width="84" height="54" rx="5"></rect>
  <path class="scene-line" d="M58 30h30M58 38h42M58 46h33"></path>
  <rect class="scene-panel" x="99" y="28" width="23" height="27" rx="3"></rect>
  <path class="scene-spark" d="M110.5 34l1.1 3.1 3.1 1.1-3.1 1.1-1.1 3.1-1.1-3.1-3.1-1.1 3.1-1.1 1.1-3.1Z"></path>
  <path class="scene-line" d="M88 72l-3 8h10l-3-8M72 80h36"></path>
  <circle class="scene-person" cx="28" cy="40" r="7"></circle>
  <path class="scene-person" d="M14 68c1.6-12 7.1-18 14-18s12.4 6 14 18M135 61h25l7 19h-32zM140 68h14"></path>
</svg>`;
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
  const selectable = state.selectedTargets.includes(turn.id);
  return `<article class="message-card ${turn.role} ${target ? "selected-target" : ""}" data-turn="${turn.id}">
    <div class="message-meta"><span class="speaker-label"><span class="speaker-avatar ${turn.role}" aria-hidden="true">${turn.role === "user" ? ICON_USER : ICON_AI}</span><span>${turn.role === "user" ? "User" : "AI Assistant"}</span></span><span>Round ${turn.round}</span></div>
    <pre>${esc(turn.text)}</pre>
    <div class="message-actions">
      <label><input type="checkbox" data-evidence="${turn.id}" ${evidence ? "checked" : ""} ${state.humanEvaluationLocked ? "disabled" : ""}> Use as evidence</label>
      ${selectable ? `<span class="rating-form-hint"><b>Next:</b> Complete the rating form on the right <span aria-hidden="true">→</span></span>` : ""}
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
  if (!tags.length) return `<p class="empty-copy">No custom tags added yet.</p>`;
  return tags.map((tag, index) => `<div class="custom-tag"><span><b>${esc(tag.label)}</b><small>${esc(tag.dimension)} - ${esc(RHCA_CORE[tag.dimension].name)} - evidence ${esc(tag.evidenceTurn)}</small></span><button data-remove-tag="${index}" class="icon-button" aria-label="Remove ${esc(tag.label)}">×</button></div>`).join("");
}

function renderEvaluationPanel() {
  const state = getState();
  const item = scenario();
  const activeTurn = state.activeEvaluationTurn || state.selectedTargets[0];
  const ratingsComplete = Boolean(activeTurn) && isTurnFullyRated(state, activeTurn);
  const firstTarget = state.selectedTargets[0];
  const nextTarget = state.selectedTargets.find(turnId => turnId !== firstTarget);
  const showNextResponseHint = !state.humanEvaluationLocked
    && activeTurn === firstTarget
    && isTurnFullyRated(state, firstTarget)
    && Boolean(nextTarget)
    && !isTurnFullyRated(state, nextTarget);
  return `<aside class="evaluation-panel">
    <div class="panel-title"><div><span class="eyebrow">Human-guided evaluation</span><h2>Rate two AI responses</h2></div><span class="count-badge">${state.ratedTurns.length}/${state.selectedTargets.length} rated</span></div>
    ${state.selectedTargets.length ? `<label class="stacked-label">Select an AI response to ${state.humanEvaluationLocked ? "inspect" : "rate"}<select id="activeEvaluationTurn">${state.selectedTargets.map(id => { const turn = item.turns.find(candidate => candidate.id === id); const status = isTurnFullyRated(state, id) ? "Rated ✓" : "Not rated"; return `<option value="${id}" ${state.activeEvaluationTurn === id ? "selected" : ""}>AI Assistant · Round ${turn?.round ?? id} — ${status}</option>`; }).join("")}</select></label>` : ""}
    ${showNextResponseHint ? `<div class="next-response-hint"><span><b>Round ${item.turns.find(turn => turn.id === firstTarget)?.round ?? firstTarget} complete.</b> Next, rate Round ${item.turns.find(turn => turn.id === nextTarget)?.round ?? nextTarget}.</span><button id="rateNextResponse" class="button secondary" data-next-turn="${nextTarget}">Rate Round ${item.turns.find(turn => turn.id === nextTarget)?.round ?? nextTarget} →</button></div>` : ""}
    ${state.selectedTargets.length < 2 ? `<div class="notice warning">Consistency is cross-turn. Select at least two assistant responses for stronger evidence.</div>` : ""}
    <fieldset class="human-evaluation-form" ${state.humanEvaluationLocked ? "disabled" : ""}>
    <section><div class="section-title"><h3>Core evaluation dimensions</h3><span>All four required</span></div>${Object.entries(RHCA_CORE).map(([key, value]) => dimensionEditor(key, value)).join("")}</section>
    ${ratingsComplete ? `<details class="evaluation-disclosure"><summary><span><b>Core failure tags</b><small>Select all that apply</small></span><span class="disclosure-action">View tags</span></summary><div class="disclosure-body"><div class="tag-grid">${CORE_FAILURE_TAGS.map(tag => `<label class="tag-check"><input type="checkbox" data-core-tag="${tag.id}" ${state.selectedTags.includes(tag.id) ? "checked" : ""}><span><b>${esc(tag.label)}</b><small>${tag.dimension}</small></span></label>`).join("")}</div></div></details>
    <details class="evaluation-disclosure"><summary><span><b>Custom tags</b><small>Add a tag not listed above</small></span><span class="disclosure-action">View tags</span></summary><div class="disclosure-body"><div id="customTagList">${customTags()}</div>
      <div class="mini-form"><input id="customTagName" placeholder="e.g., Oversimplification" aria-label="Custom tag name"><select id="customTagDimension" aria-label="Related RHCA dimension"><option value="">Related dimension</option>${Object.entries(RHCA_CORE).map(([key, d]) => `<option value="${key}">${key} - ${esc(d.name)}</option>`).join("")}</select><select id="customTagEvidence" aria-label="Evidence turn"><option value="">Evidence turn</option>${item.turns.map(t => `<option value="${t.id}">${t.id}</option>`).join("")}</select><button id="addCustomTag" class="button secondary">Add custom tag</button></div>
    </div></details>` : `<section class="tags-locked" aria-disabled="true"><div><b>Failure tags</b><span>Complete all four RHCA ratings for ${esc(activeTurn || "the active response")} to unlock.</span></div></section>`}
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
    <header class="page-header"><div><span class="eyebrow">Task 1 · Interaction Review</span><h1>Evaluate a responsible workplace AI interaction</h1><p>Read all four rounds, then rate Rounds 3 and 4.</p></div></header>
    <details class="scenario-overview">
      <summary>
        <span><span class="eyebrow">Scenario overview</span><b>${esc(item.family)} · Employee summary · 4 rounds</b></span>
        <span class="scenario-overview-toggle"><span class="collapse-label">Collapse</span><span class="expand-label">Expand</span></span>
      </summary>
      <div class="scenario-overview-body">
        <div class="scenario-overview-content">
          <div class="context-strip"><div><span>User</span><b>${esc(item.learner)}</b></div><div><span>Goal</span><b>${esc(item.goal)}</b></div><div><span>Context</span><b>${esc(item.title)}</b></div></div>
          <div class="scenario-illustration" role="img" aria-label="A worker using an AI assistant to draft a workplace document">${SCENARIO_ILLUSTRATION}</div>
        </div>
      </div>
    </details>
    <section class="conversation-flow" aria-label="Conversation flow">
          <div class="flow-rounds">
            <article class="flow-round">
              <span class="flow-round-label">Round 1</span>
              <div class="flow-exchange"><span class="flow-actor user"><i aria-hidden="true">${ICON_USER}</i><span><b>User</b><small>Asks whether a personal AI assistant can help</small></span></span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-actor assistant"><i aria-hidden="true">${ICON_AI}</i><span><b>AI Assistant</b><small>Recommends checking company policy and confidentiality</small></span></span></div>
            </article>
            <article class="flow-round">
              <span class="flow-round-label">Round 2</span>
              <div class="flow-exchange"><span class="flow-actor user"><i aria-hidden="true">${ICON_USER}</i><span><b>User</b><small>Explains the confidentiality policy and deadline</small></span></span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-actor assistant"><i aria-hidden="true">${ICON_AI}</i><span><b>AI Assistant</b><small>Recommends removing confidential information</small></span></span></div>
            </article>
            <article class="flow-round target-round">
              <span class="flow-round-label">Round 3 <em>Rate</em></span>
              <div class="flow-exchange"><span class="flow-actor user"><i aria-hidden="true">${ICON_USER}</i><span><b>User</b><small>Asks for the fastest way to finish</small></span></span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-actor assistant"><i aria-hidden="true">${ICON_AI}</i><span><b>AI Assistant</b><small>Response to evaluate</small></span></span></div>
            </article>
            <article class="flow-round target-round">
              <span class="flow-round-label">Round 4 <em>Rate</em></span>
              <div class="flow-exchange"><span class="flow-actor user"><i aria-hidden="true">${ICON_USER}</i><span><b>User</b><small>Questions whether the advice violates company policy</small></span></span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-actor assistant"><i aria-hidden="true">${ICON_AI}</i><span><b>AI Assistant</b><small>Response to evaluate</small></span></span></div>
            </article>
          </div>
        </section>
    <div class="scenario-layout">
      <section class="conversation-panel"><div class="conversation-head"><div><div class="interaction-visual" aria-label="Interaction between a user and an AI assistant"><span class="interaction-actor"><span class="speaker-avatar user" aria-hidden="true">${ICON_USER}</span>User</span><span class="interaction-arrow" aria-hidden="true">↔</span><span class="interaction-actor"><span class="speaker-avatar assistant" aria-hidden="true">${ICON_AI}</span>AI Assistant</span><span class="interaction-rounds">${Math.max(...item.turns.map(turn => turn.round))} rounds</span></div><h2>${esc(item.title)}</h2></div><div class="legend"><span class="dot target"></span>Target <span class="dot evidence"></span>Evidence</div></div>${item.turns.filter(t => t.round <= state.revealedRound).map(messageCard).join("")}</section>
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
  const rateNextResponse = root.querySelector("#rateNextResponse");
  if (rateNextResponse) rateNextResponse.addEventListener("click", event => {
    const turnId = event.currentTarget.dataset.nextTurn;
    mutate(s => {
      s.activeEvaluationTurn = turnId;
      const savedRatings = s.turnEvaluations[s.currentScenarioId]?.[turnId]?.human;
      const touched = completedDimensions(s, turnId);
      s.ratings = Object.fromEntries(CORE_DIMENSIONS.map(key => [key, touched.has(key) ? savedRatings?.[key] ?? null : null]));
    }, "evaluation.active_turn_changed", { turnId });
    refresh();
    root.querySelector("#activeEvaluationTurn")?.focus({ preventScroll: true });
  });

  root.querySelectorAll("[data-evidence]").forEach(input => input.addEventListener("change", () => { mutate(s => {
    const id = input.dataset.evidence;
    s.evidenceTurns = input.checked ? [...new Set([...s.evidenceTurns, id])] : s.evidenceTurns.filter(x => x !== id);
  }, "evaluation.evidence_changed", { turn: input.dataset.evidence, selected: input.checked }); refresh(); }));

  root.querySelectorAll("[name^='score-']").forEach(input => input.addEventListener("change", () => { mutate(s => {
    const dimension = input.name.slice(-1);
    s.ratings[dimension] = Number(input.value);
    s.ratedDimensionsByTurn ||= {};
    s.ratedDimensionsByTurn[s.activeEvaluationTurn] = [...new Set([...(s.ratedDimensionsByTurn[s.activeEvaluationTurn] || []), dimension])];
    writeHumanTrajectory(s);
    s.ratedTurns = s.selectedTargets.filter(turnId => isTurnFullyRated(s, turnId));
  }, "evaluation.rating_changed", { turn: getState().activeEvaluationTurn, dimension: input.name.slice(-1), score: Number(input.value) }); refresh(); }));
  root.querySelectorAll("[data-core-tag]").forEach(input => input.addEventListener("change", () => mutate(s => { const id = input.dataset.coreTag; s.selectedTags = input.checked ? [...s.selectedTags, id] : s.selectedTags.filter(x => x !== id); }, "evaluation.core_tag_changed", { tag: input.dataset.coreTag, selected: input.checked })));
  root.querySelector("#reviewNote").addEventListener("input", e => mutate(s => { s.reviewNote = e.target.value; }, "evaluation.note_edited", { length: e.target.value.length }));
  const addCustomTag = root.querySelector("#addCustomTag");
  if (addCustomTag) addCustomTag.addEventListener("click", () => {
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
