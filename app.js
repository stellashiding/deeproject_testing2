import { INTEGRATION_PREVIEW, RHCA_CORE, SCENARIOS } from "./config.js";
import { getState, mutate, reset, setState, subscribe, studyBundle } from "./state.js";
import { clearLocal, createStudySession, exportFramework, exportStudyBundle, exportTrajectory, loadLocal, saveLocal, saveParticipantProfile, syncEvent, syncFramework, syncScenarioReview } from "./services.js";
import { renderScenario } from "./scenario.js?v=20260730-1745";
import { renderFramework } from "./framework.js?v=20260729-2228";
import { renderLongHorizon } from "./long-horizon.js";
import { bindGovernanceEvents, governanceSectionMarkup } from "./governance.js";

const root = document.querySelector("#viewRoot");
const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
let tourPage = 0;

function renderReview() {
  const s = getState();
  const item = SCENARIOS.find(x => x.id === s.currentScenarioId);
  const artifact = {
    type: "labeled_failure_and_recovery",
    sourceScenario: item.id,
    targets: s.selectedTargets,
    evidence: s.evidenceTurns,
    coreTags: s.selectedTags,
    customTags: s.customTags,
    frameworkCriteria: s.framework.criteria.map(c => c.name)
  };
  root.innerHTML = `<div class="page"><header class="page-header"><div><span class="eyebrow">Review, governance & export</span><h1>Confirm and package the evaluation</h1><p>Review task outputs, inspect annotation disagreement, and export reusable behavioral records.</p></div><button id="downloadReview" class="button primary">Download complete record</button></header>
    <div class="summary-grid"><article class="summary-card"><span>Scenario task</span><b>${s.completed.scenario ? "Complete" : "In progress"}</b><p>${esc(item.title)} - targets ${s.selectedTargets.join(", ") || "none"}</p></article><article class="summary-card"><span>Framework task</span><b>${s.completed.framework ? "Complete" : "In progress"}</b><p>${s.framework.criteria.length} domain criteria</p></article><article class="summary-card"><span>Human decision</span><b>${esc(s.reviewDecision)}</b><p>Failure onset ${esc(s.failureOnset)} - recovery ${esc(s.recoveryTurn)}</p></article><article class="summary-card"><span>Workflow events</span><b>${s.events.length}</b><p>Structured events stored in the export bundle</p></article></div>
    <div class="review-layout"><section class="card"><div class="section-title"><h2>Human-confirmed evaluation</h2><span>Reference record</span></div><table><thead><tr><th>Dimension</th><th>Rating</th><th>Interpretation</th></tr></thead><tbody>${Object.entries(s.ratings).map(([key, score]) => `<tr><td><b>${key} - ${esc(RHCA_CORE[key].name)}</b></td><td>${score}/3</td><td>${esc(RHCA_CORE[key].anchors[score])}</td></tr>`).join("")}</tbody></table><div class="notice"><b>Review status:</b> ${esc(s.reviewDecision)}. Core tags: ${esc(s.selectedTags.join(", ") || "none")}. Custom tags: ${esc(s.customTags.map(x => x.label).join(", ") || "none")}.</div></section>
    <section class="card"><div class="section-title"><h2>Dataset artifact</h2><span>Local prototype</span></div><pre class="json-preview">${esc(JSON.stringify(artifact, null, 2))}</pre><button id="createArtifact" class="button secondary">Create local artifact</button></section></div>
    ${governanceSectionMarkup()}
    <section class="card export-section"><div class="section-title"><div><span class="eyebrow">Reusable outputs</span><h2>Export & integration readiness</h2></div><span>GitHub Pages local mode</span></div><div class="export-actions"><button id="exportComplete" class="button primary">Complete study JSON</button><button id="exportFrameworkReview" class="button secondary">Framework JSON</button><button id="exportTrajectoryReview" class="button secondary">Trajectory JSON</button></div><div class="integration-grid compact">${Object.entries(INTEGRATION_PREVIEW).map(([status, items]) => `<article><span class="eyebrow">${esc(status)}</span><h3>${status === "available" ? "Available now" : "Planned"}</h3>${items.map(value => `<div class="integration-row"><b>${status === "available" ? "✓" : "○"}</b>${esc(value)}</div>`).join("")}</article>`).join("")}</div><div class="integration-example"><b>Developer preview</b><code>POST /api/v1/evaluate { trace, framework, includeTrajectory: true }</code><small>Example only — no remote API is called by this GitHub Pages prototype.</small></div></section></div>`;
  root.querySelector("#downloadReview").addEventListener("click", exportStudyBundle);
  root.querySelector("#exportComplete").addEventListener("click", exportStudyBundle);
  root.querySelector("#exportFrameworkReview").addEventListener("click", exportFramework);
  root.querySelector("#exportTrajectoryReview").addEventListener("click", exportTrajectory);
  root.querySelector("#createArtifact").addEventListener("click", () => mutate(x => { x.curatedArtifacts.push({ ...artifact, id: crypto.randomUUID(), createdAt: new Date().toISOString(), humanConfirmed: true }); }, "dataset.artifact_created", { type: artifact.type }));
  bindGovernanceEvents(root, renderReview);
}

