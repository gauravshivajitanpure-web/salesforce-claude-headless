export function Card({ title, subtitle, children, footer, tone = "default" }) {
    return (
        <section className={`card card-${tone}`}>
            <header className="card-header">
                <div>
                    <h2>{title}</h2>
                    {subtitle ? <p>{subtitle}</p> : null}
                </div>
            </header>
            <div className="card-body">{children}</div>
            {footer ? <footer className="card-footer">{footer}</footer> : null}
        </section>
    );
}

export function Field({ label, value, children }) {
    return (
        <div className="field">
            <div className="field-label">{label}</div>
            <div className="field-value">{children ?? value ?? "—"}</div>
        </div>
    );
}

export function Button({ children, variant = "secondary", ...props }) {
    return (
        <button className={`button button-${variant}`} type="button" {...props}>
            {children}
        </button>
    );
}

export function Badge({ children, tone = "neutral" }) {
    return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Alert({ children, tone = "warning" }) {
    return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function SectionTitle({ children }) {
    return <h3 className="section-title">{children}</h3>;
}

export function RecordId({ children }) {
    if (!children) return null;
    return <code className="record-id">{children}</code>;
}
