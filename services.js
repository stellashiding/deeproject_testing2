import { APP_CONFIG } from "./config.js";
import { getState, hydrate, studyBundle, criterionQualityChecks } from "./state.js";

const STORAGE_KEY = "deeproject:v0.15:study";

export function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
  window.dispatchEvent(new CustomEvent("deeproject:saved"));
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) hydrate(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not restore local study state", error);
  }
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportStudyBundle() {
  const date = new Date().toISOString().slice(0, 10);
  const participant = (getState().participantId || "participant").replace(/[^A-Za-z0-9_-]/g, "_");
  downloadJson(`${participant}_deeproject_study_${date}.json`, studyBundle());
}

export function exportFramework() {
  const { framework, domainScenario } = getState();
  const scenarioName = domainScenario.domain.trim() || "Participant-defined domain";
  const exportedDomainScenario = { ...domainScenario, scenarioId: "participant-defined-domain", scenarioName };
  const criteriaWithChecks = framework.criteria.map(criterion => ({ ...criterion, qualityChecks: criterionQualityChecks(criterion) }));
  const qualitySummary = {
    minimumCriteriaRequired: 2,
    criterionCompletionRule: "all_four_core_requirements",
    requiredCoreChecks: ["specificName", "rhcaMapping", "observableDefinition", "evidenceRule"],
    optionalChecks: ["distinctAnchors", "failureTags"],
    criteriaCount: criteriaWithChecks.length,
    coreCompleteCriteriaCount: criteriaWithChecks.filter(criterion => criterion.qualityChecks.coreComplete).length,
    allCriteriaCoreComplete: criteriaWithChecks.length >= 2 && criteriaWithChecks.every(criterion => criterion.qualityChecks.coreComplete)
  };
  downloadJson(`deeproject-framework-${framework.id.slice(0, 8)}.json`, {
    taskType: "participant_defined_domain",
    scenarioId: "participant-defined-domain",
    scenarioName,
    domainScenario: exportedDomainScenario,
    qualitySummary,
    frameworkArtifact: { ...framework, scenarioId: "participant-defined-domain", scenarioName, domain: domainScenario.domain, domainScenario: exportedDomainScenario, criteria: criteriaWithChecks }
  });
}

export function exportTrajectory() {
  const state = getState();
  const scenarioId = state.currentScenarioId;
  downloadJson(`deeproject-trajectory-${scenarioId}.json`, {
    taskType: "fixed_study_scenario",
    scenarioId,
    turnEvaluations: state.turnEvaluations?.[scenarioId] || {},
    humanEvaluation: {
      locked: state.humanEvaluationLocked,
      snapshot: state.humanSnapshot
    },
    exportedAt: new Date().toISOString()
  });
}

export async function remoteSave(resource, payload) {
  if (APP_CONFIG.storageMode === "local") return { mode: "local", payload };
  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: resource === "events"
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    return response.json();
  } catch (error) {
    if (APP_CONFIG.storageMode === "remote") throw error;
    return { mode: "local-fallback", payload, error: error.message };
  }
}

export async function createStudySession() {
  const state = getState();
  return remoteSave("study-sessions", {
    session_id: state.studySessionId,
    participant_id: state.participantId,
    started_at: state.startedAt,
    status: "active",
    metadata: { product_version: APP_CONFIG.version }
  });
}

export async function saveParticipantProfile() {
  const state = getState();
  return remoteSave("participants", {
    participant_id: state.participantId,
    email: state.participantProfile.email,
    identity_type: state.participantProfile.identityType,
    role: state.participantProfile.role,
    domain: state.participantProfile.domain
  });
}

export async function syncFramework() {
  const state = getState();
  return remoteSave("frameworks", {
    ...state.framework,
    task_type: "participant_defined_domain",
    domain_scenario: state.domainScenario,
    framework_id: state.framework.id,
    session_id: state.studySessionId,
    participant_id: state.participantId
  });
}

export async function syncScenarioReview() {
  const bundle = studyBundle();
  return remoteSave("scenario-reviews", {
    ...bundle.interactionReview,
    human_evaluation: bundle.humanEvaluation,
    trajectory_analytics: bundle.trajectoryAnalytics,
    session_id: bundle.metadata.sessionId,
    participant_id: bundle.metadata.participantId,
    completed: bundle.taskCompletion.scenario
  });
}

export async function syncEvent(event) {
  return remoteSave("events", {
    ...event,
    event_id: event.eventId,
    session_id: event.sessionId,
    event_type: event.type,
    scenario_id: event.scenarioId
  });
}

export function mongoIntegrationContract() {
  return {
    note: "The browser calls an authenticated API; MongoDB credentials remain on the server.",
    endpoints: [
      "POST /api/v1/study-sessions",
      "POST /api/v1/events",
      "POST /api/v1/frameworks",
      "POST /api/v1/scenario-reviews"
    ],
    collections: ["study_sessions", "events", "frameworks", "scenario_reviews"]
  };
}
