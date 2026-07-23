import { RHCA_CORE } from "./config.js";
import { getState, mutate, recordEvent } from "./state.js";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const statuses = ["not_started", "in_progress", "submitted", "locked"];
const pretty = value => String(value || "pending").replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase());

function annotationFor(state, member, index) {
  if (index === 0) return { annotatorId: member.displayId, ratings: state.ratings, status: member.status, source: "current_participant" };
  return state.annotations.find(x => x.annotatorId === member.displayId) || { annotatorId: member.displayId, ratings: { R: 2, H: 2, C: 2, A: 2 }, status: member.status, source: "illustrative" };
}

function comparison(state) {
  return state.annotationTeam.map((member, index) => ({ member, index, annotation: annotationFor(state, member, index) }));
}

function agreement(items, dimension) {
  const values = items.filter(x => ["submitted", "locked"].includes(x.member.status)).map(x => Number(x.annotation.ratings[dimension])).filter(x => [1, 2, 3].includes(x));
  if (values.length < 2) return null;
  const counts = values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
  return Math.round(Math.max(...Object.values(counts)) / values.length * 100);
}

export function governanceSectionMarkup() {
  const state = getState();
  const items = comparison(state);
  const submitted = items.filter(x => ["submitted", "locked"].includes(x.member.status)).length;
  const agreements = Object.keys(RHCA_CORE).map(key => agreement(items, key)).filter(x => x !== null);
  const overall = agreements.length ? Math.round(agreements.reduce((a, b) => a + b, 0) / agreements.length) : null;
  const recommendation = submitted < 2 ? "At least two completed annotations required" : submitted === 2 ? "Weighted Cohen's kappa for ordinal ratings" : "Krippendorff's alpha (ordinal) or Fleiss' kappa";
  const adjudication = typeof state.adjudication === "object" ? state.adjudication.status : state.adjudication;

  const teamRows = items.map(({ member, index }) => `<div class="annotator-row"><div><b>${esc(member.displayId)}</b><small>${index === 0 ? "Current participant" : "Demonstration record"}</small></div><select data-annotator-status="${member.id}">${statuses.map(status => `<option value="${status}" ${member.status === status ? "selected" : ""}>${pretty(status)}</option>`).join("")}</select><div class="annotator-actions"><button class="text-button" data-edit-annotator="${member.id}">Edit ID</button>${index === 0 ? "" : `<button class="text-button" data-remove-annotator="${member.id}">Remove</button>`}</div></div>`).join("");
  const headers = items.map(x => `<th>${esc(x.member.displayId)}</th>`).join("");
  const ratingRows = Object.entries(RHCA_CORE).map(([key, dimension]) => `<tr><td><b>${key} · ${esc(dimension.name)}</b></td>${items.map(({ member, index, annotation }) => `<td><select data-governance-rating="${member.id}" data-dimension="${key}" ${index === 0 ? "disabled" : ""}>${[1, 2, 3].map(score => `<option value="${score}" ${Number(annotation.ratings[key]) === score ? "selected" : ""}>${score}</option>`).join("")}</select></td>`).join("")}<td>${agreement(items, key) == null ? "N/A" : agreement(items, key) + "%"}</td></tr>`).join("");

  return `<section class="card governance-section"><div class="section-title"><div><span class="eyebrow">Lightweight governance</span><h2>Annotation comparison & adjudication</h2><p>Configure demonstration annotators and inspect disagreement without treating prototype records as empirical IRR.</p></div><button id="addAnnotator" class="button secondary">+ Add annotator</button></div><div class="governance-summary"><article><span>Annotators</span><b>${items.length}</b></article><article><span>Completed</span><b>${submitted}</b></article><article><span>Majority agreement</span><b>${overall == null ? "N/A" : overall + "%"}</b></article><article><span>Adjudication</span><b>${pretty(adjudication)}</b></article></div><div class="annotator-list">${teamRows}</div><div class="annotation-table-wrapper"><table class="annotation-table"><thead><tr><th>Dimension</th>${headers}<th>Agreement</th></tr></thead><tbody>${ratingRows}</tbody></table></div><div class="notice"><b>Recommended reliability method:</b> ${esc(recommendation)}. Compute formal IRR only from independent annotations before adjudication.</div><div class="decision-actions"><button data-adjudication="consensus_accepted" class="button primary">Consensus accepted</button><button data-adjudication="discussion_required" class="button secondary">Discussion required</button><button data-adjudication="additional_annotation_required" class="button ghost">Add annotation</button></div></section>`;
}