function renderRoute() {
  const state = getState();
  const route = state.route === "framework" && !state.completed.scenario ? "scenario" : state.route;
  if (route !== state.route) setState({ route }, "navigation.blocked");
  document.querySelectorAll("[data-route]").forEach(button => button.classList.toggle("active", button.dataset.route === route));
  if (route === "framework") renderFramework(root);
  else renderScenario(root);
  root.focus({ preventScroll: true });
}

function updateChrome() {
  const state = getState();
  const complete = Object.values(state.completed).filter(Boolean).length;
  document.querySelector("#progressText").textContent = `${complete} of 2 tasks complete`;
  document.querySelector("#profileButton").textContent = state.participantId || "Set participant";
  const frameworkNav = document.querySelector('[data-route="framework"]');
  frameworkNav.setAttribute("aria-disabled", String(!state.completed.scenario));
  frameworkNav.title = state.completed.scenario ? "" : "Complete Activity 1 to unlock";
}

function openActivity2Onboarding() {
  const modal = document.querySelector("#activity2Modal");
  modal.classList.remove("hidden");
  setTimeout(() => document.querySelector("#startActivity2").focus(), 20);
}

function openExportReminder() {
  const state = getState();
  if (!state.completed.scenario || !state.completed.framework) return;
  document.querySelector("#exportReminderModal").classList.remove("hidden");
  setTimeout(() => document.querySelector("#closeExportReminder").focus(), 20);
}

function closeExportReminder() {
  document.querySelector("#exportReminderModal").classList.add("hidden");
  document.querySelector("#exportStudy").focus();
}

function updateIdentityForm(type) {
  const label = document.querySelector("#identityLabel");
  const input = document.querySelector("#identityInput");
  label.textContent = type === "email" ? "Email address" : "Participant ID";
  input.type = type === "email" ? "email" : "text";
  input.autocomplete = type === "email" ? "email" : "off";
  input.placeholder = type === "email" ? "name@example.com" : "e.g., P07";
}

function showProfileStep() {
  const modal = document.querySelector("#onboardingModal");
  modal.querySelector("#profileSetupStep").classList.remove("hidden");
  modal.querySelector("#productTourStep").classList.add("hidden");
  modal.setAttribute("aria-labelledby", "onboardingTitle");
}

function showTourPage(index) {
  const modal = document.querySelector("#onboardingModal");
  tourPage = Math.max(0, Math.min(1, index));
  modal.querySelector("#profileSetupStep").classList.add("hidden");
  modal.querySelector("#productTourStep").classList.remove("hidden");
  modal.querySelectorAll("[data-tour-page]").forEach(page => page.classList.toggle("hidden", Number(page.dataset.tourPage) !== tourPage));
  modal.querySelector("#tourProgress").textContent = `${tourPage + 1} of 2`;
  modal.querySelectorAll(".tour-dots i").forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === tourPage));
  modal.querySelector("#tourBack").disabled = tourPage === 0;
  modal.querySelector("#tourNext").textContent = tourPage === 1 ? "Start Activity 1" : "Next";
  modal.setAttribute("aria-labelledby", `tourTitle${tourPage}`);
}

function openOnboarding() {
  const state = getState();
  const modal = document.querySelector("#onboardingModal");
  modal.classList.remove("hidden");
  showProfileStep();
  const type = state.participantProfile?.identityType === "email" ? "email" : "participant_id";
  const radio = modal.querySelector(`[name="identityType"][value="${type}"]`);
  if (radio) radio.checked = true;
  modal.querySelector("#identityInput").value = type === "email" ? (state.participantProfile?.email || "") : (state.participantId || "");
  updateIdentityForm(type);
  setTimeout(() => modal.querySelector("#identityInput").focus(), 20);
}

