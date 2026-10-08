import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import {
    Alert,
    Badge,
    Button,
    Card,
    Field,
    RecordId,
    SectionTitle
} from "./components/UI.jsx";

const EMPTY = {
    version: 1,
    view: "requirements",
    workflowId: "",
    data: {}
};

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
}

function money(value, currency = "USD") {
    if (value === undefined || value === null || value === "") return "—";
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return String(value);
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency,
            maximumFractionDigits: 2
        }).format(numeric);
    } catch {
        return `${currency} ${numeric}`;
    }
}

function niceDate(value) {
    if (!value) return "—";
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(parsed);
}

function normalizeUiProductName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function mergeWorkspaceData(current, incoming) {
    const left = current && typeof current === "object" ? current : {};
    const right = incoming && typeof incoming === "object" ? incoming : {};
    const result = { ...left };

    for (const [key, value] of Object.entries(right)) {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            left[key] &&
            typeof left[key] === "object" &&
            !Array.isArray(left[key])
        ) {
            result[key] = mergeWorkspaceData(left[key], value);
        } else {
            result[key] = clone(value);
        }
    }

    return result;
}

function Progress({ view }) {
    const steps = ["Requirements", "Account Insights", "Opportunity", "Quote", "Products", "Review", "Complete"];
    const indexByView = {
        requirements: 0,
        insights: 1,
        opportunity: 2,
        opportunity_summary: 2,
        quote_config: 3,
        products: 4,
        review: 5,
        quote_summary: 6,
        final_summary: 6,
        error: 6
    };
    const current = indexByView[view] ?? 0;

    return (
        <div className="progress" aria-label="Workflow progress">
            {steps.map((step, index) => (
                <div key={step} className={`progress-step ${index <= current ? "active" : ""}`}>
                    <span className="progress-dot">{index + 1}</span>
                    <span>{step}</span>
                </div>
            ))}
        </div>
    );
}

