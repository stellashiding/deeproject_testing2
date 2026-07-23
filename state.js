import { APP_CONFIG, FRAMEWORK_TEMPLATES, SCENARIOS, TRAJECTORY_PRESETS } from "./config.js";

const clone = value => structuredClone(value);
const defaultCriterion = () => ({ name: "Domain-specific criterion", relationship: "A", definition: "", evidence: "", anchors: { 1: "", 2: "", 3: "" }, tags: "" });
const initialTrajectory = scenarioId => {
  const trajectory = clone(TRAJECTORY_PRESETS[scenarioId] || { turns: {}, prediction: null });
  Object.values(trajectory.turns || {}).forEach(turn => delete turn.human);
  return trajectory;
};

export function criterionQualityChecks(criterion) {
  const checks = {
    specificName: String(criterion?.name || "").trim().length >= 5,
    rhcaMapping: Boolean(FRAMEWORK_TEMPLATES && ["R", "H", "C", "A"].includes(criterion?.relationship)),
    observableDefinition: String(criterion?.definition || "").trim().length >= 40,
    evidenceRule: String(criterion?.evidence || "").trim().length >= 40,
    distinctAnchors: Object.values(criterion?.anchors || {}).length === 3 && Object.values(criterion.anchors).every(value => String(value).trim().length >= 35),
    failureTags: String(criterion?.tags || "").trim().length >= 3
  };
  return { ...checks, passedCount: Object.values(checks).filter(Boolean).length, totalCount: 6 };
}

const frameworkArtifact = (framework, domainScenario, scenarioName) => ({
  ...framework,
  scenarioId: "participant-defined-domain",
  scenarioName,
  domain: domainScenario.domain,
  domainScenario,
  criteria: framework.criteria.map(criterion => ({ ...criterion, qualityChecks: criterionQualityChecks(criterion) }))
});

const initialState = () => {
  const scenarioId = SCENARIOS[0].id;
  const trajectory = initialTrajectory(scenarioId);
  return {
    route: "scenario",
    participantId: "",
    participantProfile: { identityType: "participant_id", email: null, role: "AI evaluation researcher", domain: "" },
    studySessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    currentScenarioId: scenarioId,
    revealedRound: 4,
    selectedTargets: ["A3", "A4"],
    activeEvaluationTurn: "A3",
    ratedTurns: [],
    ratedDimensionsByTurn: {},
    evidenceTurns: [],
    ratings: { R: null, H: null, C: null, A: null },
    selectedTags: [],
    customTags: [],
    failureOnset: "none",
    recoveryTurn: "none",
    reviewNote: "",
    reviewDecision: "pending",
    comparatorView: "human",
    humanEvaluationLocked: false,
    humanSnapshot: null,
    autoComparisonOpened: false,
    autoComparisonDecision: null,
    autoComparisonNote: "",
    autoComparisonReviewedAt: null,
    selectedTrajectoryTurn: "A3",
    turnEvaluations: { [scenarioId]: trajectory.turns },
    predictions: { [scenarioId]: trajectory.prediction },
    annotationTeam: [
      { id: crypto.randomUUID(), displayId: "A01", status: "submitted" },
      { id: crypto.randomUUID(), displayId: "A02", status: "submitted" }
    ],
    annotations: [{ id: crypto.randomUUID(), annotatorId: "A02", scenarioId, ratings: { R: 2, H: 1, C: 2, A: 2 }, failureTags: ["missing_reasoning"], evidenceTurns: ["U2", "A2"], failureOnset: "A2", recoveryTurn: "A4", status: "submitted", source: "illustrative" }],
    adjudication: { status: "pending", ratings: {}, note: "", updatedAt: null },
    domainScenario: { domain: "", userAndGoal: "", behavioralRisk: "" },
    framework: { id: crypto.randomUUID(), name: "Custom Domain Framework", template: "custom", domain: "User-defined", coreVersion: "RHCA Core v1.2", criteria: [defaultCriterion()], activeCriterionIndex: 0, status: "draft" },
    curatedArtifacts: [],
    completed: { scenario: false, framework: false },
    events: []
  };
};

let state = initialState();
const subscribers = new Set();

export function getState() { return state; }
export function setState(patch, eventType = "state.updated") { state = { ...state, ...patch }; if (eventType) recordEvent(eventType, Object.keys(patch)); subscribers.forEach(fn => fn(state)); }
export function mutate(mutator, eventType, payload = {}) { mutator(state); if (eventType) recordEvent(eventType, payload); subscribers.forEach(fn => fn(state)); }
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

export function recordEvent(type, payload = {}) {
  const isFrameworkEvent = state.route === "framework";
  state.events.push({
    eventId: crypto.randomUUID(),
    sessionId: state.studySessionId,
    type,
    timestamp: new Date().toISOString(),
    route: state.route,
    scenarioId: isFrameworkEvent ? "participant-defined-domain" : state.currentScenarioId,
    ...(isFrameworkEvent ? { scenarioName: state.domainScenario.domain.trim() || "Participant-defined domain" } : {}),
    payload
  });
  window.dispatchEvent(new CustomEvent("deeproject:event", { detail: { type, payload } }));
}

export function ensureTrajectory(scenarioId) {
  state.turnEvaluations ||= {};
  state.predictions ||= {};
  if (!state.turnEvaluations[scenarioId]) {
    const preset = initialTrajectory(scenarioId);
    state.turnEvaluations[scenarioId] = preset.turns;
    state.predictions[scenarioId] = preset.prediction;
  }
}