export function bindGovernanceEvents(root, rerender) {
  const add = root.querySelector("#addAnnotator");
  if (add) add.addEventListener("click", () => {
    const suggested = `A${String(getState().annotationTeam.length + 1).padStart(2, "0")}`;
    const displayId = prompt("Annotator ID", suggested)?.trim();
    if (!displayId) return;
    if (getState().annotationTeam.some(x => x.displayId.toLowerCase() === displayId.toLowerCase())) return alert("That annotator ID already exists.");
    mutate(state => { state.annotationTeam.push({ id: crypto.randomUUID(), displayId, status: "not_started" }); state.annotations.push({ id: crypto.randomUUID(), annotatorId: displayId, scenarioId: state.currentScenarioId, ratings: { R: 2, H: 2, C: 2, A: 2 }, status: "not_started", source: "illustrative" }); }, "governance.annotator_added", { displayId });
    rerender();
  });

  root.querySelectorAll("[data-edit-annotator]").forEach(button => button.addEventListener("click", () => {
    const member = getState().annotationTeam.find(x => x.id === button.dataset.editAnnotator);
    if (!member) return;
    const next = prompt("Annotator ID", member.displayId)?.trim();
    if (!next || next === member.displayId) return;
    mutate(state => { state.annotations.forEach(a => { if (a.annotatorId === member.displayId) a.annotatorId = next; }); member.displayId = next; }, "governance.annotator_renamed", { displayId: next });
    rerender();
  }));

  root.querySelectorAll("[data-remove-annotator]").forEach(button => button.addEventListener("click", () => {
    const member = getState().annotationTeam.find(x => x.id === button.dataset.removeAnnotator);
    if (!member || !confirm(`Remove ${member.displayId}?`)) return;
    mutate(state => { state.annotationTeam = state.annotationTeam.filter(x => x.id !== member.id); state.annotations = state.annotations.filter(x => x.annotatorId !== member.displayId); }, "governance.annotator_removed", { displayId: member.displayId });
    rerender();
  }));

  root.querySelectorAll("[data-annotator-status]").forEach(select => select.addEventListener("change", () => {
    mutate(state => { const member = state.annotationTeam.find(x => x.id === select.dataset.annotatorStatus); if (!member) return; member.status = select.value; const annotation = state.annotations.find(x => x.annotatorId === member.displayId); if (annotation) annotation.status = select.value; }, "governance.status_changed", { status: select.value });
    rerender();
  }));

  root.querySelectorAll("[data-governance-rating]").forEach(select => select.addEventListener("change", () => {
    mutate(state => { const member = state.annotationTeam.find(x => x.id === select.dataset.governanceRating); const annotation = state.annotations.find(x => x.annotatorId === member?.displayId); if (annotation) annotation.ratings[select.dataset.dimension] = Number(select.value); }, "governance.rating_changed", { dimension: select.dataset.dimension, score: Number(select.value) });
    rerender();
  }));

  root.querySelectorAll("[data-adjudication]").forEach(button => button.addEventListener("click", () => {
    mutate(state => { state.adjudication = { ...(typeof state.adjudication === "object" ? state.adjudication : {}), status: button.dataset.adjudication, updatedAt: new Date().toISOString() }; }, "governance.adjudicated", { decision: button.dataset.adjudication });
    rerender();
  }));
  recordEvent("view.governance_section_opened");
}