export default function App() {
    const [payload, setPayload] = useState(EMPTY);
    const [view, setView] = useState("requirements");
    const [workingData, setWorkingData] = useState({});
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [displayMode, setDisplayMode] = useState("inline");
    const [canFullscreen, setCanFullscreen] = useState(false);
    const hydratedWorkflows = useRef(new Set());

    function applyStructuredPayload(structured) {
        if (!structured || typeof structured !== "object") return;
        const next = clone(structured);
        setPayload((current) => ({ ...current, ...next }));
        if (next.view) setView(next.view);
        setWorkingData((current) => mergeWorkspaceData(current, next.data || {}));
        setErrorMessage("");
        setBusy(false);
    }

    const { app, isConnected, error } = useApp({
        appInfo: { name: "Salesforce Revenue Workspace", version: "3.0.0" },
        capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        onAppCreated: (createdApp) => {
            createdApp.ontoolresult = (result) => {
                const structured = result?.structuredContent;
                if (!structured || typeof structured !== "object") return;

                applyStructuredPayload(structured);

                const id = structured.workflowId;
                if (!id || hydratedWorkflows.current.has(id)) return;

                hydratedWorkflows.current.add(id);

                // The host recreates an MCP App from the ORIGINAL tool result when
                // a chat is reopened. Immediately replace that snapshot with the
                // latest server-persisted workflow state.
                void createdApp.callServerTool({
                    name: "workspace_get_state",
                    arguments: { workflowId: id }
                }).then((savedResult) => {
                    const saved = savedResult?.structuredContent;
                    if (saved && typeof saved === "object") {
                        applyStructuredPayload(saved);
                    }
                }).catch((restoreError) => {
                    console.warn("Could not restore Revenue Workspace state", restoreError);
                });
            };

            createdApp.onhostcontextchanged = (ctx) => {
                if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
                if (Array.isArray(ctx?.availableDisplayModes)) {
                    setCanFullscreen(ctx.availableDisplayModes.includes("fullscreen"));
                }
            };
        }
    });

    useEffect(() => {
        if (!app || !isConnected) return;
        const ctx = app.getHostContext?.();
        if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
        if (Array.isArray(ctx?.availableDisplayModes)) {
            setCanFullscreen(ctx.availableDisplayModes.includes("fullscreen"));
        }
    }, [app, isConnected]);

    async function toggleDisplayMode() {
        if (!app || !canFullscreen) return;
        try {
            const nextMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
            const result = await app.requestDisplayMode({ mode: nextMode });
            if (result?.mode) setDisplayMode(result.mode);
        } catch (displayError) {
            setErrorMessage(`Could not change workspace display mode: ${displayError?.message || String(displayError)}`);
        }
    }

    const workflowId = payload.workflowId || "workflow";
    const data = workingData || {};
    const requirements = data.requirements || {};
    const salesforce = data.salesforce || {};
    const selection = data.selection || {};
    const operationSummary = data.operationSummary || {};
    const finalSummary = data.finalSummary || {};
    const nextActions = data.nextActions || [];

    const products = useMemo(() => {
        return clone(selection.products || salesforce.products || requirements.products || []);
    }, [selection.products, salesforce.products, requirements.products]);

    async function callWorkspaceTool(name, args) {
        setBusy(true);
        setErrorMessage("");
        try {
            const result = await app.callServerTool({
                name,
                arguments: args
            });

            if (result?.isError) {
                const message = (result.content || [])
                    .filter((item) => item?.type === "text")
                    .map((item) => item.text)
                    .join("\n");
                throw new Error(message || `Tool ${name} failed.`);
            }

            const structured = result?.structuredContent;
            if (structured && typeof structured === "object") {
                applyStructuredPayload(structured);
            }

            setBusy(false);
            return result;
        } catch (toolError) {
            setErrorMessage(toolError?.message || String(toolError));
            setBusy(false);
            throw toolError;
        }
    }

    async function persistLocalView(nextView, patch = {}) {
        const nextData = mergeWorkspaceData(workingData, patch);
        setWorkingData(nextData);
        setView(nextView);

        try {
            const result = await app.callServerTool({
                name: "workspace_save_state",
                arguments: {
                    workflowId,
                    view: nextView,
                    data: nextData
                }
            });

            const structured = result?.structuredContent;
            if (structured && typeof structured === "object") {
                applyStructuredPayload(structured);
            }
        } catch (saveError) {
            setErrorMessage(`The current step could not be persisted: ${saveError?.message || String(saveError)}`);
        }
    }

    function patchSelection(patch) {
        setWorkingData((current) => ({
            ...current,
            selection: {
                ...(current.selection || {}),
                ...patch
            }
        }));
    }

    async function chooseExistingOpportunity(opportunity) {
        await persistLocalView("opportunity_summary", {
            selection: {
                ...selection,
                opportunityMode: "existing",
                opportunity
            },
            salesforce: {
                ...salesforce,
                selectedOpportunity: opportunity
            },
            operationSummary: {
                kind: "opportunity_selected",
                success: true,
                title: "Opportunity Selected",
                message: "This existing Opportunity will be used for the quote.",
                record: opportunity
            }
        });
    }

    async function addInsightRecommendation(recommendation) {
        const currentRequirements = clone(workingData.requirements || requirements);
        const currentSelection = clone(workingData.selection || selection);
        const currentProducts = Array.isArray(currentRequirements.products) ? currentRequirements.products : [];
        const wanted = normalizeUiProductName(recommendation?.product?.name);
        const alreadyPresent = currentProducts.some(product => normalizeUiProductName(product?.name) === wanted);
        const nextProducts = alreadyPresent
            ? currentProducts
            : [
                ...currentProducts,
                {
                    name: recommendation.product.name,
                    quantity: 1,
                    notes: `Added by AE from Account Insights: ${recommendation.label || recommendation.type}`
                }
            ];
        const decisions = currentSelection.insightDecisions || {};
        const accepted = [...new Set([...(decisions.accepted || []), recommendation.id])];
        const dismissed = (decisions.dismissed || []).filter(id => id !== recommendation.id);

        await persistLocalView("insights", {
            requirements: { ...currentRequirements, products: nextProducts },
            selection: {
                ...currentSelection,
                insightDecisions: { ...decisions, accepted, dismissed }
            }
        });
    }

    async function removeInsightRecommendation(recommendation) {
        const currentRequirements = clone(workingData.requirements || requirements);
        const currentSelection = clone(workingData.selection || selection);
        const wanted = normalizeUiProductName(recommendation?.product?.name);
        const decisions = currentSelection.insightDecisions || {};
        const accepted = (decisions.accepted || []).filter(id => id !== recommendation.id);

        // Only optional recommendations can be added from Account Insights, so
        // removing one here cannot remove a transcript-requested product.
        const nextProducts = (currentRequirements.products || []).filter(
            product => normalizeUiProductName(product?.name) !== wanted
        );

        await persistLocalView("insights", {
            requirements: { ...currentRequirements, products: nextProducts },
            selection: {
                ...currentSelection,
                insightDecisions: { ...decisions, accepted }
            }
        });
    }

    async function dismissInsightRecommendation(recommendation) {
        const currentSelection = clone(workingData.selection || selection);
        const decisions = currentSelection.insightDecisions || {};
        const dismissed = [...new Set([...(decisions.dismissed || []), recommendation.id])];
        const accepted = (decisions.accepted || []).filter(id => id !== recommendation.id);

        await persistLocalView("insights", {
            selection: {
                ...currentSelection,
                insightDecisions: { ...decisions, accepted, dismissed }
            }
        });
    }

    async function restoreInsightRecommendation(recommendation) {
        const currentSelection = clone(workingData.selection || selection);
        const decisions = currentSelection.insightDecisions || {};
        await persistLocalView("insights", {
            selection: {
                ...currentSelection,
                insightDecisions: {
                    ...decisions,
                    dismissed: (decisions.dismissed || []).filter(id => id !== recommendation.id)
                }
            }
        });
    }

    if (error) {
        return <div className="shell"><Alert tone="error">MCP App error: {error.message}</Alert></div>;
    }

    if (!isConnected) {
        return <div className="shell"><Card title="Salesforce Revenue Workspace"><p>Connecting to Claude…</p></Card></div>;
    }

    return (
        <main className={`shell${view === "insights" ? " shell-wide" : ""}${displayMode === "fullscreen" ? " shell-fullscreen" : ""}`}>
            <div className="workspace-header">
                <div>
                    <div className="eyebrow">Salesforce Revenue Cloud</div>
                    <h1>Revenue Workspace</h1>
                </div>
                <div className="workspace-header-actions">
                    {canFullscreen ? (
                        <Button onClick={toggleDisplayMode}>
                            {displayMode === "fullscreen" ? "Exit Full Screen" : "Expand Workspace"}
                        </Button>
                    ) : null}
                </div>
            </div>

            <Progress view={view} />

            {errorMessage ? <Alert tone="error">{errorMessage}</Alert> : null}

            {view === "requirements" ? (
                <RequirementsView
                    requirements={requirements}
                    nextActions={nextActions}
                    busy={busy}
                    onContinue={async () => {
                        if (salesforce.accountInsights?.analysisComplete) {
                            await persistLocalView("insights");
                            return;
                        }

                        await callWorkspaceTool("workspace_analyze_account_insights", {
                            workflowId,
                            requirements: workingData.requirements || requirements,
                            carryForward: workingData
                        });
                    }}
                />
            ) : null}

            {view === "insights" ? (
                <AccountInsightsView
                    requirements={requirements}
                    insights={salesforce.accountInsights || {}}
                    selection={selection}
                    busy={busy}
                    onBack={() => persistLocalView("requirements")}
                    onAddRecommendation={addInsightRecommendation}
                    onRemoveRecommendation={removeInsightRecommendation}
                    onDismissRecommendation={dismissInsightRecommendation}
                    onRestoreRecommendation={restoreInsightRecommendation}
                    onContinue={async () => {
                        const latestRequirements = workingData.requirements || requirements;
                        if (salesforce.discoveryComplete) {
                            await persistLocalView("opportunity");
                            return;
                        }

                        await callWorkspaceTool("workspace_discover_opportunities", {
                            workflowId,
                            requirements: latestRequirements,
                            carryForward: workingData
                        });
                    }}
                />
            ) : null}

            {view === "opportunity" ? (
                <OpportunityView
                    requirements={requirements}
                    salesforce={salesforce}
                    selection={selection}
                    busy={busy}
                    onBack={() => persistLocalView("insights")}
                    onUseExisting={chooseExistingOpportunity}
                    onSearch={async ({ searchTerm, page, pageSize }) => {
                        await callWorkspaceTool("workspace_discover_opportunities", {
                            workflowId,
                            requirements,
                            searchTerm,
                            page,
                            pageSize,
                            carryForward: workingData
                        });
                    }}
                    onCreate={async (newOpportunity) => {
                        patchSelection({ opportunityMode: "create", newOpportunity });
                        await callWorkspaceTool("workspace_create_opportunity", {
                            workflowId,
                            account: salesforce.account || { name: requirements.accountName },
                            opportunity: newOpportunity,
                            carryForward: workingData
                        });
                    }}
                />
            ) : null}

            {view === "opportunity_summary" ? (
                <OperationSummaryView
                    summary={operationSummary}
                    fallbackRecord={selection.opportunity || salesforce.selectedOpportunity}
                    busy={busy}
                    onBack={() => persistLocalView("opportunity")}
                    onContinue={async () => {
                        if (salesforce.quoteDiscoveryComplete) {
                            await persistLocalView("quote_config");
                            return;
                        }

                        await callWorkspaceTool("workspace_prepare_quote_context", {
                            workflowId,
                            requirements,
                            account: salesforce.account || { name: requirements.accountName },
                            opportunity:
                                selection.opportunity ||
                                operationSummary.record ||
                                salesforce.selectedOpportunity ||
                                salesforce.opportunity,
                            carryForward: workingData
                        });
                    }}
                />
            ) : null}

            {view === "quote_config" ? (
                <QuoteConfigView
                    requirements={requirements}
                    salesforce={salesforce}
                    selection={selection}
                    onBack={() => persistLocalView("opportunity_summary")}
                    onContinue={(quote) => persistLocalView("products", {
                        selection: { ...selection, quote }
                    })}
                />
            ) : null}

            {view === "products" ? (
                <ProductsView
                    products={products}
                    onBack={() => persistLocalView("quote_config")}
                    onContinue={(nextProducts) => persistLocalView("review", {
                        selection: { ...selection, products: nextProducts }
                    })}
                />
            ) : null}

            {view === "review" ? (
                <ReviewView
                    requirements={requirements}
                    salesforce={salesforce}
                    selection={selection}
                    products={products}
                    busy={busy}
                    onBack={() => persistLocalView("products")}
                    onCreateQuote={() =>
                        callWorkspaceTool("workspace_create_quote", {
                            workflowId,
                            account: salesforce.account || { name: requirements.accountName },
                            opportunity:
                                selection.opportunity ||
                                salesforce.selectedOpportunity ||
                                salesforce.opportunity,
                            quote: selection.quote || data.quote || {},
                            products,
                            requirements,
                            carryForward: workingData
                        })
                    }
                />
            ) : null}

            {view === "quote_summary" ? (
                <QuoteSummaryView
                    summary={operationSummary}
                    onOpen={async () => {
                        if (operationSummary.recordUrl) {
                            await app.openLink({ url: operationSummary.recordUrl });
                        }
                    }}
                    onContinue={() => persistLocalView("final_summary")}
                />
            ) : null}

            {view === "final_summary" ? (
                <FinalSummaryView
                    summary={Object.keys(finalSummary).length ? finalSummary : operationSummary}
                    onOpen={async () => {
                        const url = finalSummary.recordUrl || operationSummary.recordUrl;
                        if (url) await app.openLink({ url });
                    }}
                />
            ) : null}

            {view === "error" ? (
                <Card title="Salesforce Operation Failed" tone="error">
                    <Alert tone="error">{operationSummary.message || data.message || "Unknown Salesforce error."}</Alert>
                    {operationSummary.details ? <pre className="error-details">{JSON.stringify(operationSummary.details, null, 2)}</pre> : null}
                </Card>
            ) : null}

            {busy ? <div className="waiting-strip">Running Salesforce operation…</div> : null}
        </main>
    );
}