export function hydrate(saved) {
  if (!saved || typeof saved !== "object") return;
  const defaults = initialState();
  state = { ...defaults, ...saved, events: saved.events || [] };
  const scenarioChanged = !SCENARIOS.some(item => item.id === state.currentScenarioId);
  if (scenarioChanged) {
    state.currentScenarioId = defaults.currentScenarioId;
    state.selectedTargets = defaults.selectedTargets;
    state.activeEvaluationTurn = defaults.activeEvaluationTurn;
    state.ratedTurns = [];
    state.ratedDimensionsByTurn = {};
    state.evidenceTurns = [];
    state.ratings = defaults.ratings;
    state.selectedTags = [];
    state.customTags = [];
    state.failureOnset = "none";
    state.recoveryTurn = "none";
    state.reviewNote = "";
    state.reviewDecision = "pending";
    state.humanEvaluationLocked = false;
    state.humanSnapshot = null;
    state.selectedTrajectoryTurn = defaults.selectedTrajectoryTurn;
    state.completed = { ...defaults.completed, ...(saved.completed || {}), scenario: false };
  }
  if (["governance", "integrations"].includes(state.route)) state.route = "review";
  if (state.participantId === "anonymous") state.participantId = "";
  state.participantProfile = { ...defaults.participantProfile, ...(saved.participantProfile || {}) };
  state.annotationTeam = Array.isArray(saved.annotationTeam) ? saved.annotationTeam : defaults.annotationTeam;
  state.annotations = Array.isArray(saved.annotations) ? saved.annotations : defaults.annotations;
  state.adjudication = typeof saved.adjudication === "object" ? { ...defaults.adjudication, ...saved.adjudication } : { ...defaults.adjudication, status: saved.adjudication || "pending" };
  state.turnEvaluations = { ...defaults.turnEvaluations, ...(saved.turnEvaluations || {}) };
  state.predictions = { ...defaults.predictions, ...(saved.predictions || {}) };
  state.humanEvaluationLocked = Boolean(saved.humanEvaluationLocked);
  state.ratedDimensionsByTurn = saved.ratedDimensionsByTurn && typeof saved.ratedDimensionsByTurn === "object" ? saved.ratedDimensionsByTurn : {};
  state.humanSnapshot = saved.humanSnapshot && typeof saved.humanSnapshot === "object" ? saved.humanSnapshot : null;
  state.autoComparisonOpened = Boolean(saved.autoComparisonOpened);
  state.autoComparisonDecision = saved.autoComparisonDecision || null;
  state.autoComparisonNote = saved.autoComparisonNote || "";
  state.autoComparisonReviewedAt = saved.autoComparisonReviewedAt || null;
  state.framework = { ...defaults.framework, ...(saved.framework || {}) };
  state.domainScenario = { ...defaults.domainScenario, ...(saved.domainScenario || {}) };
  if (!Array.isArray(state.framework.criteria)) state.framework.criteria = [state.framework.criterion || defaultCriterion()];
  state.framework.activeCriterionIndex ??= 0;
  delete state.framework.criterion;
  ensureTrajectory(state.currentScenarioId);
  recordEvent("study.restored");
}

export function reset() { state = initialState(); recordEvent("study.reset"); subscribers.forEach(fn => fn(state)); }

export function studyBundle() {
  const frameworkScenarioName = state.domainScenario.domain.trim() || "Participant-defined domain";
  const frameworkDomainScenario = {
    ...state.domainScenario,
    scenarioId: "participant-defined-domain",
    scenarioName: frameworkScenarioName
  };
  const interactionEvents = state.events.map(event => event.route === "framework" ? {
    ...event,
    scenarioId: "participant-defined-domain",
    scenarioName: frameworkScenarioName
  } : event);
  return {
    metadata: { product: "Deeproject Behavioral Assurance Prototype", version: APP_CONFIG.version, sessionId: state.studySessionId, participantId: state.participantId, participantProfile: state.participantProfile, startedAt: state.startedAt, exportedAt: new Date().toISOString() },
    taskCompletion: state.completed,
    interactionReview: { taskType: "fixed_study_scenario", scenarioId: state.currentScenarioId, selectedTargets: state.selectedTargets, ratedTurns: state.ratedTurns, ratedDimensionsByTurn: state.ratedDimensionsByTurn, activeEvaluationTurn: state.activeEvaluationTurn, evidenceTurns: state.evidenceTurns, ratingsByTurn: Object.fromEntries(Object.entries(state.turnEvaluations[state.currentScenarioId] || {}).filter(([, value]) => value.human).map(([turn, value]) => [turn, value.human])), coreFailureTags: state.selectedTags, customFailureTags: state.customTags, failureOnset: state.failureOnset, recoveryTurn: state.recoveryTurn, status: state.reviewDecision, note: state.reviewNote },
    humanEvaluation: {
      locked: state.humanEvaluationLocked,
      snapshot: state.humanSnapshot
    },
    trajectoryAnalytics: { turnEvaluations: state.turnEvaluations },
    annotationGovernance: { team: state.annotationTeam, annotations: state.annotations, adjudication: state.adjudication },
    frameworkTask: {
      taskType: "participant_defined_domain",
      scenarioId: "participant-defined-domain",
      scenarioName: frameworkScenarioName,
      domainScenario: frameworkDomainScenario,
      frameworkArtifact: frameworkArtifact(state.framework, frameworkDomainScenario, frameworkScenarioName)
    },
    curatedArtifacts: state.curatedArtifacts,
    interactionEvents
  };
}
