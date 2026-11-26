import Link from "next/link";

/** What a page shows before there's anything in it: what will appear, and where to start. */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="dash">
      <div className="panel s12 empty">
        <h1>{title}</h1>
        <p className="sentence">{body}</p>
        <Link className="btn primary" href="/connections">Go to Connections</Link>
      </div>
    </div>
  );
}
