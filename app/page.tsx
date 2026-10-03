"use client";

import { useMemo, useState } from "react";

type ClaimLabel = "supported" | "assumption" | "unverifiable";
type ReviewDecision = "approve" | "reject" | "escalate";

const existingCode = `@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, current_user: User = Depends(get_current_user)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice`;

const suggestedCode = `@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, current_user: User = Depends(get_current_user)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice`;

const safeFix = `if invoice.user_id != current_user.id and not current_user.has_role("support"):
    raise HTTPException(status_code=404, detail="Invoice not found")`;

const claims = [
  { id: "c1", text: "Removing the check lets support agents retrieve the invoice" },
  { id: "c2", text: "The endpoint remains protected because authentication is required" },
  { id: "c3", text: "This is the behaviour described in the ticket" },
  { id: "c4", text: "The change is minimal and low risk" },
  { id: "c5", text: "The existing tests continue to pass" },
];

const evidenceOptions = [
  { id: "tests", title: "Run existing unit tests", relevant: "Partial", result: "12 passed, 0 failed", detail: "No test requests another user’s invoice.", tone: "pass" },
  { id: "ticket", title: "Re-read the ticket text", relevant: "Relevant", result: "Support agents only", detail: "The ticket names support agents; the patch contains no role check.", tone: "warn" },
  { id: "diff", title: "View the full diff", relevant: "Relevant", result: "2 lines removed", detail: "The ownership condition is deleted and no authorization rule is added.", tone: "warn" },
  { id: "reachability", title: "Check who can reach the endpoint", relevant: "Relevant", result: "All authenticated roles", detail: "Customer, support, and admin users can call this endpoint.", tone: "danger" },
  { id: "helper", title: "Search for an existing role helper", relevant: "Relevant", result: "Helper found", detail: "has_role(\"support\") is already used elsewhere.", tone: "pass" },
  { id: "style", title: "Check code style and formatting", relevant: "Not relevant", result: "No issues found", detail: "Formatting is clean, but it cannot verify access control.", tone: "pass" },
  { id: "performance", title: "Check endpoint response time", relevant: "Not relevant", result: "p95 = 41 ms", detail: "Performance is unchanged and unrelated to authorization.", tone: "pass" },
] as const;

const labels: { value: ClaimLabel; title: string }[] = [
  { value: "supported", title: "Supported" },
  { value: "assumption", title: "Assumption" },
  { value: "unverifiable", title: "Unverifiable" },
];