function RequirementsView({ requirements, nextActions, busy, onContinue }) {
    const products = requirements.products || [];
    return (
        <Card
            title="Customer Requirements & Next Salesforce Actions"
            subtitle="Extracted from the customer conversation. No Salesforce changes have been made yet."
            footer={<Button variant="primary" disabled={busy} onClick={onContinue}>{busy ? "Analyzing Account…" : "Analyze Account"}</Button>}
        >
            <div className="grid two">
                <Field label="Account" value={requirements.accountName} />
                <Field label="Opportunity mentioned" value={requirements.opportunityName} />
                <Field label="Start Date" value={niceDate(requirements.startDate)} />
                <Field label="Contract Term" value={requirements.termMonths ? `${requirements.termMonths} months` : "—"} />
                <Field label="Billing Frequency" value={requirements.billingFrequency} />
                <Field label="Confirmation">
                    <Badge tone={requirements.customerConfirmed ? "success" : "warning"}>
                        {requirements.customerConfirmed ? "Customer confirmed" : "Needs confirmation"}
                    </Badge>
                </Field>
            </div>

            <SectionTitle>Products</SectionTitle>
            <div className="table-wrap">
                <table>
                    <thead><tr><th>Product</th><th className="num">Qty</th></tr></thead>
                    <tbody>
                        {products.map((product, index) => (
                            <tr key={`${product.name}-${index}`}>
                                <td>{product.name}</td>
                                <td className="num">{product.quantity ?? 1}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {requirements.excluded?.length ? (
                <Alert>Explicitly excluded: {requirements.excluded.join(", ")}</Alert>
            ) : null}

            <SectionTitle>Suggested Salesforce Actions</SectionTitle>
            <ol className="next-actions">
                {(nextActions?.length ? nextActions : [
                    "Analyze Salesforce Product Usage and prepare customer-safe Account Insights",
                    "Find the Account and matching Opportunities in Salesforce",
                    "Choose an existing Opportunity or create a new Opportunity",
                    "Prepare the Quote and commercial terms",
                    "Match products, prices, and selling models",
                    "Review and confirm before creating records"
                ]).map((action, index) => (
                    <li key={`${action}-${index}`}>{action}</li>
                ))}
            </ol>

            <Alert tone="info">Continue performs read-only Salesforce discovery first. No record will be created until you explicitly confirm a write action in the workspace.</Alert>
        </Card>
    );
}

function AccountInsightsView({
    requirements,
    insights,
    selection,
    busy,
    onBack,
    onAddRecommendation,
    onRemoveRecommendation,
    onDismissRecommendation,
    onRestoreRecommendation,
    onContinue
}) {
    const [showAllHistory, setShowAllHistory] = useState(false);
    const requestedProducts = requirements.products || [];
    const history = insights.productHistory || [];
    const recommendations = insights.recommendations || [];
    const decisions = selection.insightDecisions || {};
    const accepted = new Set(decisions.accepted || []);
    const dismissed = new Set(decisions.dismissed || []);
    const visibleHistory = showAllHistory ? history : history.slice(0, 8);

    function statusTone(status) {
        if (status === "CURRENT") return "success";
        if (status === "PREVIOUSLY_USED") return "warning";
        return "neutral";
    }

    function trendText(trend) {
        if (!trend || trend.direction === "INSUFFICIENT_DATA") return "Not enough history";
        if (trend.direction === "GROWING") return `Growing${trend.percentChange !== null ? ` (+${trend.percentChange}%)` : ""}`;
        if (trend.direction === "DECLINING") return `Declining${trend.percentChange !== null ? ` (${trend.percentChange}%)` : ""}`;
        return trend.percentChange !== null ? `Stable (${trend.percentChange > 0 ? "+" : ""}${trend.percentChange}%)` : "Stable";
    }

    function priorityTone(priority) {
        if (priority === "HIGH") return "warning";
        if (priority === "MEDIUM") return "info";
        return "neutral";
    }

    function historyForRequested(product) {
        return history.find(item => normalizeUiProductName(item.productName) === normalizeUiProductName(product?.name));
    }

    return (
        <Card
            title="Account Insights & Recommendations"
            subtitle="Customer-safe talking points grounded in Salesforce Product Usage and the current conversation. No Salesforce records are changed on this step."
            footer={
                <>
                    <Button disabled={busy} onClick={onBack}>Back</Button>
                    <Button variant="primary" disabled={busy} onClick={onContinue}>
                        {busy ? "Finding Opportunities…" : "Continue to Opportunity"}
                    </Button>
                </>
            }
        >
            <div className="insights-page">
                <div className="insight-summary-grid">
                    <div className="insight-summary-card">
                        <span>Account</span>
                        <strong>{insights.account?.name || requirements.accountName || "—"}</strong>
                    </div>
                    <div className="insight-summary-card">
                        <span>Latest Usage Period</span>
                        <strong>{insights.latestUsagePeriod?.label || "No usage history"}</strong>
                    </div>
                    <div className="insight-summary-card">
                        <span>Usage Records</span>
                        <strong>{insights.usageRecordCount ?? 0}</strong>
                    </div>
                    <div className="insight-summary-card">
                        <span>Recommendations</span>
                        <strong>{recommendations.length}</strong>
                    </div>
                </div>

                {insights.analysisNote ? <Alert tone="info">{insights.analysisNote}</Alert> : null}

                <div className="insights-upper-grid">
                    <section className="insights-panel">
                        <SectionTitle>Current Customer Request</SectionTitle>
                        <div className="table-wrap current-request-table">
                            <table>
                                <thead>
                                    <tr><th>Product</th><th className="num">Qty</th><th>Salesforce context</th></tr>
                                </thead>
                                <tbody>
                                    {requestedProducts.map((product, index) => {
                                        const context = historyForRequested(product);
                                        return (
                                            <tr key={`${product.name}-${index}`}>
                                                <td><strong>{product.name}</strong></td>
                                                <td className="num">{product.quantity ?? 1}</td>
                                                <td>
                                                    {context ? <Badge tone={statusTone(context.status)}>{context.statusLabel}</Badge> : <Badge>No usage history</Badge>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="insights-panel insights-history-panel">
                        <SectionTitle>Customer Product History</SectionTitle>
                        {history.length ? (
                            <>
                                <div className="table-wrap account-history-table">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Product</th>
                                                <th>Status</th>
                                                <th className="num">Latest / Last Usage</th>
                                                <th>Last Period</th>
                                                <th>Trend</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleHistory.map((item) => (
                                                <tr key={`${item.productId || item.productName}-${item.status}`}>
                                                    <td>
                                                        <strong>{item.productName}</strong>
                                                        {item.productFamily ? <div className="muted">{item.productFamily}</div> : null}
                                                        {item.requested ? <div className="history-requested-label">In current request</div> : null}
                                                    </td>
                                                    <td><Badge tone={statusTone(item.status)}>{item.statusLabel}</Badge></td>
                                                    <td className="num">{item.lastUsageAmount ?? "—"}</td>
                                                    <td>{item.lastUsagePeriod || "—"}</td>
                                                    <td>{trendText(item.trend)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {history.length > 8 ? (
                                    <div className="history-toggle-row">
                                        <Button onClick={() => setShowAllHistory(value => !value)}>
                                            {showAllHistory ? "Show Less" : `Show All ${history.length} Products`}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <Alert tone="info">No Product Usage history was found for this account. Requested products are still shown as new-service context.</Alert>
                        )}
                    </section>
                </div>

                <SectionTitle>Recommended Customer Conversations</SectionTitle>
                {recommendations.length ? (
                    <div className="table-wrap recommendation-table-wrap">
                        <table className="recommendation-table">
                            <thead>
                                <tr>
                                    <th>Priority</th>
                                    <th>Conversation</th>
                                    <th>AE Insight</th>
                                    <th>Suggested Customer Talking Point</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recommendations.map((recommendation) => {
                                    const isAccepted = accepted.has(recommendation.id);
                                    const isDismissed = dismissed.has(recommendation.id);
                                    return (
                                        <tr
                                            className={isDismissed ? "recommendation-row-dismissed" : ""}
                                            key={recommendation.id}
                                        >
                                            <td>
                                                <div className="recommendation-priority-cell">
                                                    <Badge tone={priorityTone(recommendation.priority)}>{recommendation.priority}</Badge>
                                                    <span className="recommendation-category">{recommendation.label}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <strong className="recommendation-table-title">{recommendation.title}</strong>
                                                {recommendation.evidence?.length ? (
                                                    <details className="recommendation-table-evidence">
                                                        <summary>Why this surfaced</summary>
                                                        <ul>
                                                            {recommendation.evidence.map((evidence, index) => (
                                                                <li key={`${recommendation.id}-evidence-${index}`}>{evidence}</li>
                                                            ))}
                                                        </ul>
                                                    </details>
                                                ) : null}
                                            </td>
                                            <td className="recommendation-table-copy">{recommendation.aeInsight}</td>
                                            <td>
                                                <div className="recommendation-table-talking-point">
                                                    “{recommendation.customerTalkingPoint}”
                                                </div>
                                            </td>
                                            <td>
                                                <div className="recommendation-status-stack">
                                                    {recommendation.requestedByCustomer ? <Badge tone="success">Already requested</Badge> : null}
                                                    {isAccepted ? <Badge tone="success">Added for quote review</Badge> : null}
                                                    {isDismissed ? <Badge>Dismissed</Badge> : null}
                                                    {!recommendation.requestedByCustomer && !isAccepted && !isDismissed ? <Badge>Suggested</Badge> : null}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="recommendation-table-actions">
                                                    {isDismissed ? (
                                                        <Button disabled={busy} onClick={() => onRestoreRecommendation(recommendation)}>Restore</Button>
                                                    ) : (
                                                        <>
                                                            {recommendation.canAddToRequest && !isAccepted ? (
                                                                <Button variant="primary" disabled={busy} onClick={() => onAddRecommendation(recommendation)}>
                                                                    Add for Quote Review
                                                                </Button>
                                                            ) : null}
                                                            {recommendation.canAddToRequest && isAccepted ? (
                                                                <Button disabled={busy} onClick={() => onRemoveRecommendation(recommendation)}>
                                                                    Remove from Review
                                                                </Button>
                                                            ) : null}
                                                            <Button disabled={busy || isAccepted} onClick={() => onDismissRecommendation(recommendation)}>
                                                                Dismiss
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <Alert tone="info">No additional conversation recommendations were produced from the available Product Usage history.</Alert>
                )}

                {insights.summary?.suppressedByExplicitExclusion ? (
                    <Alert>
                        {insights.summary.suppressedByExplicitExclusion} product insight(s) were suppressed because the customer explicitly excluded that product or service area in the current conversation.
                    </Alert>
                ) : null}
            </div>
        </Card>
    );
}

function OpportunityView({ requirements, salesforce, selection, busy, onBack, onUseExisting, onSearch, onCreate }) {
    const opportunities = salesforce.matchingOpportunities || [];
    const pagination = salesforce.opportunityPagination || {
        page: 1,
        pageSize: 10,
        totalCount: opportunities.length,
        totalPages: opportunities.length ? 1 : 0,
        hasPrevious: false,
        hasNext: false,
        searchTerm: ""
    };
    const suggestedOpportunity = salesforce.suggestedOpportunity || null;
    const [mode, setMode] = useState(selection.opportunityMode === "create" ? "create" : "list");
    const [searchTerm, setSearchTerm] = useState(pagination.searchTerm || "");
    const [name, setName] = useState(
        selection.newOpportunity?.name || requirements.opportunityName || `${requirements.accountName || "Account"} Opportunity`
    );
    const [stageName, setStageName] = useState(selection.newOpportunity?.stageName || salesforce.defaultOpportunityStage || "Qualification");
    const [closeDate, setCloseDate] = useState(selection.newOpportunity?.closeDate || requirements.startDate || "");

    const visibleOpportunities = suggestedOpportunity
        ? opportunities.filter((item) => item.id !== suggestedOpportunity.id)
        : opportunities;

    async function submitSearch(event) {
        event?.preventDefault?.();
        setMode("list");
        await onSearch({ searchTerm: searchTerm.trim(), page: 1, pageSize: pagination.pageSize || 10 });
    }

    async function clearSearch() {
        setSearchTerm("");
        setMode("list");
        await onSearch({ searchTerm: "", page: 1, pageSize: pagination.pageSize || 10 });
    }

    async function changePage(nextPage) {
        await onSearch({
            searchTerm: pagination.searchTerm || searchTerm.trim(),
            page: nextPage,
            pageSize: pagination.pageSize || 10
        });
    }

    return (
        <Card title="Choose Opportunity" subtitle="Search and select an existing Salesforce Opportunity, or create a new one.">
            <div className="opportunity-page">
                <div className="opportunity-context-strip">
                    {requirements.opportunityName ? (
                        <div className="context-chip context-chip-info">
                            <span className="context-chip-label">Transcript mentioned</span>
                            <strong>{requirements.opportunityName}</strong>
                        </div>
                    ) : null}
                    {salesforce.account?.name ? (
                        <div className="context-chip context-chip-success">
                            <span className="context-chip-label">Salesforce account</span>
                            <strong>{salesforce.account.name}</strong>
                        </div>
                    ) : null}
                </div>

                {salesforce.discoveryWarning ? (
                    <Alert tone="warning">{salesforce.discoveryWarning}</Alert>
                ) : null}

                {suggestedOpportunity ? (
                    <section className="opportunity-highlight" aria-label="Suggested transcript match">
                        <div className="opportunity-highlight-icon" aria-hidden="true">★</div>
                        <div className="opportunity-highlight-content">
                            <span className="suggested-label">Best transcript match</span>
                            <strong className="opportunity-highlight-name">{suggestedOpportunity.name}</strong>
                            <div className="opportunity-highlight-meta">
                                <span className="stage-pill">{suggestedOpportunity.stageName || suggestedOpportunity.stage || "Stage not provided"}</span>
                                <span>{niceDate(suggestedOpportunity.closeDate)}</span>
                            </div>
                        </div>
                        <Button disabled={busy} variant="primary" onClick={() => onUseExisting(suggestedOpportunity)}>Use Opportunity</Button>
                    </section>
                ) : null}

                <div className="opportunity-controls">
                    <Button type="button" disabled={busy} onClick={onBack}>Back</Button>
                    <form className="opportunity-search" onSubmit={submitSearch}>
                        <div className="search-field-wrap">
                            <span className="search-icon" aria-hidden="true">⌕</span>
                            <input
                                aria-label="Search opportunities"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Search opportunities by name..."
                                disabled={busy}
                            />
                        </div>
                        <Button type="submit" disabled={busy}>Search</Button>
                        {pagination.searchTerm ? <Button type="button" disabled={busy} onClick={clearSearch}>Clear</Button> : null}
                    </form>
                    <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => setMode((current) => current === "create" ? "list" : "create")}
                    >
                        {mode === "create" ? "Back to Opportunities" : "Create New Opportunity"}
                    </Button>
                </div>

                {mode === "create" ? (
                    <div className="opportunity-create-panel">
                        <div className="create-panel-header">
                            <div>
                                <span className="create-panel-kicker">New Salesforce record</span>
                                <h3>Create Opportunity</h3>
                                <p>Review the values below before creating the Opportunity.</p>
                            </div>
                        </div>
                        <label>
                            <span>Opportunity Name</span>
                            <input value={name} onChange={(e) => setName(e.target.value)} />
                        </label>
                        <div className="grid two">
                            <label>
                                <span>Stage</span>
                                <input value={stageName} onChange={(e) => setStageName(e.target.value)} />
                            </label>
                            <label>
                                <span>Close Date</span>
                                <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
                            </label>
                        </div>
                        <div className="actions create-panel-actions">
                            <Button disabled={busy} onClick={() => setMode("list")}>Cancel</Button>
                            <Button
                                variant="primary"
                                disabled={busy || !name || !stageName || !closeDate}
                                onClick={() => onCreate({ name, stageName, closeDate })}
                            >
                                Create Opportunity
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="opportunity-list-heading">
                            <div>
                                <span className="opportunity-list-kicker">Available opportunities</span>
                                <strong>
                                    {pagination.totalCount
                                        ? `${pagination.totalCount} opportunit${pagination.totalCount === 1 ? "y" : "ies"}`
                                        : "No opportunities found"}
                                </strong>
                                {pagination.searchTerm ? <span className="muted">Matching “{pagination.searchTerm}”</span> : null}
                            </div>
                            {pagination.totalPages > 1 ? <span className="page-badge">Page {pagination.page} of {pagination.totalPages}</span> : null}
                        </div>

                        <div className="opportunity-table-shell">
                            <div className="opportunity-table-head" aria-hidden="true">
                                <span>Opportunity</span>
                                <span>Stage</span>
                                <span>Close date</span>
                                <span>Salesforce ID</span>
                                <span></span>
                            </div>
                            <div className="opportunity-list" role="list">
                                {visibleOpportunities.map((opportunity) => (
                                    <div className="opportunity-row" role="listitem" key={opportunity.id || opportunity.name}>
                                        <div className="opportunity-row-main">
                                            <strong>{opportunity.name}</strong>
                                            <span className="opportunity-row-subtext">Existing Salesforce Opportunity</span>
                                        </div>
                                        <div><span className="stage-pill">{opportunity.stageName || opportunity.stage || "Stage not provided"}</span></div>
                                        <div className="opportunity-row-date">
                                            <span className="mobile-row-label">Close date</span>
                                            <strong>{niceDate(opportunity.closeDate)}</strong>
                                        </div>
                                        <div className="opportunity-row-id">
                                            <span className="mobile-row-label">Salesforce ID</span>
                                            <RecordId>{opportunity.id}</RecordId>
                                        </div>
                                        <Button disabled={busy} onClick={() => onUseExisting(opportunity)}>Use</Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {!visibleOpportunities.length ? (
                            <div className="empty-opportunity-state">
                                <div className="empty-state-icon" aria-hidden="true">⌕</div>
                                <strong>No matching opportunities</strong>
                                <span>
                                    {pagination.searchTerm
                                        ? "Try another Opportunity name, clear the search, or create a new Opportunity."
                                        : "No existing Opportunity was found for this Salesforce Account. You can create a new one."}
                                </span>
                            </div>
                        ) : null}

                        {(pagination.hasPrevious || pagination.hasNext) ? (
                            <div className="opportunity-pagination">
                                <Button disabled={busy || !pagination.hasPrevious} onClick={() => changePage(pagination.page - 1)}>Previous</Button>
                                <span className="pagination-status">Page {pagination.page}{pagination.totalPages ? ` of ${pagination.totalPages}` : ""}</span>
                                <Button disabled={busy || !pagination.hasNext} onClick={() => changePage(pagination.page + 1)}>Next</Button>
                            </div>
                        ) : null}
                    </>
                )}
            </div>
        </Card>
    );
}

function OperationSummaryView({ summary, fallbackRecord, busy, onBack, onContinue }) {
    const record = summary.record || fallbackRecord || {};
    const title = summary.title || (summary.kind === "opportunity_created" ? "Opportunity Created" : "Opportunity Selected");
    return (
        <Card
            title={`✓ ${title}`}
            tone="success"
            footer={
                <>
                    <Button disabled={busy} onClick={onBack}>Back</Button>
                    <Button variant="primary" disabled={busy} onClick={onContinue}>{busy ? "Loading Quote Options…" : "Continue to Quote"}</Button>
                </>
            }
        >
            <div className="opportunity-summary-page">
                <div className="summary-hero">
                    <div className="summary-hero-icon" aria-hidden="true">✓</div>
                    <div>
                        <span className="summary-hero-kicker">Selection confirmed</span>
                        <strong>{record.name || "Opportunity"}</strong>
                        <p>{summary.message || "This Opportunity will be used for the quote."}</p>
                    </div>
                </div>

                <div className="summary-detail-grid">
                    <div className="summary-detail-card">
                        <span>Opportunity</span>
                        <strong>{record.name || "—"}</strong>
                    </div>
                    <div className="summary-detail-card">
                        <span>Account</span>
                        <strong>{record.accountName || "—"}</strong>
                    </div>
                    <div className="summary-detail-card">
                        <span>Stage</span>
                        <div><span className="stage-pill stage-pill-success">{record.stageName || record.stage || "—"}</span></div>
                    </div>
                    <div className="summary-detail-card">
                        <span>Close Date</span>
                        <strong>{niceDate(record.closeDate)}</strong>
                    </div>
                </div>

                {record.id ? (
                    <div className="summary-record-strip">
                        <span>Salesforce Opportunity ID</span>
                        <RecordId>{record.id}</RecordId>
                    </div>
                ) : null}
            </div>
        </Card>
    );
}

function QuoteConfigView({ requirements, salesforce, selection, onBack, onContinue }) {
    const initial = selection.quote || {};
    const [name, setName] = useState(initial.name || `${selection.opportunity?.name || requirements.opportunityName || requirements.accountName || "Customer"} Quote`);
    const [startDate, setStartDate] = useState(initial.startDate || requirements.startDate || "");
    const [termMonths, setTermMonths] = useState(initial.termMonths || requirements.termMonths || 12);
    const [billingFrequency, setBillingFrequency] = useState(initial.billingFrequency || requirements.billingFrequency || "Monthly");
    const [pricebookId, setPricebookId] = useState(initial.pricebookId || salesforce.pricebook?.id || "");

    return (
        <Card
            title="Quote Configuration"
            subtitle="Configure the quote before products are reviewed. Nothing is written yet."
            footer={
                <>
                    <Button onClick={onBack}>Back</Button>
                    <Button
                        variant="primary"
                        onClick={() => onContinue({ name, startDate, termMonths: Number(termMonths), billingFrequency, pricebookId, pricebookName: salesforce.pricebook?.name })}
                        disabled={!name || !startDate || !termMonths || !billingFrequency || !pricebookId}
                    >
                        Continue to Products
                    </Button>
                </>
            }
        >
            <label><span>Quote Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="grid two">
                <label><span>Start Date</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
                <label><span>Contract Term (months)</span><input type="number" min="1" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} /></label>
                <label>
                    <span>Billing Frequency</span>
                    <select value={billingFrequency} onChange={(e) => setBillingFrequency(e.target.value)}>
                        {["Monthly", "Quarterly", "Semi-Annual", "Annual", "One-Time"].map((item) => <option key={item}>{item}</option>)}
                    </select>
                </label>
                <Field label="Price Book" value={salesforce.pricebook?.name || pricebookId || "Not supplied"} />
            </div>
        </Card>
    );
}

function ProductsView({ products, onBack, onContinue }) {
    const [rows, setRows] = useState(() => clone(products));
    const hasUnresolved = rows.some((product) => !(product.sellingModels || []).length);

    function patch(index, patchValue) {
        setRows((current) => current.map((item, i) => i === index ? { ...item, ...patchValue } : item));
    }

    return (
        <Card
            title="Product Configuration"
            subtitle="Choose quantities and only the selling models actually returned from Salesforce."
            footer={
                <>
                    <Button onClick={onBack}>Back</Button>
                    <Button variant="primary" disabled={hasUnresolved} onClick={() => onContinue(rows)}>Review Quote</Button>
                </>
            }
        >
            <div className="product-list">
                {rows.map((product, index) => {
                    const models = product.sellingModels || [];
                    const selectedValue = product.selectedSellingModel?.value || product.selectedSellingModelValue || models[0]?.value || models[0]?.label || "";
                    const selectedModel = models.find((m) => (m.value || m.label) === selectedValue) || product.selectedSellingModel || models[0];
                    return (
                        <div className="product-card" key={`${product.productId || product.name}-${index}`}>
                            <div className="product-title-row">
                                <div>
                                    <strong>{product.name}</strong>
                                    {product.productCode ? <span className="muted">{product.productCode}</span> : null}
                                </div>
                                <strong>{money(selectedModel?.unitPrice ?? product.unitPrice, product.currency || "USD")}</strong>
                            </div>
                            <div className="grid two">
                                <label>
                                    <span>Quantity</span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={product.quantity ?? 1}
                                        onChange={(e) => patch(index, { quantity: Number(e.target.value) })}
                                    />
                                </label>
                                <label>
                                    <span>Selling Model</span>
                                    <select
                                        value={selectedValue}
                                        disabled={!models.length}
                                        onChange={(e) => {
                                            const next = models.find((m) => (m.value || m.label) === e.target.value);
                                            patch(index, { selectedSellingModel: next, selectedSellingModelValue: e.target.value });
                                        }}
                                    >
                                        {!models.length ? <option>No model supplied</option> : null}
                                        {models.map((model) => (
                                            <option key={model.value || model.label} value={model.value || model.label}>{model.label || model.value}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {models.length === 1 ? <Alert tone="info">Only one selling model is available for this product.</Alert> : null}
                        </div>
                    );
                })}
            </div>
            {hasUnresolved ? (
                <Alert tone="error">One or more products do not have an active Pricebook Entry / selling model in the selected Price Book. Resolve those products before continuing.</Alert>
            ) : null}
        </Card>
    );
}

function ReviewView({ requirements, salesforce, selection, products, busy, onBack, onCreateQuote }) {
    const quote = selection.quote || {};
    const opportunity = selection.opportunity || salesforce.selectedOpportunity || salesforce.opportunity || {};
    const hasInvalidProduct = products.some((product) => {
        const selected = product.selectedSellingModel || {};
        return !(selected.pricebookEntryId || product.pricebookEntryId || product.selectedSellingModelValue);
    });
    return (
        <Card
            title="Review Quote"
            subtitle="This is the final confirmation checkpoint before Salesforce is modified."
            footer={
                <>
                    <Button disabled={busy} onClick={onBack}>Back</Button>
                    <Button variant="primary" disabled={busy || hasInvalidProduct || !opportunity.id || !quote.pricebookId} onClick={onCreateQuote}>Create Quote</Button>
                </>
            }
        >
            <div className="grid two">
                <Field label="Account" value={requirements.accountName || salesforce.account?.name} />
                <Field label="Opportunity" value={opportunity.name || requirements.opportunityName} />
                <Field label="Quote" value={quote.name} />
                <Field label="Start Date" value={niceDate(quote.startDate)} />
                <Field label="Term" value={quote.termMonths ? `${quote.termMonths} months` : "—"} />
                <Field label="Billing" value={quote.billingFrequency} />
                <Field label="Price Book" value={quote.pricebookName || salesforce.pricebook?.name} />
            </div>
            <SectionTitle>Products</SectionTitle>
            <div className="table-wrap">
                <table>
                    <thead><tr><th>Product</th><th>Model</th><th className="num">Qty</th><th className="num">Unit Price</th></tr></thead>
                    <tbody>
                        {products.map((product, index) => {
                            const selectedModel = product.selectedSellingModel || (product.sellingModels || [])[0] || {};
                            return (
                                <tr key={`${product.productId || product.name}-${index}`}>
                                    <td>{product.name}</td>
                                    <td>{selectedModel.label || selectedModel.value || "—"}</td>
                                    <td className="num">{product.quantity ?? 1}</td>
                                    <td className="num">{money(selectedModel.unitPrice ?? product.unitPrice, product.currency || "USD")}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {hasInvalidProduct ? (
                <Alert tone="error">The Quote cannot be created until every product has a valid Pricebook Entry / selling model.</Alert>
            ) : (
                <Alert>This button is the explicit user confirmation to create the Quote and its configured lines.</Alert>
            )}
        </Card>
    );
}

function QuoteSummaryView({ summary, onOpen, onContinue }) {
    const quote = summary.record || summary.quote || {};
    return (
        <Card
            title="✓ Quote Created Successfully"
            tone="success"
            footer={
                <>
                    {summary.recordUrl ? <Button onClick={onOpen}>View Quote</Button> : null}
                    <Button variant="primary" onClick={onContinue}>Final Summary</Button>
                </>
            }
        >
            {summary.message ? <Alert tone="success">{summary.message}</Alert> : null}
            <div className="grid two">
                <Field label="Quote" value={quote.name} />
                <Field label="Status" value={quote.status || "Draft"} />
                <Field label="Opportunity" value={quote.opportunityName || quote.opportunityId} />
                <Field label="Start Date" value={niceDate(quote.startDate || summary.startDate)} />
                <Field label="Term" value={(quote.termMonths || summary.termMonths) ? `${quote.termMonths || summary.termMonths} months` : "—"} />
                <Field label="Billing" value={quote.billingFrequency || summary.billingFrequency} />
                <Field label="Quote Lines" value={quote.lineCount ?? summary.quoteLineCount ?? summary.lineCount} />
            </div>
            {quote.id ? <Field label="Salesforce ID"><RecordId>{quote.id}</RecordId></Field> : null}
        </Card>
    );
}

function FinalSummaryView({ summary, onOpen }) {
    const opportunity = summary.opportunity || {};
    const quote = summary.quote || summary.record || {};
    const products = summary.products || quote.products || [];
    return (
        <Card
            title="✓ Salesforce Transaction Complete"
            tone="success"
            footer={summary.recordUrl || quote.recordUrl ? <Button variant="primary" onClick={onOpen}>View Quote</Button> : null}
        >
            <SectionTitle>Opportunity</SectionTitle>
            <div className="grid two">
                <Field label="Name" value={opportunity.name} />
                <Field label="Action" value={opportunity.action || summary.opportunityAction} />
            </div>
            {opportunity.id ? <Field label="Opportunity ID"><RecordId>{opportunity.id}</RecordId></Field> : null}

            <SectionTitle>Quote</SectionTitle>
            <div className="grid two">
                <Field label="Name" value={quote.name} />
                <Field label="Status" value={quote.status || "Draft"} />
                <Field label="Start" value={niceDate(quote.startDate)} />
                <Field label="Term" value={quote.termMonths ? `${quote.termMonths} months` : "—"} />
                <Field label="Billing" value={quote.billingFrequency} />
            </div>
            {quote.id ? <Field label="Quote ID"><RecordId>{quote.id}</RecordId></Field> : null}

            {products.length ? (
                <>
                    <SectionTitle>Products</SectionTitle>
                    <div className="table-wrap">
                        <table>
                            <thead><tr><th>Product</th><th>Model</th><th className="num">Qty</th></tr></thead>
                            <tbody>
                                {products.map((product, index) => (
                                    <tr key={`${product.name}-${index}`}>
                                        <td>{product.name}</td>
                                        <td>{product.sellingModel || product.selectedSellingModel?.label || "—"}</td>
                                        <td className="num">{product.quantity ?? 1}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            ) : null}

            <Alert tone="success">All user-confirmed Salesforce operations in this workflow are complete.</Alert>
        </Card>
    );
}
