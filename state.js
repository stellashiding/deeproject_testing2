import { APP_CONFIG, FRAMEWORK_TEMPLATES, SCENARIOS, TRAJECTORY_PRESETS } from "./config.js";

const clone = value => structuredClone(value);
const defaultCriterion = () => ({ name: "Domain-specific criterion", relationship: "A", definition: "", evidence: "", anchors: { 1: "", 2: "", 3: "" }, tags: "" });
const initialTrajectory = scenarioId => {
  const trajectory = clone(TRAJECTORY_PRESETS[scenarioId] || { turns: {}, prediction: null });
  Object.values(trajectory.turns || {}).forEach(turn => delete turn.human);
  return trajectory;
};

export function criterionQualityChecks(criterion, domainScenario = {}) {
  const name = String(criterion?.name || "").trim();
  const definition = String(criterion?.definition || "").trim();
  const evidence = String(criterion?.evidence || "").trim();
  const anchors = Object.values(criterion?.anchors || {}).map(value => String(value).trim());
  const normalizedAnchors = Object.values(criterion?.anchors || {}).map(value => String(value).trim().toLowerCase());
  const words = value => String(value || "").toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || [];
  const wordCount = value => words(value).length;
  const checks = {
    specificName: Boolean(name) && !["new domain criterion", "domain-specific criterion"].includes(name.toLowerCase()),
    rhcaMapping: Boolean(FRAMEWORK_TEMPLATES && ["R", "H", "C", "A"].includes(criterion?.relationship)),
    observableDefinition: Boolean(definition),
    evidenceRule: Boolean(evidence),
    distinctAnchors: normalizedAnchors.length === 3 && normalizedAnchors.every(Boolean) && new Set(normalizedAnchors).size === 3,
    failureTags: Boolean(String(criterion?.tags || "").trim())
  };
  const status = (completed, clear) => !completed ? "not_completed" : clear ? "looks_clear" : "could_be_more_specific";
  const genericNames = /^(reasoning|helpfulness|consistency|alignment|quality|accuracy|safety|clarity|good behavior|ai behavior)$/i;
  const observableLanguage = /\b(explain|provide|acknowledge|ask|state|identify|follow|remember|adapt|verify|cite|warn|refuse|correct|compare|summarize|clarif|recommend|respond|mention|include|avoid|maintain|use|address)\w*\b/i;
  const evidenceTargets = /\b(user|request|goal|prompt|response|answer|previous|prior|earlier|later|turn|constraint|instruction|action|tool|output|reasoning|explanation|conversation|interaction|message)\w*\b/i;
  const progressionCues = [
    /\b(no|none|never|missing|incorrect|unsafe|ignores?|fails?|does not|without|contradicts?|violates?|weak)\b/i,
    /\b(partial|partly|some|mixed|incomplete|but|however|inconsistent|limited|mostly)\b/i,
    /\b(clear|complete|fully|correct|consistent|specific|all|directly|appropriate|strong)\b/i
  ];
  const stopWords = new Set(["the","a","an","and","or","to","of","in","on","for","with","is","are","be","as","at","by","it","this","that","from","what","how","should","ai","assistant","user"]);
  const scenarioText = [domainScenario.userAndGoal, domainScenario.importantConstraint, domainScenario.behavioralRisk].filter(Boolean).join(" ");
  const criterionText = [name, definition, evidence, ...anchors].join(" ");
  const scenarioTerms = new Set(words(scenarioText).filter(word => word.length > 3 && !stopWords.has(word)));
  const sharedScenarioTerms = [...new Set(words(criterionText).filter(word => scenarioTerms.has(word)))];
  const anchorProgressionDetected = checks.distinctAnchors &&
    anchors.every((anchor, index) => wordCount(anchor) >= 3 && progressionCues[index].test(anchor));
  const lightweightQualitySignals = {
    specificName: {
      status: status(checks.specificName, checks.specificName && wordCount(name) >= 2 && !genericNames.test(name)),
      rule: "Use a specific behavior-based name, not only a broad RHCA label."
    },
    observableDefinition: {
      status: status(checks.observableDefinition, wordCount(definition) >= 6 && observableLanguage.test(definition)),
      rule: "Describe a visible action the assistant should say or do."
    },
    evidenceRule: {
      status: status(checks.evidenceRule, wordCount(evidence) >= 6 && evidenceTargets.test(evidence)),
      rule: "Name the interaction evidence a reviewer should inspect."
    },
    ratingAnchors: {
      status: status(anchors.some(Boolean), anchorProgressionDetected),
      rule: "Describe three distinct levels that progress from weak to partial to strong behavior."
    },
    scenarioAlignment: {
      status: status(Boolean(scenarioText.trim()) && Boolean(criterionText.trim()), sharedScenarioTerms.length > 0),
      rule: "Connect the criterion to the scenario's goal, constraint, or behavioral risk.",
      matchedTerms: sharedScenarioTerms
    }
  };
  const lightweightQualityLooksClearCount = Object.values(lightweightQualitySignals).filter(signal => signal.status === "looks_clear").length;
  const lightweightQualityStatus = lightweightQualityLooksClearCount === Object.keys(lightweightQualitySignals).length
    ? "looks_clear"
    : Object.values(lightweightQualitySignals).some(signal => signal.status === "not_completed")
      ? "not_completed"
      : "could_be_more_specific";
  const coreKeys = ["specificName", "rhcaMapping", "observableDefinition", "evidenceRule"];
  const optionalKeys = ["distinctAnchors", "failureTags"];
  const corePassedCount = coreKeys.filter(key => checks[key]).length;
  const optionalPassedCount = optionalKeys.filter(key => checks[key]).length;
  return {
    ...checks,
    corePassedCount,
    coreTotalCount: coreKeys.length,
    optionalPassedCount,
    optionalTotalCount: optionalKeys.length,
    coreComplete: corePassedCount === coreKeys.length,
    structuralCheckOnly: true,
    lightweightQualitySignals,
    lightweightQualityStatus,
    lightweightQualityLooksClearCount,
    lightweightQualityTotalCount: Object.keys(lightweightQualitySignals).length,
    lightweightQualityCheckIsAdvisory: true,
    semanticQualityReviewRequired: true,
    passedCount: corePassedCount + optionalPassedCount,
    totalCount: coreKeys.length + optionalKeys.length
  };
}