const stepGuides = [
  {
    title: "Start with the access rule",
    points: [
      "Read what the ticket asks for, then compare it with what the current code allows.",
      "Authentication tells us who signed in. Authorization decides which invoice that person may open.",
      "Before seeing the AI suggestion, consider the customer, support, and admin roles separately.",
    ],
    answerFrame: "I would check who can call this endpoint, who should be allowed to open another person's invoice, and which tests cover that rule.",
    next: "Write at least one sentence in the green box to continue.",
  },
  {
    title: "Read the change before the explanation",
    points: [
      "Compare the current code with the suggested patch. Identify which condition disappears.",
      "For each sentence in the AI explanation, ask: what evidence would prove this claim?",
      "Keep your expectation from Step 1 in mind. A confident explanation is still a claim to check.",
    ],
    next: "There is no answer to enter here. Continue when you can describe what the patch changes.",
  },
  {
    title: "Sort claims by what you can verify",
    points: [
      "Supported: the information shown or a check you performed directly backs the claim.",
      "Assumption: the claim treats something as true without establishing it.",
      "Unverifiable: there is not enough information yet to judge the claim.",
    ],
    answerFrame: "Claim C__ needs more scrutiny because __. I would check __ to find out whether it holds.",
    next: "Label all five claims and write a short reason (at least 20 characters).",
  },
  {
    title: "Choose checks that answer the real question",
    points: [
      "Ask whether each check can tell you who may open an invoice after this change.",
      "A passing test is useful only for the cases that test actually covers.",
      "Compare the ticket, code change, reachable roles, and available helpers where relevant.",
    ],
    next: "Select one or more checks, then press Run selected checks to reveal their results.",
  },
  {
    title: "Write a reviewable developer note",
    points: [
      "State what the patch changes and who could be affected.",
      "Name the evidence you checked and what it did or did not show.",
      "Tell the reviewer what still needs verification. Choose the risk level based on possible impact.",
    ],
    answerFrame: "The change affects __. I checked __, which showed __. The reviewer should verify __.",
    next: "Write a specific note (at least 25 characters) and choose Low, Medium, or High.",
  },
  {
    title: "Decide as an independent reviewer",
    points: [
      "Approve only if the evidence supports the required access rule.",
      "Reject when you can describe a required correction. Escalate when the risk needs specialist review or you lack certainty.",
      "Connect your reason to the ticket and evidence. The named reviewer owns this decision.",
    ],
    answerFrame: "I chose __ because the evidence shows __. Before this change can proceed, __.",
    next: "Choose one action, write a reason (at least 20 characters), and enter the reviewer's name.",
  },
  {
    title: "Check whether the decision can be reconstructed",
    points: [
      "Read the evidence_checked, developer_note, reviewer_action, and reviewer_note fields.",
      "Ask whether another person could understand what happened and why from this record.",
      "Use Back if a field is unclear. The record also shows what information is excluded for privacy.",
    ],
    next: "There is no new input here. Review the record, then open the rubric feedback.",
  },
  {
    title: "Use the feedback to improve your reasoning",
    points: [
      "Read R1–R5 separately to see which part of the review needs work.",
      "Compare the test result with the access rule the tests were meant to cover.",
      "Inspect the expected safe fix. If a score misses a valid reason you gave, use Challenge this score and cite the evidence.",
    ],
    answerFrame: "Please reconsider R__ because my response identified __ and the evidence was __.",
    next: "You can review the scenario again after reading the feedback.",
  },
] as const;

