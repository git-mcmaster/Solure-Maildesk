import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Bootstrap,
  LoadEvent,
  LoadEventPage,
  Notification,
  Pixel,
  PixelStatus,
  RequestMetadata,
  Settings,
} from "../server/types";

type IconName =
  | "grid"
  | "activity"
  | "bell"
  | "settings"
  | "plus"
  | "arrow"
  | "search"
  | "copy"
  | "close"
  | "check"
  | "shield"
  | "download"
  | "pause"
  | "archive"
  | "trash"
  | "mail"
  | "refresh";
type PixelPage = { items: Pixel[]; total: number; hasMore: boolean };
const paths: Record<IconName, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  close: "M6 6l12 12 M18 6 6 18",
  check: "M4 12l5 5L20 6",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  pause: "M8 4v16 M16 4v16",
  archive: "M3 3h18v5H3z M5 8v13h14V8 M9 12h6",
  trash: "M3 6h18 M8 6V3h8v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  refresh: "M20 8A8 8 0 1 0 20 16 M20 3v5h-5",
};
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "We couldn’t connect. Check your connection and try again.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string };
  } | null;
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ||
        (response.status === 401
          ? "Your session needs a fresh sign-in. Reload to continue."
          : "The request could not be completed. Please try again."),
      response.status,
    );
  if (!body || !("data" in body))
    throw new Error(
      "The server returned an unexpected response. Please reload.",
    );
  return body.data as T;
}
const statusNames: Record<PixelStatus, string> = {
  draft: "Awaiting send",
  armed: "Alerts enabled",
  paused: "Paused",
  archived: "Archived",
};
const deliveryNames: Record<string, string> = {
  none: "No alert yet",
  pending: "Queued",
  sending: "Sending",
  sent: "Accepted by email service",
  failed: "Needs attention",
  dry_run: "Local test only",
  disabled: "Email alerts off",
};
function formatDate(value: string | null, exact = false): string {
  if (!value) return "No loads recorded";
  const d = new Date(value);
  return exact
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
function htmlFor(pixel: Pixel): string {
  return `<img src="${pixel.pixelUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" width="1" height="1" alt="" style="width:1px;height:1px;border:0;" />`;
}

function requestLocation(metadata: RequestMetadata): string {
  return [metadata.city, metadata.region, metadata.country]
    .filter(Boolean)
    .join(", ") || "Location unavailable";
}

function RequestDetails({ metadata }: { metadata: RequestMetadata | null }) {
  const location = metadata
    ? requestLocation(metadata)
    : "";
  const rows: [string, string | null | undefined][] = metadata
    ? [
        ["Request IP", metadata.requestIp],
        ["Approximate request location", location],
        ["Request time zone", metadata.timezone],
        ["Network", metadata.network],
        ["Network number (ASN)", metadata.asn == null ? null : `AS${metadata.asn}`],
        ["Reported client", metadata.client],
        ["Reported platform", metadata.platform],
        ["Reported device", metadata.device],
        ["Possible proxy", metadata.proxy],
        ["Reported User-Agent", metadata.userAgent],
      ]
    : [];

  return (
    <details className="request-details">
      <summary>Request details</summary>
      {metadata ? (
        <div className="request-details-body">
          <p className="request-details-note">
            These describe the image request, not necessarily the reader. A
            proxy or privacy service may supply its own location and device
            information. No GPS location is collected.
          </p>
          <dl className="request-details-list">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "Unknown"}</dd>
              </div>
            ))}
          </dl>
          <p className="request-details-note">
            Client and device hints come from the reported User-Agent and can
            be inaccurate. An unknown proxy value does not rule out a proxy.
          </p>
        </div>
      ) : (
        <p className="request-details-note request-details-empty">
          No request details were saved for this load. Collection may have been
          off, or this load may predate the feature. Details can’t be recovered
          for earlier loads.
        </p>
      )}
    </details>
  );
}

