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
    title: "What should I write here?",
    points: [
      "AI is a tool. It can suggest code, but it cannot be responsible for releasing an unsafe change. The developer and human reviewer remain responsible for what they submit and approve.",
      "The ticket wants support agents to open customer invoices. A regular customer should still see only their own invoices.",
      "Think about who can call this page and how the code checks each person's permission.",
    ],
    sampleAnswer: "I would check which roles can call the endpoint, confirm that only support agents may open another customer's invoice, and test that a regular customer cannot open someone else's invoice.",
    next: "Type a sentence in the green box, then click Continue to AI suggestion.",
  },
  {
    title: "What am I looking at?",
    points: [
      "The AI removed the line that checks whether the invoice belongs to the current user.",
      "Anyone who is signed in can reach this endpoint. Ask whether the patch checks for the support role anywhere.",
      "The AI's explanation is a claim. You will check its separate statements on the next page.",
    ],
    next: "Nothing to type here. Click Evaluate the explanation.",
  },
  {
    title: "Which option should I choose?",
    points: [
      "Supported means a check backs the statement. Assumption means the AI has taken something for granted. Unverifiable means the current information is not enough to judge it.",
      "Passing tests does not prove that the tests checked access to another customer's invoice.",
    ],
    sampleAnswer: "C1: Supported · C2: Assumption · C3: Assumption · C4: Unverifiable · C5: Supported\n\nReason to type: The claim that authentication protects this endpoint needs scrutiny because signing in does not prove that a customer is allowed to open another customer's invoice. I would check the roles and access rule.",
    next: "Select one label in every row, type a reason, then click Choose evidence.",
  },
  {
    title: "What should I check?",
    points: [
      "Choose checks that tell you what the ticket requires and who may open an invoice after the change.",
      "Existing unit tests are worth viewing, but look at which case they do not test.",
      "Code formatting and response time cannot tell you whether access is allowed correctly.",
    ],
    sampleAnswer: "Tick these five: Run existing unit tests; Re-read the ticket text; View the full diff; Check who can reach the endpoint; Search for an existing role helper. Leave code style and response time unticked.",
    next: "Click Run selected checks, read the results on the right, then click Make developer decision.",
  },
  {
    title: "What should the developer write?",
    points: [
      "Do not use 'the AI wrote it' as an excuse. You are responsible for checking the suggestion before sending it to a reviewer.",
      "Say what the patch removes, who could access other people's data, and what you checked.",
      "This affects invoice access, so choose the risk level based on possible data exposure.",
    ],
    sampleAnswer: "Your justification: The patch removes the ownership check without adding a support-role check. The ticket, diff, and endpoint reachability show that any authenticated customer could access another customer's invoice. The reviewer should verify that only the owner or a support agent can open it.\n\nSelf-declared risk level: High",
    next: "Type the justification, select High, then click Submit for review.",
  },
  {
    title: "What should the reviewer decide?",
    points: [
      "The AI cannot approve its own suggestion. A human reviewer must decide whether the evidence supports a safe release and own that decision.",
      "The proposed patch lets any signed-in customer open another customer's invoice, so it should not be accepted as it is.",
      "Reject if you can describe the fix. Escalate is also reasonable if you need a security specialist to decide.",
    ],
    sampleAnswer: "Your decision: Reject\n\nReason: Reject because removing the ownership check allows any authenticated customer to access another customer's invoice. Keep the owner check and add an exception for the support role only.\n\nNamed approver: Enter your name as the simulated reviewer.",
    next: "Choose Reject, type the reason and a reviewer name, then click Record decision.",
  },
  {
    title: "What do I check in this record?",
    points: [
      "Check that evidence_checked lists the checks you ran, developer_note contains your explanation, and reviewer_action says reject or escalate.",
      "Check that reviewer_note explains why and approved_by shows the simulated reviewer's name.",
      "If something is missing, go Back and complete it. This page has no new input fields.",
    ],
    next: "After checking the record, click See rubric feedback.",
  },
  {
    title: "How do I read my result?",
    points: [
      "The final decision belongs to people, even when AI produced the proposed code. 'AI made the mistake' does not remove the developer's or reviewer's responsibility.",
      "R1 checks whether you identified the access problem; R2 checks your evidence; R3 checks the AI claims; R4 checks your decision; R5 checks the review record.",
      "The 12 passing tests missed the case where one customer requests another customer's invoice.",
      "The safe fix below the score allows the owner or a support agent, but blocks another customer.",
    ],
    sampleAnswer: "Optional challenge: Please reconsider R1 because I explained that the patch lets another customer view an invoice they do not own, and I supported this with the ticket, diff, and endpoint reachability.",
    next: "There is no required answer here. Read the feedback or click Review the scenario again.",
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
            <p className="rail-copy">AI can suggest a change. People must verify it, decide, and own the outcome.</p>
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
              <section className="lesson-goal" aria-label="Learning objective"><strong>Learning objective</strong><p>Explain why AI-generated code does not transfer responsibility away from the developer and reviewer. AI is a tool; people must check its work and answer for the final decision.</p></section>
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
              <StepHeading eyebrow="Step 05 · Human accountability" title="Developer decision" description="You used the AI suggestion. You must check and explain it; blaming AI cannot replace your review." />
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
              <StepHeading eyebrow="Step 06 · Independent review" title="Reviewer decision" description="A human reviewer owns the final approval decision. AI cannot make it on their behalf." />
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
              <StepHeading eyebrow="Step 07 · Auditability" title="Decision log entry" description="See which people checked the evidence, made the decision, and can explain it afterward." />
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
                  <RubricRow label="R5 · Human accountability record" score={scores[4]} max={10} />
                </section>
                <aside className="why-panel panel"><p className="eyebrow">Why this score</p><h3>Reject and escalate can both earn full credit.</h3><p>Reject is appropriate when you can state the safe fix. Escalate is appropriate when you identify the risk but lack authority or certainty.</p><p>AI is a tool, not an accountable teammate. The developer and reviewer still own their decisions.</p><span className="outcome-pill">Your action · {reviewDecision || "—"}</span></aside>
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
      {"sampleAnswer" in guide && <div className="guide-example"><strong>Example you can use</strong><p>{guide.sampleAnswer}</p></div>}
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