export default function Home() {
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [expectation, setExpectation] = useState("");
  const [claimLabels, setClaimLabels] = useState<Record<string, ClaimLabel>>({});
  const [claimJustification, setClaimJustification] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [checksRun, setChecksRun] = useState(false);
  const [developerJustification, setDeveloperJustification] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | "">("");
  const [reviewerReason, setReviewerReason] = useState("");
  const [approver, setApprover] = useState("");
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challenge, setChallenge] = useState("");

  const timestamp = useMemo(() => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date()), []);
  const role = step <= 5 ? "Developer" : "Reviewer";
  const roleHint = step <= 5 ? "Propose. Explain. Verify." : "Challenge. Decide. Own.";

  const advance = () => {
    const next = Math.min(8, step + 1);
    setStep(next);
    setMaxStep((current) => Math.max(current, next));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setStep((current) => Math.max(1, current - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleEvidence = (id: string) => {
    setChecksRun(false);
    setSelectedEvidence((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const scores = useMemo(() => {
    const reasoning = `${developerJustification} ${reviewerReason}`.toLowerCase();
    const identifiesGap = /(authori[sz]ation|access|other customer|role|ownership)/.test(reasoning);
    const relevantEvidence = selectedEvidence.filter((id) => ["ticket", "diff", "reachability", "helper"].includes(id)).length;
    const r1 = identifiesGap ? 30 : reasoning.length > 25 ? 10 : 0;
    const r2 = relevantEvidence >= 2 ? 25 : relevantEvidence === 1 ? 14 : selectedEvidence.length ? 5 : 0;
    const correctLabels = Number(claimLabels.c2 === "assumption") + Number(claimLabels.c4 === "unverifiable");
    const r3 = correctLabels === 2 && claimJustification.length >= 25 ? 20 : correctLabels * 7;
    const r4 = reviewDecision === "reject" || reviewDecision === "escalate" ? 15 : 0;
    const r5 = approver.trim() && riskLevel === "high" && reviewerReason.trim().length >= 20 ? 10 : approver.trim() ? 5 : 0;
    return [r1, r2, r3, r4, r5];
  }, [approver, claimJustification, claimLabels, developerJustification, reviewDecision, reviewerReason, riskLevel, selectedEvidence]);

  const total = scores.reduce((sum, score) => sum + score, 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setStep(1)} aria-label="TraceCode home">
          <span className="brand-mark">T/C</span>
          <span>TraceCode</span>
        </button>
        <div className="scenario-chip"><span>SUP-482</span><i />High risk</div>
      </header>

      <section className="course-frame" id="top">
        <aside className="lesson-rail">
          <div>
            <p className="eyebrow">Learning scenario 01</p>
            <h1>Who owns an<br />AI decision?</h1>
            <p className="rail-copy">Practice separating fluent explanations from evidence you can defend.</p>
          </div>
          <div className="role-card" key={role}>
            <p>Your role</p>
            <strong>{role}</strong>
            <span>{roleHint}</span>
          </div>
        </aside>

        <div className="lesson-main">
          <nav className="progress" aria-label="Scenario progress">
            {Array.from({ length: 8 }, (_, index) => {
              const number = index + 1;
              return (
                <button
                  className={`progress-step ${number === step ? "active" : ""} ${number < step ? "done" : ""}`}
                  disabled={number > maxStep}
                  key={number}
                  onClick={() => setStep(number)}
                  aria-current={number === step ? "step" : undefined}
                  aria-label={`Go to step ${number}`}
                >
                  <span>{String(number).padStart(2, "0")}</span><i />
                </button>
              );
            })}
          </nav>

          {step === 1 && (
            <>
              <StepHeading eyebrow="Step 01 · Form an expectation" title="Scenario briefing" description="Read the requirement and current code before any AI output appears." />
              <StepGuide step={step} />
              <div className="brief-grid">
                <article className="panel requirement-panel">
                  <PanelLabel left="Requirement" right="Ticket SUP-482" />
                  <h3>Support agents cannot open some customer invoices.</h3>
                  <p>The endpoint only returns invoices belonging to the requesting user. Update it so support agents can retrieve any invoice to answer billing questions.</p>
                  <div className="context-note"><span>Known context</span><p><code>current_user.has_role(&quot;support&quot;)</code> already exists. Roles are customer, support, and admin. Any authenticated user can reach this endpoint.</p></div>
                </article>
                <CodePanel label="Current code" file="app/api/invoices.py" code={existingCode} footer="8 lines" />
              </div>
              <section className="reflection-card">
                <div className="reflection-number">01</div>
                <div className="reflection-copy">
                  <p className="eyebrow">Before you see any AI output</p>
                  <label htmlFor="expectation">What would you check before changing this endpoint?</label>
                  <textarea id="expectation" value={expectation} onChange={(event) => setExpectation(event.target.value)} placeholder="Write one sentence. Think about roles, reachability, and the intended boundary…" />
                  <p className="privacy-note">Your answer becomes part of the review record. No raw AI prompt is stored.</p>
                </div>
              </section>
              <StepFooter note="AI suggestion hidden until you continue" disabled={!expectation.trim()} onNext={advance} next="Continue to AI suggestion" />
            </>
          )}

          {step === 2 && (
            <>
              <StepHeading eyebrow="Step 02 · Inspect without anchoring" title="AI suggestion" description="The suggestion and your review area carry equal visual weight. Nothing has been approved yet." />
              <StepGuide step={step} />
              <div className="balanced-grid">
                <CodePanel label="AI-suggested patch" file="2 lines removed · 0 added" code={suggestedCode} footer="1 file changed" diff />
                <article className="panel explanation-panel">
                  <PanelLabel left="AI explanation" right="Unverified" />
                  <div className="ai-badge"><span>AI</span>Generated rationale</div>
                  <p>Removing the ownership condition resolves the reported issue. The endpoint remains protected because authentication is still required, 404 handling is preserved, the change is minimal and low risk, and the existing tests continue to pass.</p>
                  <div className="caution-line"><i />Fluency is not evidence. You will label every claim next.</div>
                </article>
              </div>
              <div className="expectation-recall"><span>Your expectation before seeing AI</span><p>“{expectation}”</p></div>
              <StepFooter note="No review outcome is visually recommended" onBack={back} onNext={advance} next="Evaluate the explanation" />
            </>
          )}

          {step === 3 && (
            <>
              <StepHeading eyebrow="Step 03 · Explanation quality" title="Label every claim" description="Decide whether each statement is supported by evidence, an assumption, or unverifiable." />
              <StepGuide step={step} />
              <section className="claim-table panel">
                <div className="claim-header"><span>Claim from the AI explanation</span>{labels.map((label) => <span key={label.value}>{label.title}</span>)}</div>
                {claims.map((claim, index) => (
                  <div className="claim-row" key={claim.id}>
                    <p><b>C{index + 1}</b>{claim.text}</p>
                    {labels.map((label) => (
                      <label className="radio-cell" key={label.value} title={label.title}>
                        <input type="radio" name={claim.id} value={label.value} checked={claimLabels[claim.id] === label.value} onChange={() => setClaimLabels((current) => ({ ...current, [claim.id]: label.value }))} />
                        <span>{label.title}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </section>
              <section className="short-answer panel">
                <div><p className="eyebrow">Justify one label</p><label htmlFor="claim-reason">Which claim deserves the most scrutiny, and why?</label></div>
                <textarea id="claim-reason" value={claimJustification} onChange={(event) => setClaimJustification(event.target.value)} placeholder="Passing tests may still leave a missing authorization case because…" />
              </section>
              <StepFooter note={`${Object.keys(claimLabels).length} of 5 claims labelled`} onBack={back} disabled={Object.keys(claimLabels).length < 5 || claimJustification.trim().length < 20} onNext={advance} next="Choose evidence" />
            </>
          )}

          {step === 4 && (
            <>
              <StepHeading eyebrow="Step 04 · Verification" title="Choose your evidence" description="Results appear only for the checks you select. Green results can still answer the wrong question." />
              <StepGuide step={step} />
              <div className="evidence-layout">
                <section className="evidence-list panel">
                  <PanelLabel left="Checks to run" right={`${selectedEvidence.length} selected`} />
                  {evidenceOptions.map((item) => (
                    <label className={`evidence-option ${selectedEvidence.includes(item.id) ? "selected" : ""}`} key={item.id}>
                      <input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => toggleEvidence(item.id)} />
                      <span className="custom-check">✓</span>
                      <span><strong>{item.title}</strong><small>{item.relevant}</small></span>
                    </label>
                  ))}
                  <button className="run-button" disabled={!selectedEvidence.length} onClick={() => setChecksRun(true)}>Run selected checks <span>↗</span></button>
                </section>
                <section className={`results-panel panel ${!checksRun ? "empty" : ""}`} aria-live="polite">
                  <PanelLabel left="Evidence results" right={checksRun ? `${selectedEvidence.length} returned` : "Waiting"} />
                  {!checksRun ? <div className="empty-state"><span>?</span><strong>Unchecked evidence stays hidden</strong><p>Select the checks that can actually test the claim.</p></div> : (
                    <div className="result-stack">{evidenceOptions.filter((item) => selectedEvidence.includes(item.id)).map((item) => (
                      <article className={`result-card ${item.tone}`} key={item.id}><span>{item.tone === "danger" ? "!" : item.tone === "warn" ? "△" : "✓"}</span><div><strong>{item.result}</strong><p>{item.detail}</p></div></article>
                    ))}</div>
                  )}
                </section>
              </div>
              <StepFooter note="Only selected checks become part of the audit trail" onBack={back} disabled={!checksRun} onNext={advance} next="Make developer decision" />
            </>
          )}

          {step === 5 && (
            <>
              <StepHeading eyebrow="Step 05 · Human accountability" title="Developer decision" description="You proposed the change. You can explain and submit it, but you cannot approve it yourself." />
              <StepGuide step={step} />
              <div className="role-banner"><span>Role · Developer</span><strong>Self-approval is disabled by design.</strong><p>The only available action is to submit this change for an independent review.</p></div>
              <section className="decision-form panel">
                <label htmlFor="developer-note">Your justification</label>
                <textarea id="developer-note" value={developerJustification} onChange={(event) => setDeveloperJustification(event.target.value)} placeholder="Summarize the risk, the evidence you checked, and what the reviewer should verify…" />
                <fieldset><legend>Self-declared risk level</legend><div className="choice-row">{["low", "medium", "high"].map((risk) => <label className={riskLevel === risk ? "selected" : ""} key={risk}><input type="radio" name="risk" value={risk} checked={riskLevel === risk} onChange={() => setRiskLevel(risk)} /><span>{risk}</span></label>)}</div></fieldset>
                <div className="system-risk"><span>System-assigned risk</span><strong>Authorization · High</strong><p>A mismatch with your rating is recorded and addressed in feedback.</p></div>
              </section>
              <StepFooter note="Your action: submit for independent review" onBack={back} disabled={developerJustification.trim().length < 25 || !riskLevel} onNext={advance} next="Submit for review" />
            </>
          )}

          {step === 6 && (
            <>
              <StepHeading eyebrow="Step 06 · Independent review" title="Reviewer decision" description="Same change, different role. Approve, reject, and escalate have identical visual weight." />
              <StepGuide step={step} />
              <div className="review-context">
                <article className="panel"><PanelLabel left="Proposed change" right={`${selectedEvidence.length} checks`} /><pre><code>- if invoice.user_id != current_user.id:{`\n`}    - raise 404</code></pre><p>Developer risk: <b>{riskLevel || "Not declared"}</b></p></article>
                <article className="panel"><PanelLabel left="Developer justification" right="Submitted" /><blockquote>“{developerJustification}”</blockquote></article>
              </div>
              <section className="review-form">
                <fieldset><legend>Your decision</legend><div className="review-choices">
                  {([{ id: "approve", title: "Approve", description: "Accept the patch" }, { id: "reject", title: "Reject", description: "Return with a required fix" }, { id: "escalate", title: "Escalate", description: "Send to security reviewer" }] as const).map((choice) => (
                    <label className={reviewDecision === choice.id ? "selected" : ""} key={choice.id}><input type="radio" name="decision" value={choice.id} checked={reviewDecision === choice.id} onChange={() => setReviewDecision(choice.id)} /><span className="decision-dot" /><strong>{choice.title}</strong><small>{choice.description}</small></label>
                  ))}
                </div></fieldset>
                <div className="review-fields"><label>Reason<textarea value={reviewerReason} onChange={(event) => setReviewerReason(event.target.value)} placeholder="Tie your decision to the risk and evidence…" /></label><label>Named approver<input value={approver} onChange={(event) => setApprover(event.target.value)} placeholder="Full name" /></label></div>
              </section>
              <StepFooter note="No option is pre-selected" onBack={back} disabled={!reviewDecision || reviewerReason.trim().length < 20 || !approver.trim()} onNext={advance} next="Record decision" />
            </>
          )}

          {step === 7 && (
            <>
              <StepHeading eyebrow="Step 07 · Auditability" title="Decision log entry" description="This is exactly what will be stored. The audit trail is part of the lesson—not an afterthought." />
              <StepGuide step={step} />
              <section className="log-card panel">
                <div className="log-head"><div><span>Immutable learning record</span><strong>TRACE / SUP-482 / 01</strong></div><div className="status-stamp">Recorded</div></div>
                <dl>
                  <LogRow label="scenario" value="SUP-482 / missing authorization check" />
                  <LogRow label="ai_suggestion" value="remove ownership condition from get_invoice" />
                  <LogRow label="risk_area" value="authorization (system-assigned: HIGH)" />
                  <LogRow label="evidence_checked" value={selectedEvidence.join(", ") || "none"} />
                  <LogRow label="developer_action" value="submitted for review" />
                  <LogRow label="developer_note" value={developerJustification} />
                  <LogRow label="reviewer_action" value={reviewDecision || "not recorded"} />
                  <LogRow label="reviewer_note" value={reviewerReason} />
                  <LogRow label="approved_by" value={approver} />
                  <LogRow label="timestamp" value={timestamp} />
                </dl>
                <div className="privacy-strip"><b>Privacy boundary</b><span>No raw prompt text stored</span><span>All scenario code is synthetic</span></div>
              </section>
              <StepFooter note="Records are anonymised for learning-progress reporting" onBack={back} onNext={advance} next="See rubric feedback" />
            </>
          )}

          {step === 8 && (
            <>
              <StepHeading eyebrow="Step 08 · Transparent feedback" title="Your reasoning, scored" description="Scores are separated by dimension. More than one human decision can be defensible." />
              <StepGuide step={step} />
              <section className="score-hero"><div><p>Scenario score</p><strong>{total}<span>/100</span></strong></div><p>{total >= 80 ? "Strong accountable review" : total >= 60 ? "Promising—strengthen the evidence trail" : "Revisit the gap between tests and authorization"}</p></section>
              <div className="rubric-layout">
                <section className="rubric-panel panel">
                  <RubricRow label="R1 · Identified the authorization gap" score={scores[0]} max={30} />
                  <RubricRow label="R2 · Evidence selection" score={scores[1]} max={25} />
                  <RubricRow label="R3 · Explanation versus proof" score={scores[2]} max={20} />
                  <RubricRow label="R4 · Appropriate action" score={scores[3]} max={15} />
                  <RubricRow label="R5 · Accountability record" score={scores[4]} max={10} />
                </section>
                <aside className="why-panel panel"><p className="eyebrow">Why this score</p><h3>Reject and escalate can both earn full credit.</h3><p>Reject is appropriate when you can state the safe fix. Escalate is appropriate when you identify the risk but lack authority or certainty.</p><span className="outcome-pill">Your action · {reviewDecision || "—"}</span></aside>
              </div>
              <section className="trap-card"><div><span>12</span><small>tests passed</small></div><div><p className="eyebrow">The test trap</p><h3>The result was correct—and it answered the wrong question.</h3><p>No existing test requests an invoice belonging to another customer, so the suite cannot detect the authorization gap.</p></div></section>
              <section className="safe-fix panel"><PanelLabel left="Expected safe fix" right="Revealed after feedback" /><pre><code>{safeFix}</code></pre></section>
              {challengeOpen && <section className="challenge-box"><label htmlFor="challenge">Challenge this score</label><textarea id="challenge" value={challenge} onChange={(event) => setChallenge(event.target.value)} placeholder="Which dimension should be reconsidered, and what evidence supports your challenge?" /><button disabled={challenge.trim().length < 20} onClick={() => setChallengeOpen(false)}>Submit challenge</button></section>}
              <div className="results-actions"><button className="secondary-button" onClick={() => setChallengeOpen((current) => !current)}>Challenge this score</button><button className="primary-button" onClick={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Review the scenario again <span>↻</span></button></div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function StepHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="step-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><p>{description}</p></div>;
}

function StepGuide({ step }: { step: number }) {
  const guide = stepGuides[step - 1];
  return <details className="step-guide" open key={step}>
    <summary><span className="guide-tag">Guide · {String(step).padStart(2, "0")}</span><strong>{guide.title}</strong><span className="guide-toggle">Show / hide</span></summary>
    <div className="guide-body">
      <ul>{guide.points.map((point) => <li key={point}>{point}</li>)}</ul>
      {"answerFrame" in guide && <p className="guide-example"><strong>Example structure</strong><span>{guide.answerFrame}</span></p>}
      <p className="guide-next"><strong>To continue</strong>{guide.next}</p>
    </div>
  </details>;
}

function PanelLabel({ left, right }: { left: string; right: string }) {
  return <div className="panel-label"><span>{left}</span><b>{right}</b></div>;
}

function CodePanel({ label, file, code, footer, diff = false }: { label: string; file: string; code: string; footer: string; diff?: boolean }) {
  return <article className={`panel code-panel ${diff ? "diff-panel" : ""}`}><PanelLabel left={label} right={file} /><pre><code>{code}</code></pre><div className="code-footer"><span>Python</span><span>{footer}</span></div></article>;
}

function StepFooter({ note, disabled = false, onBack, onNext, next }: { note: string; disabled?: boolean; onBack?: () => void; onNext: () => void; next: string }) {
  return <footer className="step-footer"><div>{onBack && <button className="back-button" onClick={onBack}><span>←</span> Back</button>}<p><span className="lock-dot" />{note}</p></div><button className="primary-button" disabled={disabled} onClick={onNext}>{next} <span>→</span></button></footer>;
}

function LogRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
}

function RubricRow({ label, score, max }: { label: string; score: number; max: number }) {
  return <div className="rubric-row"><div><span>{label}</span><strong>{score}/{max}</strong></div><div className="score-track"><i style={{ width: `${(score / max) * 100}%` }} /></div></div>;
}