function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Pixel | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [listItems, setListItems] = useState<Pixel[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const listRequestId = useRef(0);
  const [dialog, setDialog] = useState<
    "settings" | "notifications" | "guide" | "delete" | "clear" | null
  >(null);
  const [draft, setDraft] = useState({ label: "", recipient: "", notes: "" });
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const settingsBaselineRef = useRef<Settings | null>(null);
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [eventsCursor, setEventsCursor] = useState<string | null>(null);
  const eventsExpandedRef = useRef(false);
  const eventsPendingRef = useRef(false);
  const eventsRequestId = useRef(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const deepLinkOpened = useRef(false);
  const selected = selectedRecord;

  const load = useCallback(async () => {
    const next = await request<Bootstrap>("/api/bootstrap");
    setData(next);
    setListItems((items) =>
      items.map(
        (item) => next.pixels.find((pixel) => pixel.id === item.id) || item,
      ),
    );
    setError("");
    const id = selectedIdRef.current;
    if (id) {
      try {
        const record = await request<Pixel>(`/api/pixels/${id}`);
        if (selectedIdRef.current === id) setSelectedRecord(record);
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status === 404 &&
          selectedIdRef.current === id
        ) {
          setSelectedId(null);
          setSelectedRecord(null);
        }
      }
    }
    return next;
  }, []);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    if (!data || deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    const id = new URLSearchParams(window.location.search).get("pixel");
    if (!id) return;
    if (!/^[a-f0-9-]{32,36}$/u.test(id)) {
      setError("That message link is not valid.");
      return;
    }
    void request<Pixel>(`/api/pixels/${encodeURIComponent(id)}`)
      .then((pixel) => choose(pixel))
      .catch((err: Error) => setError(err.message));
  }, [data]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const loadList = useCallback(
    async (offset = 0) => {
      const requestId = ++listRequestId.current;
      setListLoading(true);
      try {
        const page = await request<PixelPage>(
          `/api/pixels?${new URLSearchParams({ q: debouncedSearch, status: filter, offset: String(offset), limit: "100" })}`,
        );
        if (requestId !== listRequestId.current) return;
        setListItems((items) =>
          offset
            ? [
                ...items,
                ...page.items.filter(
                  (item) => !items.some((existing) => existing.id === item.id),
                ),
              ]
            : page.items,
        );
        setListTotal(page.total);
        setHasMore(page.hasMore);
        setListError("");
      } catch (err) {
        if (requestId === listRequestId.current)
          setListError((err as Error).message);
      } finally {
        if (requestId === listRequestId.current) setListLoading(false);
      }
    },
    [debouncedSearch, filter],
  );
  useEffect(() => {
    void loadList();
    return () => {
      listRequestId.current += 1;
    };
  }, [loadList]);
  useEffect(() => {
    let alive = true;
    void load()
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load().catch((err: Error) => {
          if (alive) setError(err.message);
        });
    }, 15_000);
    const updateOnline = () => setOffline(!navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const loadEvents = useCallback(
    async (quiet = false, cursor: string | null = null) => {
      if (!selectedId) return;
      // Keep an expanded history stable while the owner reads older requests.
      // Manual refresh starts again at the newest page.
      if (quiet && (eventsExpandedRef.current || eventsPendingRef.current)) return;
      const requestId = ++eventsRequestId.current;
      eventsPendingRef.current = true;
      eventsExpandedRef.current = Boolean(cursor);
      if (!quiet) setEventsLoading(true);
      try {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const next = await request<LoadEventPage>(
          `/api/pixels/${selectedId}/events?${query}`,
        );
        if (requestId === eventsRequestId.current) {
          setEvents((current) =>
            cursor
              ? [...current, ...next.items.filter((item) => !current.some((event) => event.id === item.id))]
              : next.items,
          );
          setEventsCursor(next.nextCursor);
          eventsExpandedRef.current = Boolean(cursor);
          setEventsError("");
        }
      } catch (err) {
        if (requestId === eventsRequestId.current)
          setEventsError((err as Error).message);
      } finally {
        if (requestId === eventsRequestId.current) {
          eventsPendingRef.current = false;
          setEventsLoading(false);
        }
      }
    },
    [selectedId],
  );
  useEffect(() => {
    setEvents([]);
    setEventsCursor(null);
    eventsExpandedRef.current = false;
    if (!selectedId) return;
    void loadEvents();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadEvents(true);
    }, 15_000);
    return () => {
      eventsRequestId.current += 1;
      window.clearInterval(timer);
    };
  }, [loadEvents, selectedId]);

  async function action(key: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  function choose(pixel: Pixel) {
    setDraft({
      label: pixel.label,
      recipient: pixel.recipient,
      notes: pixel.notes,
    });
    setSelectedId(pixel.id);
    setSelectedRecord(pixel);
    selectedIdRef.current = pixel.id;
    setCopyNotice("");
  }
  async function createPixel() {
    await action("create", async () => {
      const pixel = await request<Pixel>("/api/pixels", {
        method: "POST",
        body: "{}",
      });
      await load();
      setFilter("active");
      setSearch("");
      await loadList();
      choose(pixel);
      setToast(
        "Pixel created. Copy it into your message, then return to label it.",
      );
      window.setTimeout(
        () =>
          detailRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        60,
      );
    });
  }
  async function updatePixel(status?: PixelStatus) {
    if (!selected) return;
    await action(status || "save", async () => {
      const pixel = await request<Pixel>(`/api/pixels/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...draft, ...(status ? { status } : {}) }),
      });
      setSelectedRecord(pixel);
      await load();
      await loadList();
      setDraft({
        label: pixel.label,
        recipient: pixel.recipient,
        notes: pixel.notes,
      });
      setToast(
        status === "armed"
          ? "Activity recording is active. First-load alerts are once per message unless repeat alerts are enabled."
          : status === "paused"
            ? "Alerts paused."
            : status === "archived"
              ? "Message archived."
              : "Message details saved.",
      );
    });
  }
  async function copyPixel(rich: boolean) {
    if (!selected) return;
    const html = htmlFor(selected);
    try {
      if (rich && "ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([html], { type: "text/plain" }),
          }),
        ]);
        setCopyNotice(
          "Rich HTML copied. Outlook may still embed or remove it—verify your insertion method with a test message.",
        );
      } else {
        await navigator.clipboard.writeText(html);
        setCopyNotice(
          "HTML source copied. Pasting source into a normal email body will not insert a tracking image. Use a client that supports HTML insertion.",
        );
      }
    } catch {
      setCopyNotice(
        "Clipboard access is unavailable. Select and copy the HTML below. Use a client that supports inserting HTML; pasting it as text will not track loads.",
      );
    }
  }
  async function preserveUnloadedPixel(preserveUnloaded: boolean) {
    if (!selected) return;
    const id = selected.id;
    await action("preserve", async () => {
      const pixel = await request<Pixel>(`/api/pixels/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ preserveUnloaded }),
      });
      if (selectedIdRef.current === id) setSelectedRecord(pixel);
      await load();
      await loadList();
      setToast(preserveUnloaded
        ? "This pixel will be kept even if it never loads."
        : "This pixel now follows your never-loaded pixel preference.");
    });
  }
  async function markRead(ids?: string[]) {
    await action("read", async () => {
      await request("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      });
      await load();
    });
  }
  function openSettings() {
    if (data) {
      settingsBaselineRef.current = { ...data.settings };
      setSettingsDraft({ ...data.settings });
      setDialog("settings");
    }
  }
  const filtered = listItems;
  const dirty =
    !!selected &&
    (draft.label !== selected.label ||
      draft.recipient !== selected.recipient ||
      draft.notes !== selected.notes);
  const unread = data?.stats.unread || 0;

  if (loading)
    return (
      <div className="startup">
        <div className="brand-mark">
          s<span>.</span>
        </div>
        <p>
          Opening your maildesk<span className="loading-dot">…</span>
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="startup">
        <div className="brand-mark">
          s<span>.</span>
        </div>
        <h1>Let’s reconnect.</h1>
        <p role="alert">{error || "Maildesk could not be loaded."}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          <Icon name="refresh" /> Reload Maildesk
        </button>
      </div>
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to messages
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <a href="/" className="brand" aria-label="Solure Maildesk home">
          <div className="brand-mark">
            s<span>.</span>
          </div>
          <div>
            <strong>
              solure<span className="brand-dot">.</span>
            </strong>
            <span className="brand-caption">MAILDESK</span>
          </div>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          <button
            className={filter !== "archived" ? "nav-link selected" : "nav-link"}
            onClick={() => {
              setFilter("active");
              setSearch("");
            }}
          >
            <Icon name="grid" /> Messages{" "}
            <span className="nav-count">{data.stats.total}</span>
          </button>
          <button
            className="nav-link"
            onClick={() => setDialog("notifications")}
          >
            <Icon name="bell" /> Notifications{" "}
            {unread > 0 && (
              <span className="nav-count unread-count">{unread}</span>
            )}
          </button>
          <button
            className={filter === "archived" ? "nav-link selected" : "nav-link"}
            onClick={() => setFilter("archived")}
          >
            <Icon name="archive" /> Archive
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-link" onClick={() => setDialog("guide")}>
            <Icon name="activity" /> How tracking works
          </button>
          <button className="nav-link" onClick={openSettings}>
            <Icon name="settings" /> Settings
          </button>
          <div className="owner">
            <span className="avatar">EM</span>
            <div>
              <strong>Elijah McMaster</strong>
              <span>Private workspace</span>
            </div>
            <Icon name="shield" size={16} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Maildesk</strong>
          </div>
          <div className="topbar-actions">
            {data.development && (
              <span className="environment">Local development</span>
            )}
            <span className="private-indicator">
              <Icon name="shield" size={14} />{" "}
              {data.development ? "Local access" : "Owner access"}
            </span>
            <button
              className="icon-button notification-button"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              onClick={() => setDialog("notifications")}
            >
              <Icon name="bell" />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <span className="avatar small">EM</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">A LITTLE MORE CLARITY</div>
              <h1>Your messages, in view.</h1>
              <p>Keep track of image activity. Follow up with context.</p>
            </div>
            <button
              className="button primary new-pixel"
              onClick={() => void createPixel()}
              disabled={!!busy || offline}
            >
              <Icon name="plus" />
              {busy === "create" ? "Creating…" : "New pixel"}
            </button>
          </div>
          {offline && (
            <div className="banner warning" role="status">
              You’re offline. Saved activity is shown; reconnect to make
              changes.
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() =>
                  void action("reload", async () => {
                    await load();
                  })
                }
              >
                Try again
              </button>
            </div>
          )}
          <section className="stats-grid" aria-label="Message overview">
            <Stat
              label="Messages"
              value={data.stats.total}
              icon="mail"
              footnote="Created in your workspace"
            />
            <Stat
              label="Alerts enabled"
              value={data.stats.armed}
              icon="activity"
              footnote="Messages marked for notifications"
            />
            <Stat
              label="Images loaded"
              value={data.stats.loaded}
              icon="check"
              footnote="Messages with a recorded request"
            />
          </section>
          <div className="workspace-grid">
            <section className="messages-card" aria-label="Tracked messages">
              <div className="section-heading">
                <div>
                  <h2>Messages</h2>
                  <span>
                    {filter === "archived"
                      ? "Your archived messages"
                      : "One pixel. One message. Your context."}
                  </span>
                </div>
                <a
                  className="icon-button export-button"
                  href="/api/export.csv"
                  download
                  aria-label="Export messages as CSV"
                >
                  <Icon name="download" />
                </a>
              </div>
              <div className="list-toolbar">
                <div className="tabs" aria-label="Filter messages">
                  {[
                    ["active", "Active"],
                    ["draft", "Awaiting send"],
                    ["armed", "Alerts on"],
                    ["all", "All"],
                  ].map(([value, title]) => (
                    <button
                      key={value}
                      className={filter === value ? "tab active" : "tab"}
                      onClick={() => setFilter(value)}
                      aria-pressed={filter === value}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Icon name="search" size={16} />
                  <input
                    aria-label="Search messages"
                    placeholder="Search messages"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              {listError && (
                <div className="banner error list-error" role="alert">
                  <span>{listError}</span>
                  <button
                    className="text-button"
                    onClick={() => void loadList()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {listLoading && filtered.length === 0 ? (
                <div className="list-loading" role="status">
                  Loading messages…
                </div>
              ) : filtered.length > 0 ? (
                <div className="message-list">
                  <div className="list-labels">
                    <span>MESSAGE / RECIPIENT</span>
                    <span>STATUS</span>
                    <span>LATEST ACTIVITY</span>
                  </div>
                  {filtered.map((pixel) => (
                    <button
                      className={
                        selectedId === pixel.id
                          ? "message-row is-selected"
                          : "message-row"
                      }
                      key={pixel.id}
                      onClick={() => choose(pixel)}
                      aria-pressed={selectedId === pixel.id}
                    >
                      <span className="message-description">
                        <span
                          className={
                            pixel.loadCount > 0
                              ? "message-symbol loaded"
                              : "message-symbol"
                          }
                        >
                          <Icon
                            name={pixel.loadCount > 0 ? "activity" : "mail"}
                          />
                        </span>
                        <span>
                          <strong>{pixel.label || "Untitled message"}</strong>
                          <small>
                            {pixel.recipient || "Add a recipient or a note"}
                          </small>
                        </span>
                      </span>
                      <span className={`status status-${pixel.status}`}>
                        <span />
                        {statusNames[pixel.status]}
                      </span>
                      <span
                        className="row-activity"
                        title={formatDate(pixel.lastLoadedAt, true)}
                      >
                        {pixel.lastLoadedAt
                          ? formatDate(pixel.lastLoadedAt)
                          : "No loads yet"}
                        <small>
                          {pixel.loadCount
                            ? `${pixel.loadCount} image request${pixel.loadCount === 1 ? "" : "s"}`
                            : "Waiting for activity"}
                        </small>
                      </span>
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <span className="empty-orbit" />
                    <Icon name={search ? "search" : "mail"} size={33} />
                    <span className="illustration-spark">+</span>
                  </div>
                  <h3>
                    {search
                      ? "No matching messages."
                      : filter === "archived"
                        ? "Nothing archived yet."
                        : data.pixels.length === 0
                          ? "Your first message starts here."
                          : "Nothing here just yet."}
                  </h3>
                  <p>
                    {search
                      ? "Try another label, recipient or note."
                      : filter === "archived"
                        ? "Archived messages will be kept here for reference."
                        : "Create a pixel, add it to your email, then return to give it a name."}
                  </p>
                  {!search && filter !== "archived" && (
                    <button
                      className="button secondary"
                      disabled={!!busy || offline}
                      onClick={() => void createPixel()}
                    >
                      <Icon name="plus" /> Create a pixel
                    </button>
                  )}
                </div>
              )}
              {hasMore && (
                <div className="load-more">
                  <button
                    className="button secondary"
                    disabled={listLoading}
                    onClick={() => void loadList(listItems.length)}
                  >
                    {listLoading ? "Loading…" : "Load more messages"}
                  </button>
                </div>
              )}
              <div className="list-footer">
                <span>
                  {filtered.length} of {listTotal} message
                  {listTotal === 1 ? "" : "s"}
                </span>
                <span>
                  <span className="live-dot" /> Updates every 15 seconds
                </span>
              </div>
            </section>
            <aside
              className="detail-column"
              ref={detailRef}
              aria-label={selected ? "Selected message" : "Getting started"}
            >
              {selected ? (
                <section className="detail-card">
                  <div className="detail-header">
                    <div className="eyebrow">MESSAGE DETAILS</div>
                    <button
                      className="icon-button"
                      aria-label="Close message details"
                      onClick={() => {
                        setSelectedId(null);
                        setSelectedRecord(null);
                        selectedIdRef.current = null;
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <h2>{selected.label || "Untitled message"}</h2>
                  <div className={`status status-${selected.status}`}>
                    <span />
                    {statusNames[selected.status]}
                  </div>
                  <div className="workflow-step">
                    <span className="step-number">1</span>
                    <div>
                      <h3>Add the pixel to your email</h3>
                      <p>
                        Copy the image HTML and insert it using a verified
                        Outlook method.
                      </p>
                    </div>
                  </div>
                  <div className="copy-actions">
                    <button
                      className="button secondary"
                      onClick={() => void copyPixel(true)}
                    >
                      <Icon name="copy" size={16} /> Copy for Outlook
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void copyPixel(false)}
                    >
                      Copy HTML
                    </button>
                  </div>
                  <details className="html-details">
                    <summary>View image HTML</summary>
                    <textarea
                      readOnly
                      aria-label="Tracking image HTML"
                      value={htmlFor(selected)}
                      onFocus={(event) => event.target.select()}
                      rows={4}
                      spellCheck={false}
                    />
                    <p>
                      Copying this source as plain text into an email does not
                      insert an image.
                    </p>
                  </details>
                  {copyNotice && (
                    <p className="copy-notice" role="status">
                      {copyNotice}
                    </p>
                  )}
                  <p className="compatibility-note">
                    Outlook on iPhone: insertion method not yet verified.{" "}
                    <button
                      className="text-button"
                      onClick={() => setDialog("guide")}
                    >
                      See how to test
                    </button>
                  </p>
                  <div className="detail-divider" />
                  <div className="workflow-step">
                    <span className="step-number">2</span>
                    <div>
                      <h3>Send, then add your context</h3>
                      <p>Labels stay private. You can update them anytime.</p>
                    </div>
                  </div>
                  <form
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      void updatePixel();
                    }}
                    className="details-form"
                  >
                    <label>
                      Message label
                      <input
                        maxLength={150}
                        value={draft.label}
                        onChange={(event) =>
                          setDraft({ ...draft, label: event.target.value })
                        }
                        placeholder="e.g. Website proposal"
                      />
                    </label>
                    <label>
                      Recipient <span className="optional">optional</span>
                      <input
                        maxLength={254}
                        value={draft.recipient}
                        onChange={(event) =>
                          setDraft({ ...draft, recipient: event.target.value })
                        }
                        type="email"
                        placeholder="name@example.com"
                      />
                    </label>
                    <label>
                      Notes <span className="optional">optional</span>
                      <textarea
                        maxLength={2000}
                        rows={2}
                        value={draft.notes}
                        onChange={(event) =>
                          setDraft({ ...draft, notes: event.target.value })
                        }
                        placeholder="A little context for your follow-up"
                      />
                    </label>
                    <button
                      className="button secondary full-width"
                      type="submit"
                      disabled={!dirty || !!busy || offline}
                    >
                      {busy === "save" ? "Saving…" : "Save details"}
                    </button>
                  </form>
                  <div className="pixel-retention">
                    <strong>Record retention</strong>
                    {selected.hasRecordedLoad ? (
                      <p>
                        Kept permanently after its first recorded load, including
                        activity and saved request details. You can still clear
                        activity or delete this pixel yourself.
                      </p>
                    ) : (
                      <>
                        <label className="retention-choice">
                          <input
                            type="checkbox"
                            checked={selected.preserveUnloaded}
                            disabled={!!busy || offline}
                            onChange={(event) => void preserveUnloadedPixel(event.target.checked)}
                          />
                          <span>Keep this pixel even if it never loads</span>
                        </label>
                        <p>
                          {selected.preserveUnloaded
                            ? "This record is protected from automatic cleanup."
                            : data.settings.keepUnloadedPixels
                              ? "Your preferences keep all never-loaded pixels. This checkbox also protects this pixel if you turn 90-day cleanup back on."
                              : "If it never records a load, this pixel and its label and notes are deleted 90 days after creation. Any recorded load makes its history permanent."}
                        </p>
                      </>
                    )}
                  </div>
                  {selected.status !== "archived" && (
                    <button
                      className="button primary full-width arm-button"
                      onClick={() =>
                        void updatePixel(
                          selected.status === "armed" ? "paused" : "armed",
                        )
                      }
                      disabled={!!busy || offline}
                    >
                      <Icon
                        name={selected.status === "armed" ? "pause" : "check"}
                      />
                      {busy === "armed" || busy === "paused"
                        ? "Updating…"
                        : selected.status === "armed"
                          ? "Pause alerts"
                          : selected.status === "paused"
                            ? "Resume alerts"
                            : "Sent — enable alerts"}
                    </button>
                  )}
                  <p className="quiet-note">
                    {selected.armedAt
                      ? `Last enabled ${formatDate(selected.armedAt)}.`
                      : "Loads before you enable alerts stay in the activity history."}{" "}
                    {selected.notificationStatus === "none" && selected.firstAlertAt
                      ? "A first-load notification was already recorded; its detailed history was cleared or removed under an earlier retention policy."
                      : `Email: ${deliveryNames[selected.notificationStatus]}.`}
                  </p>
                  <div className="detail-divider" />
                  <div className="timeline-heading">
                    <h3>
                      Image activity <span>{selected.loadCount}</span>
                    </h3>
                    <button
                      className="icon-button"
                      onClick={() => void loadEvents()}
                      aria-label="Refresh image activity"
                      disabled={eventsLoading}
                    >
                      <Icon name="refresh" size={15} />
                    </button>
                  </div>
                  {eventsLoading && (
                    <p className="quiet-note" role="status">
                      Loading activity…
                    </p>
                  )}
                  {eventsError && (
                    <p className="field-error" role="alert">
                      {eventsError}
                    </p>
                  )}
                  {!eventsLoading && !eventsError && events.length === 0 && (
                    <div className="timeline-empty">
                      <span className="live-dot" />
                      <p>No image requests recorded yet.</p>
                    </div>
                  )}
                  <ol className="timeline">
                    {events.map((event) => (
                      <li key={event.id}>
                        <span className="timeline-dot" />
                        <strong>Image loaded</strong>
                        <time
                          dateTime={event.createdAt}
                          title={event.createdAt}
                        >
                          {formatDate(event.createdAt, true)}
                        </time>
                        {event.metadata ? (
                          <div className="event-summary">
                            <p>{requestLocation(event.metadata)} <span>· approximate</span></p>
                            <p>{event.metadata.proxy
                              ? `${event.metadata.proxy} · reported proxy`
                              : [event.metadata.client, event.metadata.platform, event.metadata.device].filter(Boolean).join(" · ") || "Client and device unavailable"}</p>
                            {event.metadata.network && <p>{event.metadata.network}</p>}
                          </div>
                        ) : (
                          <p className="event-summary event-unavailable">Location and device details weren’t collected for this load.</p>
                        )}
                        {event.phase === "before_arming" && (
                          <small>While alerts were off</small>
                        )}
                        <RequestDetails metadata={event.metadata} />
                      </li>
                    ))}
                  </ol>
                  {eventsCursor && (
                    <button
                      className="secondary-button history-more"
                      disabled={eventsLoading || offline}
                      onClick={() => void loadEvents(false, eventsCursor)}
                    >
                      {eventsLoading ? "Loading earlier requests…" : "Load earlier requests"}
                    </button>
                  )}
                  {events.length > 0 && (
                    <p className="quiet-note">
                      {events.length} recorded {events.length === 1 ? "request" : "requests"} shown, newest first.
                      {eventsCursor ? " Load earlier requests to see more." : " End of retained history."}
                      {eventsExpandedRef.current ? " Refresh to include new requests." : ""}
                      {" "}Times use your browser’s time zone; request location is approximate and may belong to a proxy. A load does not confirm reading.
                    </p>
                  )}
                  <div className="detail-actions">
                    {selected.status !== "archived" && (
                      <button
                        className="text-button"
                        disabled={!!busy || offline}
                        onClick={() => void updatePixel("archived")}
                      >
                        <Icon name="archive" size={15} /> Archive
                      </button>
                    )}
                    {selected.status === "archived" && (
                      <button
                        className="text-button"
                        disabled={!!busy || offline}
                        onClick={() => void updatePixel("paused")}
                      >
                        Restore as paused
                      </button>
                    )}
                    <button
                      className="text-button danger-text"
                      onClick={() => setDialog("delete")}
                    >
                      <Icon name="trash" size={15} /> Delete
                    </button>
                    {selected.loadCount > 0 && (
                      <button
                        className="text-button"
                        onClick={() => setDialog("clear")}
                      >
                        Clear activity
                      </button>
                    )}
                  </div>
                </section>
              ) : (
                <>
                  <section className="guide-card">
                    <div className="guide-icon">
                      <Icon name="activity" size={23} />
                    </div>
                    <div className="eyebrow">A SIMPLE WORKFLOW</div>
                    <h2>
                      Send as usual.
                      <br />
                      Keep the context.
                    </h2>
                    <ol className="getting-started">
                      <li>
                        <span>01</span>
                        <div>
                          <strong>Create your pixel</strong>
                          <p>A unique image for one message.</p>
                        </div>
                      </li>
                      <li>
                        <span>02</span>
                        <div>
                          <strong>Add it and send</strong>
                          <p>Use a verified insertion method.</p>
                        </div>
                      </li>
                      <li>
                        <span>03</span>
                        <div>
                          <strong>Label and enable alerts</strong>
                          <p>Come back when you’re ready.</p>
                        </div>
                      </li>
                    </ol>
                    <button
                      className="text-button"
                      onClick={() => setDialog("guide")}
                    >
                      A closer look <Icon name="arrow" size={16} />
                    </button>
                  </section>
                  <section className="honesty-card">
                    <Icon name="shield" size={18} />
                    <div>
                      <h3>A signal, not a read receipt.</h3>
                      <p>
                        Image activity adds context. Privacy tools can preload
                        or block images, so a load doesn’t prove someone read
                        your message.
                      </p>
                    </div>
                  </section>
                </>
              )}
            </aside>
          </div>
          <footer className="workspace-footer">
            <span>
              SOLURE DIGITAL WORKS <span className="footer-dot">/</span> MADE
              FOR YOUR WORKDAY
            </span>
            <span>Private by design.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
      {dialog === "guide" && (
        <Dialog
          title="A useful signal, with clear limits."
          onClose={() => setDialog(null)}
        >
          <div className="dialog-body prose">
            <p>
              Each pixel is a tiny remote image with its own address. A request
              for that image creates an activity event. Your message label,
              recipient and notes stay in your private workspace.
            </p>
            <h3>Test your Outlook insertion method first</h3>
            <ol>
              <li>
                Create a pixel and use “Copy for Outlook,” or insert its HTML
                through a client that supports HTML insertion.
              </li>
              <li>Send a test message to an inbox you control.</li>
              <li>
                Inspect the received message source. Its image must still
                reference the pixel’s HTTPS address, rather than an embedded
                attachment or a <code>cid:</code> address.
              </li>
              <li>Check the activity after allowing remote images to load.</li>
            </ol>
            <p>
              Normal image insertion can embed the file. A pasted URL or pasted
              HTML source alone is not a tracking image. Outlook on iPhone
              remains unverified until this test passes.
            </p>
            <h3>What a load can tell you</h3>
            <p>
              It shows that something requested the image. Previews, security
              scanners and privacy services may request it before a person reads
              the email. Image blocking and caching can hide later activity.
            </p>
            <p>
              One pixel belongs to one message. If you send it to several
              people, or someone forwards the message, the pixel cannot identify
              who loaded it.
            </p>
            <h3>Optional request details</h3>
            <p>
              By default, image loads record activity times without request
              details. In preferences, you can choose to save the request IP,
              approximate location, network, and reported device and client for
              future loads. Expand “Request details” in the activity history to
              see what was available.
            </p>
            <p>
              These details may belong to an image proxy or privacy service,
              rather than the person reading your email. Location is approximate
              and does not use GPS. Reported client information and proxy hints
              can be incomplete or inaccurate.
            </p>
            <p>
              Turning collection off stops saving details for future loads.
              Once a pixel records a load, its history and saved details are kept
              permanently unless you clear the activity or delete the pixel.
              Pixels that never load are deleted 90 days after creation unless
              you keep them individually or keep all never-loaded pixels in
              preferences. A proxy or scanner request also counts as a load.
            </p>
            <h3>After sending</h3>
            <p>
              Return here to label the pixel and enable alerts. Earlier loads
              remain visible, but do not generate alerts. You may miss an early
              recipient request during that interval.
            </p>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={() => setDialog(null)}>
              Got it
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "settings" && settingsDraft && (
        <Dialog title="Your preferences" onClose={() => setDialog(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action("settings", async () => {
                // Omit unchanged fields so an older tab cannot restore a
                // collection preference changed in another window.
                const changes = Object.fromEntries(
                  Object.entries(settingsDraft).filter(
                    ([key, value]) =>
                      value !== settingsBaselineRef.current?.[key as keyof Settings],
                  ),
                );
                await request("/api/settings", {
                  method: "PATCH",
                  body: JSON.stringify(changes),
                });
                await load();
                setDialog(null);
                setToast("Preferences saved.");
              });
            }}
          >
            <div className="dialog-body">
              <div className="setting-row">
                <div>
                  <strong>Email notifications</strong>
                  <p>
                    {data.development
                      ? "Simulate email alerts locally. No email is sent."
                      : `Send activity alerts to ${data.ownerEmail}.`}
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Enable email notifications"
                  checked={settingsDraft.emailEnabled}
                  disabled={!data.notificationConfigured}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      emailEnabled: event.target.checked,
                    })
                  }
                />
              </div>
              {(data.development || !data.notificationConfigured) && (
                <p className="inline-note">
                  {data.development
                    ? "Local mode records test deliveries without sending email."
                    : "Email delivery needs sender configuration. In-app activity remains available."}
                </p>
              )}
              <div className="setting-row">
                <div>
                  <strong>Repeat alerts</strong>
                  <p>
                    Allow later requests to notify you again, subject to a
                    cooldown.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-label="Enable repeat alerts"
                  checked={settingsDraft.repeatAlerts}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      repeatAlerts: event.target.checked,
                    })
                  }
                />
              </div>
              <div className="setting-row request-details-setting">
                <div>
                  <strong id="request-details-setting-title">
                    Collect request details
                  </strong>
                  <p id="request-details-setting-description">
                    Save the request IP, approximate location, network, and
                    reported device and client for future image loads. Off by
                    default.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="request-details-setting-title"
                  aria-describedby="request-details-setting-description request-details-privacy"
                  checked={settingsDraft.captureRequestDetails}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      captureRequestDetails: event.target.checked,
                    })
                  }
                />
              </div>
              <p id="request-details-privacy" className="request-privacy-note">
                Proxies can replace reader information; this is request data,
                not a person’s identity or GPS location. Turning this off stops
                future collection. Saved details are kept permanently after a
                recorded load unless you clear activity or delete the pixel.
              </p>
              <div className="setting-row">
                <div>
                  <strong id="keep-unloaded-title">Keep all never-loaded pixels</strong>
                  <p id="keep-unloaded-description">
                    When off, never-loaded pixels are deleted 90 days after
                    creation unless you keep a specific pixel. Turn on to keep
                    all of them permanently.
                  </p>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="keep-unloaded-title"
                  aria-describedby="keep-unloaded-description"
                  checked={settingsDraft.keepUnloadedPixels}
                  onChange={(event) => setSettingsDraft({
                    ...settingsDraft,
                    keepUnloadedPixels: event.target.checked,
                  })}
                />
              </div>
              <p className="quiet-note">
                Loaded pixels, activity, saved request details and notifications
                are kept permanently, including when archived. Clearing activity
                or deleting a pixel still removes that data. Turning this setting
                off makes unprotected never-loaded pixels older than 90 days
                eligible for the next cleanup.
              </p>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={!!busy || offline}
              >
                {busy === "settings" ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {dialog === "notifications" && (
        <Dialog title="Notifications" onClose={() => setDialog(null)} wide>
          <div className="notification-summary">
            <span>
              {unread} unread notification{unread === 1 ? "" : "s"}
              {data.notifications.length === 200 ? " · Showing latest 200" : ""}
            </span>
            <button
              className="text-button"
              disabled={!!busy || unread === 0}
              onClick={() => void markRead()}
            >
              Mark all read
            </button>
          </div>
          <div className="notification-list">
            {data.notifications.length === 0 ? (
              <div className="notification-empty">
                <Icon name="bell" size={30} />
                <h3>You’re all caught up.</h3>
                <p>
                  When an armed pixel loads, its notification will appear here.
                </p>
              </div>
            ) : (
              data.notifications.map((notification: Notification) => (
                <article
                  className={
                    !notification.readAt
                      ? "notification-entry unread"
                      : "notification-entry"
                  }
                  key={notification.id}
                >
                  <span className="notification-entry-icon">
                    <Icon name="activity" />
                  </span>
                  <div>
                    <strong>
                      Image loaded — {notification.label || "Untitled message"}
                    </strong>
                    <time dateTime={notification.createdAt}>
                      {formatDate(notification.createdAt, true)}
                    </time>
                    <span className="delivery-label">
                      {deliveryNames[notification.status]}
                    </span>
                    {notification.lastError && (
                      <p className="field-error">{notification.lastError}</p>
                    )}
                    <button
                      className="text-button"
                      onClick={() =>
                        void action("view", async () => {
                          const pixel = await request<Pixel>(
                            `/api/pixels/${notification.pixelId}`,
                          );
                          choose(pixel);
                          setDialog(null);
                        })
                      }
                    >
                      View message <Icon name="arrow" size={14} />
                    </button>
                  </div>
                  {!notification.readAt && (
                    <button
                      className="icon-button"
                      disabled={!!busy}
                      aria-label={`Mark notification for ${notification.label || "untitled message"} as read`}
                      onClick={() => void markRead([notification.id])}
                    >
                      <Icon name="check" />
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
          {error && (
            <p role="alert" className="field-error dialog-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {(dialog === "delete" || dialog === "clear") && selected && (
        <Dialog
          title={
            dialog === "delete"
              ? "Delete this message?"
              : "Clear activity history?"
          }
          onClose={() => setDialog(null)}
        >
          <div className="dialog-body">
            <p>
              {dialog === "delete"
                ? "This removes the pixel’s label, notes, activity, saved request details and notifications. Future image requests will not be tracked. This cannot be undone."
                : "This removes the recorded activity, including saved request details, and resets the summary counts for this pixel. Its label, notes and current alert state stay in place. This cannot be undone."}
            </p>
            <strong>{selected.label || "Untitled message"}</strong>
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              Keep it
            </button>
            <button
              className="button destructive"
              disabled={!!busy || offline}
              onClick={() =>
                void action("delete", async () => {
                  await request(
                    `/api/pixels/${selected.id}${dialog === "clear" ? "/events" : ""}`,
                    { method: "DELETE" },
                  );
                  if (dialog === "delete") {
                    setSelectedId(null);
                    setSelectedRecord(null);
                    selectedIdRef.current = null;
                  }
                  await load();
                  await loadList();
                  if (dialog === "clear") await loadEvents();
                  setDialog(null);
                  setToast(
                    dialog === "delete"
                      ? "Message deleted."
                      : "Activity cleared.",
                  );
                })
              }
            >
              {busy === "delete"
                ? "Removing…"
                : dialog === "delete"
                  ? "Delete message"
                  : "Clear activity"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: IconName;
  footnote: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">
        {label}
        <Icon name={icon} size={18} />
      </div>
      <strong className="stat-value">{value.toLocaleString()}</strong>
      <p>{footnote}</p>
    </article>
  );
}