async function submitOnboarding() {
  const modal = document.querySelector("#onboardingModal");
  const isFirstSetup = !getState().participantId;
  const type = modal.querySelector('[name="identityType"]:checked').value;
  const identity = modal.querySelector("#identityInput").value.trim();
  const error = modal.querySelector("#onboardingError");
  if (!identity) { error.textContent = type === "email" ? "Enter an email address." : "Enter a participant ID."; return; }
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) { error.textContent = "Enter a valid email address."; return; }
  if (type === "participant_id" && !/^[A-Za-z0-9_-]{2,40}$/.test(identity)) { error.textContent = "Use 2-40 letters, numbers, hyphens, or underscores."; return; }
  error.textContent = "";
  const participantId = type === "email" ? identity.toLowerCase() : identity;
  mutate(s => {
    s.participantId = participantId;
    s.participantProfile = {
      identityType: type,
      email: type === "email" ? identity.toLowerCase() : null,
      role: null,
      domain: ""
    };
  }, "participant.profile_saved", { identityType: type });
  await saveParticipantProfile();
  await createStudySession();
  updateChrome();
  if (isFirstSetup) {
    showTourPage(0);
  } else {
    modal.classList.add("hidden");
    window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: `Workspace linked to ${participantId}.` }));
  }
}

subscribe(() => {
  saveLocal();
  updateChrome();
});

document.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.route === "framework" && !getState().completed.scenario) {
    return window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: "Complete Activity 1 to unlock Framework Builder." }));
  }
  setState({ route: button.dataset.route }, "navigation.changed");
  location.hash = button.dataset.route;
  renderRoute();
}));
document.querySelector("#exportStudy").addEventListener("click", () => {
  exportStudyBundle();
  openExportReminder();
});
document.querySelector("#closeExportReminder").addEventListener("click", closeExportReminder);
document.querySelector("#profileButton").addEventListener("click", openOnboarding);
document.querySelectorAll('[name="identityType"]').forEach(radio => radio.addEventListener("change", () => {
  document.querySelector("#identityInput").value = "";
  updateIdentityForm(radio.value);
  document.querySelector("#identityInput").focus();
}));
document.querySelector("#startWorkspace").addEventListener("click", submitOnboarding);
document.querySelector("#identityInput").addEventListener("keydown", event => { if (event.key === "Enter") submitOnboarding(); });
document.querySelector("#tourBack").addEventListener("click", () => showTourPage(tourPage - 1));
document.querySelector("#tourNext").addEventListener("click", () => {
  if (tourPage < 1) return showTourPage(tourPage + 1);
  document.querySelector("#onboardingModal").classList.add("hidden");
  setState({ route: "scenario" }, "onboarding.completed");
  location.hash = "scenario";
  renderRoute();
  root.focus({ preventScroll: true });
});
document.querySelector("#startActivity2").addEventListener("click", () => {
  document.querySelector("#activity2Modal").classList.add("hidden");
  setState({ route: "framework", activity2OnboardingSeen: true }, "onboarding.activity2_started");
  location.hash = "framework";
  renderRoute();
});
document.querySelector("#resetStudy").addEventListener("click", () => {
  if (!confirm("Reset the prototype and remove the locally saved draft?")) return;
  clearLocal();
  reset();
});

window.addEventListener("deeproject:toast", event => {
  const toast = document.querySelector("#toast");
  toast.textContent = event.detail;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
});
window.addEventListener("deeproject:event", event => {
  const latest = getState().events.at(-1);
  if (latest) syncEvent(latest);
  if (event.detail.type === "task.framework_completed") syncFramework();
  if (event.detail.type === "task.scenario_completed") {
    syncScenarioReview();
    const toast = document.querySelector("#toast");
    toast.classList.remove("show");
    toast.textContent = "";
    openActivity2Onboarding();
  }
});
window.addEventListener("hashchange", () => {
  const route = location.hash.slice(1);
  if (["scenario", "framework"].includes(route)) {
    if (route === "framework" && !getState().completed.scenario) {
      location.hash = "scenario";
      window.dispatchEvent(new CustomEvent("deeproject:toast", { detail: "Complete Activity 1 to unlock Framework Builder." }));
      return;
    }
    setState({ route }, "navigation.hash_changed");
    renderRoute();
  }
});

loadLocal();
if (getState().participantId) createStudySession();
const initialRoute = location.hash.slice(1);
if (["scenario", "framework"].includes(initialRoute)) mutate(s => {
  s.route = initialRoute === "framework" && !s.completed.scenario ? "scenario" : initialRoute;
}, null);
updateChrome();
renderRoute();
if (!getState().participantId) openOnboarding();