const frameworkQualitySummary = (framework, domainScenario) => {
  const criteria = framework.criteria.map(criterion => criterionQualityChecks(criterion, domainScenario));
  return {
    minimumCriteriaRequired: 2,
    criterionCompletionRule: "all_four_core_requirements_plus_anchors_for_at_least_one_criterion",
    requiredCoreChecks: ["specificName", "rhcaMapping", "observableDefinition", "evidenceRule"],
    sharedRequirement: "at_least_one_criterion_with_distinct_anchors",
    optionalChecks: ["failureTags"],
    automaticChecksMeasure: "structural_completion_plus_advisory_lightweight_text_quality",
    lightweightQualityCheckIsAdvisory: true,
    lightweightQualityRules: {
      specificName: "specific_behavior_based_name",
      observableDefinition: "visible_assistant_action",
      evidenceRule: "interaction_evidence_target",
      ratingAnchors: "weak_to_partial_to_strong_progression",
      scenarioAlignment: "overlap_with_goal_constraint_or_risk"
    },
    semanticQualityReviewRequired: true,
    criteriaCount: criteria.length,
    coreCompleteCriteriaCount: criteria.filter(quality => quality.coreComplete).length,
    allCriteriaCoreComplete: criteria.length >= 2 && criteria.every(quality => quality.coreComplete),
    criteriaWithDistinctAnchorsCount: criteria.filter(quality => quality.distinctAnchors).length,
    atLeastOneCriterionHasDistinctAnchors: criteria.some(quality => quality.distinctAnchors),
    taskStructurallyComplete: criteria.length >= 2 && criteria.every(quality => quality.coreComplete) && criteria.some(quality => quality.distinctAnchors),
    criteria
  };
};

const frameworkArtifact = (framework, domainScenario, scenarioName) => ({
  ...framework,
  scenarioId: "participant-defined-domain",
  scenarioName,
  domain: domainScenario.domain,
  domainScenario,
  criteria: framework.criteria.map(criterion => ({ ...criterion, qualityChecks: criterionQualityChecks(criterion, domainScenario) }))
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
    domainScenario: { domain: "", userAndGoal: "", importantConstraint: "", behavioralRisk: "", expectedInteractionLength: "" },
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
      qualitySummary: frameworkQualitySummary(state.framework, frameworkDomainScenario),
      frameworkArtifact: frameworkArtifact(state.framework, frameworkDomainScenario, frameworkScenarioName)
    },
    curatedArtifacts: state.curatedArtifacts,
    interactionEvents
  };
}
